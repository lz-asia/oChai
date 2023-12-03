import { OmniChaiHub, OmniChaiOnGnosis, IERC20 } from "../typechain-types";
import "dotenv/config";
import { ethers, network } from "hardhat";
import { expect } from "chai";

import { setBalance, SnapshotRestorer, takeSnapshot, time } from "@nomicfoundation/hardhat-network-helpers";

import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { Wallet, utils, constants, BigNumberish, BigNumber } from "ethers";

import { endpoint } from "../constants/layerzero.json";
import { deployedAddress as oChaiAddress } from "../deployments/oChai.json";
import * as multisigs from "../deployments/multisig.json";

const { AddressZero, MaxUint256 } = constants;
const GNOSIS_EVM_CHAIN_ID = 100;
const GNOSIS_LZ_CHAIN_ID = 145;
const ARB_LZ_CHAIN_ID = 110;
const OP_LZ_CHAIN_ID = 111;
const Pending = 0;
const Completed = 1;
const Cancelled = 2;
const PT_SEND_DEPOSIT = 1;
const PT_SEND_CANCEL = 2;
const oChaiGatewayAddress = Wallet.createRandom().address;
const wxdaiAddress = "0xe91D153E0b41518A2Ce8Dd3D7944Fa863463a97d";

describe("oChaiHub", () => {
    let oChai: OmniChaiOnGnosis;
    let wxdai: IERC20;
    let hub: OmniChaiHub;
    let deployer: SignerWithAddress;
    let user: SignerWithAddress;
    let vitalik: SignerWithAddress;
    let snapshot: SnapshotRestorer;
    let epContract;
    let ulnContract;
    let multisig;

    before(async () => {
        const chainId = network.config.chainId;
        expect(chainId, "For this test, should fork Gnosis network").to.be.equal(GNOSIS_EVM_CHAIN_ID);

        deployer = await ethers.getImpersonatedSigner(process.env.DEPLOYER_ADDRESS);
        [user, vitalik] = await ethers.getSigners();
        multisig = await ethers.getImpersonatedSigner(multisigs.gnosis);

        await setBalance(deployer.address, utils.parseEther("100000"));
        await setBalance(user.address, utils.parseEther("100000"));
        await setBalance(vitalik.address, utils.parseEther("100000"));
        await setBalance(multisig.address, utils.parseEther("10000"));

        const networkName = (await ethers.provider.getNetwork()).name;
        expect(networkName).to.be.equal("xdai");

        oChai = (await ethers.getContractAt("OmniChaiOnGnosis", oChaiAddress[chainId])) as OmniChaiOnGnosis;
        wxdai = (await ethers.getContractAt("IERC20", wxdaiAddress)) as IERC20;

        hub = (await (
            await ethers.getContractFactory("OmniChaiHub", deployer)
        ).deploy(endpoint.mainnet.gnosis, oChai.address, wxdai.address, deployer.address)) as OmniChaiHub;

        await hub.connect(deployer).setTrustedRemoteAddress(OP_LZ_CHAIN_ID, oChaiGatewayAddress);
        await hub.connect(deployer).setTrustedRemoteAddress(ARB_LZ_CHAIN_ID, oChaiGatewayAddress);

        await vitalik.sendTransaction({ to: wxdai.address, data: "0x", value: utils.parseEther("10000") });
        expect(await wxdai.balanceOf(vitalik.address)).to.be.equal(utils.parseEther("10000"));

        const IEP = new ethers.utils.Interface(["function defaultSendLibrary() external view returns (address uln)"]);
        const IULN = new ethers.utils.Interface([
            "function defaultAdapterParams(uint16 dstChainId, uint16 proofType) external view returns (bytes memory)",
            "event RelayerParams(bytes adapterParams, uint16 outboundProofType);",
        ]);

        epContract = new ethers.Contract(endpoint.mainnet.gnosis, IEP, ethers.provider);
        const ulnAddress = await epContract.defaultSendLibrary();
        ulnContract = new ethers.Contract(ulnAddress, IULN, ethers.provider);
        snapshot = await takeSnapshot();
    });
    beforeEach(async () => {
        await snapshot.restore();
    });
    describe("oChaiHub", () => {
        context("when deployed", async () => {
            it("should return correct initial values", async () => {
                expect(await hub.lzEndpoint()).to.be.equal(endpoint.mainnet.gnosis);
                expect(await hub.oChai()).to.be.equal(oChai.address);
                expect(await hub.wxdai()).to.be.equal(wxdai.address);

                expect(await hub.owner()).to.be.equal(deployer.address);

                await expect(hub.depositRequest(OP_LZ_CHAIN_ID, user.address, 0)).to.be.reverted;
                await expect(hub.depositRequest(ARB_LZ_CHAIN_ID, user.address, 0)).to.be.reverted;
            });
        });
        describe("SetBaseMinDstGas", () => {
            it("should revert if not owner", async () => {
                await expect(hub.connect(user).setBaseMinDstGas(PT_SEND_DEPOSIT, 100000)).to.be.reverted;
            });
            it("should set baseMinDstGas", async () => {
                await expect(hub.setBaseMinDstGas(PT_SEND_DEPOSIT, 100000))
                    .to.emit(hub, "SetBaseMinDstGas")
                    .withArgs(PT_SEND_DEPOSIT, 100000);
                expect(await hub.baseMinDstGasLookup(PT_SEND_DEPOSIT)).to.be.equal(100000);
                expect(await hub.baseMinDstGasLookup(PT_SEND_CANCEL)).to.be.equal(0);
            });
        });

        async function callLzReceive(
            srcChainId: BigNumberish,
            packetType: BigNumberish,
            userAddress: string,
            nonce: BigNumberish,
            amount?: BigNumberish,
            fee?: BigNumberish,
            returnCallGaslimit?: BigNumberish
        ) {
            const epImp = await ethers.getImpersonatedSigner(endpoint.mainnet.gnosis);
            await setBalance(epImp.address, utils.parseEther("10000"));
            const tra = await hub.trustedRemoteLookup(srcChainId);
            expect(utils.hexDataLength(tra)).to.be.equal(40);
            let payload;

            if (packetType === PT_SEND_DEPOSIT) {
                expect(amount).to.be.not.undefined;
                expect(fee).to.be.not.undefined;
                payload = utils.defaultAbiCoder.encode(
                    ["uint16", "address", "uint256", "uint256", "uint256"],
                    [PT_SEND_DEPOSIT, userAddress, amount, fee, nonce]
                );
            } else if (packetType === PT_SEND_CANCEL) {
                payload = utils.defaultAbiCoder.encode(
                    ["uint16", "address", "uint256", "uint256"],
                    [PT_SEND_CANCEL, userAddress, nonce, returnCallGaslimit]
                );
            } else {
                throw new Error("Invalid packetType");
            }
            return hub.connect(epImp).lzReceive(srcChainId, tra, 0, payload);
        }

        describe("_deposit by LzReceive", () => {
            async function depositCall(
                srcChainId: BigNumberish,
                userAddress: string,
                nonce: BigNumberish,
                amount: BigNumberish,
                fee: BigNumberish
            ) {
                return callLzReceive(srcChainId, PT_SEND_DEPOSIT, userAddress, nonce, amount, fee);
            }

            const amount = utils.parseEther("100");
            const fee = utils.parseEther("0.2");

            beforeEach(async () => {
                await expect(depositCall(OP_LZ_CHAIN_ID, user.address, 0, amount, fee)).to.emit(
                    hub,
                    "RecordDepositRequest"
                );
            });
            describe("lzReceive itself", () => {
                it("should update depositRequest", async () => {
                    const reqOp0 = await hub.depositRequest(OP_LZ_CHAIN_ID, user.address, 0);
                    expect(reqOp0.status).to.be.equal(Pending);
                    expect(reqOp0.amount).to.be.equal(amount);
                    expect(reqOp0.fee).to.be.equal(fee);

                    const reqArb0 = await hub.depositRequest(ARB_LZ_CHAIN_ID, user.address, 0);
                    expect(reqArb0.status).to.be.equal(Pending);
                    expect(reqArb0.amount).to.be.equal(0);
                    expect(reqArb0.fee).to.be.equal(0);
                });

                it("should emit RequestDeposit event", async () => {
                    const DepositEvent = await hub.queryFilter(hub.filters.RecordDepositRequest(), "latest");
                    expect(DepositEvent.length).to.be.equal(1);
                    const args = DepositEvent[0].args;
                    expect(args.srcChainId).to.be.equal(OP_LZ_CHAIN_ID);
                    expect(args.requester).to.be.equal(user.address);
                    expect(args.nonce).to.be.equal(0);
                    expect(args.amount).to.be.equal(amount);
                    expect(args.fee).to.be.equal(fee);

                    await expect(depositCall(OP_LZ_CHAIN_ID, vitalik.address, 10, amount.add(1), fee.sub(1)))
                        .to.emit(hub, "RecordDepositRequest")
                        .withArgs(OP_LZ_CHAIN_ID, vitalik.address, 10, amount.add(1), fee.sub(1));
                });

                it("should be failed if amount is zero", async () => {
                    await expect(depositCall(OP_LZ_CHAIN_ID, user.address, 1, 0, fee)).to.emit(hub, "MessageFailed");

                    await depositCall(OP_LZ_CHAIN_ID, user.address, 1, amount, fee);
                });

                it("should be failed if DepositRequest already exists", async () => {
                    const req = await hub.depositRequest(OP_LZ_CHAIN_ID, user.address, 0);
                    expect(req.status).to.be.equal(Pending);

                    await expect(depositCall(OP_LZ_CHAIN_ID, user.address, 0, amount, fee)).to.emit(
                        hub,
                        "MessageFailed"
                    );
                });
            });
            describe("executeDepositRequest", () => {
                const enoughGasLimits = [300000, 300000];
                const enoughMsgValues = [utils.parseEther("10"), utils.parseEther("10")];
                const enoughTotalMsgValue = utils.parseEther("20");

                describe("estimateExecuteDepositRequest", () => {
                    let estimatedMsgValues;
                    beforeEach(async () => {
                        estimatedMsgValues = (
                            await hub.estimateExecuteDepositRequest(
                                OP_LZ_CHAIN_ID,
                                user.address,
                                0,
                                AddressZero,
                                enoughGasLimits
                            )
                        ).lzNativeFees;
                    });
                    it("should work properly with wxDAI", async () => {
                        expect(estimatedMsgValues[0].add(estimatedMsgValues[1])).to.be.lt(enoughTotalMsgValue);
                        await wxdai.connect(vitalik).approve(hub.address, MaxUint256);
                        await expect(
                            hub
                                .connect(vitalik)
                                .executeDepositRequest(
                                    OP_LZ_CHAIN_ID,
                                    user.address,
                                    0,
                                    AddressZero,
                                    enoughGasLimits,
                                    [estimatedMsgValues[0].sub(1), estimatedMsgValues[1].add(1)],
                                    { value: enoughTotalMsgValue }
                                )
                        ).to.be.reverted;
                        await expect(
                            hub
                                .connect(vitalik)
                                .executeDepositRequest(
                                    OP_LZ_CHAIN_ID,
                                    user.address,
                                    0,
                                    AddressZero,
                                    enoughGasLimits,
                                    [estimatedMsgValues[0].add(1), estimatedMsgValues[1].sub(1)],
                                    { value: enoughTotalMsgValue }
                                )
                        ).to.be.reverted;

                        await hub
                            .connect(vitalik)
                            .executeDepositRequest(
                                OP_LZ_CHAIN_ID,
                                user.address,
                                0,
                                AddressZero,
                                enoughGasLimits,
                                estimatedMsgValues,
                                { value: enoughTotalMsgValue }
                            );
                    });
                    it("should work properly with xDAI", async () => {
                        expect(estimatedMsgValues[0].add(estimatedMsgValues[1])).to.be.lt(enoughTotalMsgValue);

                        await expect(
                            hub
                                .connect(vitalik)
                                .executeDepositRequestXDAI(
                                    OP_LZ_CHAIN_ID,
                                    user.address,
                                    0,
                                    AddressZero,
                                    enoughGasLimits,
                                    [estimatedMsgValues[0].sub(1), estimatedMsgValues[1].add(1)],
                                    { value: amount.add(enoughTotalMsgValue) }
                                )
                        ).to.be.reverted;
                        await expect(
                            hub
                                .connect(vitalik)
                                .executeDepositRequestXDAI(
                                    OP_LZ_CHAIN_ID,
                                    user.address,
                                    0,
                                    AddressZero,
                                    enoughGasLimits,
                                    [estimatedMsgValues[0].add(1), estimatedMsgValues[1].sub(1)],
                                    { value: amount.add(enoughTotalMsgValue) }
                                )
                        ).to.be.reverted;

                        await hub
                            .connect(vitalik)
                            .executeDepositRequestXDAI(
                                OP_LZ_CHAIN_ID,
                                user.address,
                                0,
                                AddressZero,
                                enoughGasLimits,
                                estimatedMsgValues,
                                { value: amount.add(enoughTotalMsgValue) }
                            );
                    });
                });
                context("when depositRequest is invalid", async () => {
                    it("should be failed with wxDAI", async () => {
                        await expect(
                            hub
                                .connect(vitalik)
                                .executeDepositRequest(
                                    OP_LZ_CHAIN_ID,
                                    user.address,
                                    10,
                                    AddressZero,
                                    enoughGasLimits,
                                    enoughMsgValues,
                                    { value: enoughTotalMsgValue }
                                )
                        ).to.be.revertedWithCustomError(hub, "InvalidStatus");
                        await expect(
                            hub
                                .connect(vitalik)
                                .executeDepositRequest(
                                    ARB_LZ_CHAIN_ID,
                                    user.address,
                                    0,
                                    AddressZero,
                                    enoughGasLimits,
                                    enoughMsgValues,
                                    { value: enoughTotalMsgValue }
                                )
                        ).to.be.revertedWithCustomError(hub, "InvalidStatus");
                        await expect(
                            hub
                                .connect(vitalik)
                                .executeDepositRequest(
                                    OP_LZ_CHAIN_ID,
                                    deployer.address,
                                    0,
                                    AddressZero,
                                    enoughGasLimits,
                                    enoughMsgValues,
                                    { value: enoughTotalMsgValue }
                                )
                        ).to.be.revertedWithCustomError(hub, "InvalidStatus");
                    });
                    it("should be failed with xDAI", async () => {
                        await expect(
                            hub
                                .connect(vitalik)
                                .executeDepositRequestXDAI(
                                    OP_LZ_CHAIN_ID,
                                    user.address,
                                    10,
                                    AddressZero,
                                    enoughGasLimits,
                                    enoughMsgValues,
                                    { value: enoughTotalMsgValue }
                                )
                        ).to.be.revertedWithCustomError(hub, "InvalidStatus");
                        await expect(
                            hub
                                .connect(vitalik)
                                .executeDepositRequestXDAI(
                                    ARB_LZ_CHAIN_ID,
                                    user.address,
                                    0,
                                    AddressZero,
                                    enoughGasLimits,
                                    enoughMsgValues,
                                    { value: enoughTotalMsgValue }
                                )
                        ).to.be.revertedWithCustomError(hub, "InvalidStatus");
                        await expect(
                            hub
                                .connect(vitalik)
                                .executeDepositRequestXDAI(
                                    OP_LZ_CHAIN_ID,
                                    deployer.address,
                                    0,
                                    AddressZero,
                                    enoughGasLimits,
                                    enoughMsgValues,
                                    { value: enoughTotalMsgValue }
                                )
                        ).to.be.revertedWithCustomError(hub, "InvalidStatus");
                    });
                });
                context("when msgValue is not enough", async () => {
                    it("should be failed with wxDAI", async () => {
                        await wxdai.connect(vitalik).approve(hub.address, MaxUint256);
                        await expect(
                            hub
                                .connect(vitalik)
                                .executeDepositRequest(
                                    OP_LZ_CHAIN_ID,
                                    user.address,
                                    0,
                                    AddressZero,
                                    enoughGasLimits,
                                    enoughMsgValues,
                                    { value: utils.parseEther("20").sub(1) }
                                )
                        ).to.be.revertedWithCustomError(hub, "InsufficientMsgValue");
                        await hub
                            .connect(vitalik)
                            .executeDepositRequest(
                                OP_LZ_CHAIN_ID,
                                user.address,
                                0,
                                AddressZero,
                                enoughGasLimits,
                                enoughMsgValues,
                                { value: utils.parseEther("20") }
                            );
                    });
                    it("should be failed with xDAI", async () => {
                        await expect(
                            hub
                                .connect(vitalik)
                                .executeDepositRequestXDAI(
                                    OP_LZ_CHAIN_ID,
                                    user.address,
                                    0,
                                    AddressZero,
                                    enoughGasLimits,
                                    enoughMsgValues,
                                    { value: utils.parseEther("20").sub(1) }
                                )
                        ).to.be.revertedWithCustomError(hub, "InsufficientMsgValue");
                        await expect(
                            hub
                                .connect(vitalik)
                                .executeDepositRequestXDAI(
                                    OP_LZ_CHAIN_ID,
                                    user.address,
                                    0,
                                    AddressZero,
                                    enoughGasLimits,
                                    enoughMsgValues,
                                    { value: amount.sub(fee).add(utils.parseEther("20").sub(1)) }
                                )
                        ).to.be.revertedWithCustomError(hub, "InsufficientMsgValue");

                        await hub
                            .connect(vitalik)
                            .executeDepositRequestXDAI(
                                OP_LZ_CHAIN_ID,
                                user.address,
                                0,
                                AddressZero,
                                enoughGasLimits,
                                enoughMsgValues,
                                { value: amount.sub(fee).add(utils.parseEther("20")) }
                            );
                    });
                });
                context("when wxdai is not approved", async () => {
                    it("should be failed with wxDAI", async () => {
                        await expect(
                            hub
                                .connect(vitalik)
                                .executeDepositRequest(
                                    OP_LZ_CHAIN_ID,
                                    user.address,
                                    0,
                                    AddressZero,
                                    enoughGasLimits,
                                    enoughMsgValues,
                                    { value: enoughTotalMsgValue }
                                )
                        ).to.be.reverted;

                        await wxdai.connect(vitalik).approve(hub.address, MaxUint256);
                        await hub
                            .connect(vitalik)
                            .executeDepositRequest(
                                OP_LZ_CHAIN_ID,
                                user.address,
                                0,
                                AddressZero,
                                enoughGasLimits,
                                enoughMsgValues,
                                { value: enoughTotalMsgValue }
                            );
                    });
                });

                describe("GasLimit test for oChai transfer", () => {
                    async function getUsedGasLimitForSendingOChai() {
                        const logs = await ulnContract.queryFilter(ulnContract.filters.RelayerParams(), "latest");
                        expect(logs.length).to.be.equal(2); // oChai transfer, executeCall
                        const log = logs[0];
                        const decoded = ulnContract.interface.decodeEventLog("RelayerParams", log.data, log.topics);
                        const adapterParams = decoded.adapterParams;
                        expect(utils.hexDataLength(adapterParams)).to.be.equal(34);
                        return BigNumber.from(utils.hexDataSlice(adapterParams, 2));
                    }
                    context("when oChai's useCustomAdapterParams is false", async () => {
                        let defaultGaslimit;
                        beforeEach(async () => {
                            expect(await oChai.useCustomAdapterParams()).to.be.false;
                            const defaultAdapterParams = await ulnContract.defaultAdapterParams(OP_LZ_CHAIN_ID, 2);
                            defaultGaslimit = BigNumber.from(utils.hexDataSlice(defaultAdapterParams, 2));
                        });
                        it("should ignore gasLimit[0] with wxDAI", async () => {
                            await wxdai.connect(vitalik).approve(hub.address, MaxUint256);
                            await hub
                                .connect(vitalik)
                                .executeDepositRequest(
                                    OP_LZ_CHAIN_ID,
                                    user.address,
                                    0,
                                    AddressZero,
                                    enoughGasLimits,
                                    enoughMsgValues,
                                    { value: enoughTotalMsgValue }
                                );
                            const usedGasLimit0 = await getUsedGasLimitForSendingOChai();
                            expect(usedGasLimit0).to.be.not.equal(enoughGasLimits[0]);
                            expect(usedGasLimit0).to.be.equal(defaultGaslimit);

                            await depositCall(OP_LZ_CHAIN_ID, user.address, 1, amount, fee);
                            await hub
                                .connect(vitalik)
                                .executeDepositRequest(
                                    OP_LZ_CHAIN_ID,
                                    user.address,
                                    1,
                                    AddressZero,
                                    [100, 200],
                                    enoughMsgValues,
                                    { value: enoughTotalMsgValue }
                                );
                            const usedGasLimit1 = await getUsedGasLimitForSendingOChai();
                            expect(usedGasLimit1).to.be.not.equal(100);
                            expect(usedGasLimit1).to.be.equal(defaultGaslimit);
                        });
                        it("should ignore gasLimit[0] with xDAI", async () => {
                            await hub
                                .connect(vitalik)
                                .executeDepositRequestXDAI(
                                    OP_LZ_CHAIN_ID,
                                    user.address,
                                    0,
                                    AddressZero,
                                    enoughGasLimits,
                                    enoughMsgValues,
                                    { value: amount.add(enoughTotalMsgValue) }
                                );
                            const usedGasLimit0 = await getUsedGasLimitForSendingOChai();
                            expect(usedGasLimit0).to.be.not.equal(enoughGasLimits[0]);
                            expect(usedGasLimit0).to.be.equal(defaultGaslimit);

                            await depositCall(OP_LZ_CHAIN_ID, user.address, 1, amount, fee);
                            await hub
                                .connect(vitalik)
                                .executeDepositRequestXDAI(
                                    OP_LZ_CHAIN_ID,
                                    user.address,
                                    1,
                                    AddressZero,
                                    [100, 200],
                                    enoughMsgValues,
                                    { value: amount.add(enoughTotalMsgValue) }
                                );
                            const usedGasLimit1 = await getUsedGasLimitForSendingOChai();
                            expect(usedGasLimit1).to.be.not.equal(100);
                            expect(usedGasLimit1).to.be.equal(defaultGaslimit);
                        });
                    });
                    context("when oChai's useCustomAdapterParams is true", async () => {
                        let defaultGaslimit;
                        beforeEach(async () => {
                            await oChai.connect(multisig).setUseCustomAdapterParams(true);
                            await oChai.connect(multisig).setMinDstGas(OP_LZ_CHAIN_ID, 0, 12345);

                            expect(await oChai.useCustomAdapterParams()).to.be.true;
                            const defaultAdapterParams = await ulnContract.defaultAdapterParams(OP_LZ_CHAIN_ID, 2);
                            defaultGaslimit = BigNumber.from(utils.hexDataSlice(defaultAdapterParams, 2));
                        });
                        it("should use gasLimit[0] which is gte minDstGas with wxDAI", async () => {
                            await wxdai.connect(vitalik).approve(hub.address, MaxUint256);
                            await hub
                                .connect(vitalik)
                                .executeDepositRequest(
                                    OP_LZ_CHAIN_ID,
                                    user.address,
                                    0,
                                    AddressZero,
                                    enoughGasLimits,
                                    enoughMsgValues,
                                    { value: enoughTotalMsgValue }
                                );
                            const usedGasLimit0 = await getUsedGasLimitForSendingOChai();
                            expect(usedGasLimit0).to.be.not.equal(defaultGaslimit);
                            expect(usedGasLimit0).to.be.equal(enoughGasLimits[0]);

                            await depositCall(OP_LZ_CHAIN_ID, user.address, 1, amount, fee);
                            await expect(
                                hub
                                    .connect(vitalik)
                                    .executeDepositRequest(
                                        OP_LZ_CHAIN_ID,
                                        user.address,
                                        1,
                                        AddressZero,
                                        [12344, 200],
                                        enoughMsgValues,
                                        { value: enoughTotalMsgValue }
                                    )
                            ).to.be.revertedWith("LzApp: gas limit is too low");
                            await hub
                                .connect(vitalik)
                                .executeDepositRequest(
                                    OP_LZ_CHAIN_ID,
                                    user.address,
                                    1,
                                    AddressZero,
                                    [12345, 200],
                                    enoughMsgValues,
                                    { value: enoughTotalMsgValue }
                                );
                            const usedGasLimit1 = await getUsedGasLimitForSendingOChai();
                            expect(usedGasLimit1).to.be.not.equal(defaultGaslimit);
                            expect(usedGasLimit1).to.be.equal(12345);
                        });
                        it("should use gasLimit[0] which is gte minDstGas with xDAI", async () => {
                            await hub
                                .connect(vitalik)
                                .executeDepositRequestXDAI(
                                    OP_LZ_CHAIN_ID,
                                    user.address,
                                    0,
                                    AddressZero,
                                    enoughGasLimits,
                                    enoughMsgValues,
                                    { value: amount.add(enoughTotalMsgValue) }
                                );
                            const usedGasLimit0 = await getUsedGasLimitForSendingOChai();
                            expect(usedGasLimit0).to.be.not.equal(defaultGaslimit);
                            expect(usedGasLimit0).to.be.equal(enoughGasLimits[0]);

                            await depositCall(OP_LZ_CHAIN_ID, user.address, 1, amount, fee);
                            await expect(
                                hub
                                    .connect(vitalik)
                                    .executeDepositRequestXDAI(
                                        OP_LZ_CHAIN_ID,
                                        user.address,
                                        1,
                                        AddressZero,
                                        [12344, 200],
                                        enoughMsgValues,
                                        { value: amount.add(enoughTotalMsgValue) }
                                    )
                            ).to.be.revertedWith("LzApp: gas limit is too low");
                            await hub
                                .connect(vitalik)
                                .executeDepositRequestXDAI(
                                    OP_LZ_CHAIN_ID,
                                    user.address,
                                    1,
                                    AddressZero,
                                    [12345, 200],
                                    enoughMsgValues,
                                    { value: amount.add(enoughTotalMsgValue) }
                                );
                            const usedGasLimit1 = await getUsedGasLimitForSendingOChai();
                            expect(usedGasLimit1).to.be.not.equal(defaultGaslimit);
                            expect(usedGasLimit1).to.be.equal(12345);
                        });
                    });
                });
                describe("GasLimit test for PT_SEND_DEPOSIT", () => {
                    async function getUsedGasLimitForExecuteCall() {
                        const logs = await ulnContract.queryFilter(ulnContract.filters.RelayerParams(), "latest");
                        expect(logs.length).to.be.equal(2); // oChai transfer, executeCall
                        const log = logs[1];
                        const decoded = ulnContract.interface.decodeEventLog("RelayerParams", log.data, log.topics);
                        const adapterParams = decoded.adapterParams;
                        expect(utils.hexDataLength(adapterParams)).to.be.equal(34);
                        return BigNumber.from(utils.hexDataSlice(adapterParams, 2));
                    }
                    context("when baseMinDstGasLookup is set and minDstGasLookup is not", async () => {
                        beforeEach(async () => {
                            await hub.connect(deployer).setBaseMinDstGas(PT_SEND_DEPOSIT, 10000);
                            expect(await hub.baseMinDstGasLookup(PT_SEND_DEPOSIT)).to.be.equal(10000);
                            expect(await hub.minDstGasLookup(OP_LZ_CHAIN_ID, PT_SEND_DEPOSIT)).to.be.equal(0);
                        });
                        it("should be baseMinDstGasLookup if gasLimit[1] is less with wxDAI", async () => {
                            await wxdai.connect(vitalik).approve(hub.address, MaxUint256);
                            await hub
                                .connect(vitalik)
                                .executeDepositRequest(
                                    OP_LZ_CHAIN_ID,
                                    user.address,
                                    0,
                                    AddressZero,
                                    [100, 9999],
                                    enoughMsgValues,
                                    { value: enoughTotalMsgValue }
                                );
                            const usedGasLimit = await getUsedGasLimitForExecuteCall();
                            expect(usedGasLimit).to.be.equal(10000);
                        });
                        it("should be gasLimit[1] if gasLimit[1] is more with wxDAI", async () => {
                            await wxdai.connect(vitalik).approve(hub.address, MaxUint256);
                            await hub
                                .connect(vitalik)
                                .executeDepositRequest(
                                    OP_LZ_CHAIN_ID,
                                    user.address,
                                    0,
                                    AddressZero,
                                    [100, 10001],
                                    enoughMsgValues,
                                    { value: enoughTotalMsgValue }
                                );
                            const usedGasLimit = await getUsedGasLimitForExecuteCall();
                            expect(usedGasLimit).to.be.equal(10001);
                        });
                        it("should be baseMinDstGasLookup if gasLimit[1] is less with xDAI", async () => {
                            await hub
                                .connect(vitalik)
                                .executeDepositRequestXDAI(
                                    OP_LZ_CHAIN_ID,
                                    user.address,
                                    0,
                                    AddressZero,
                                    [100, 9999],
                                    enoughMsgValues,
                                    { value: amount.add(enoughTotalMsgValue) }
                                );
                            const usedGasLimit = await getUsedGasLimitForExecuteCall();
                            expect(usedGasLimit).to.be.equal(10000);
                        });
                        it("should be gasLimit[1] if gasLimit[1] is more with xDAI", async () => {
                            await hub
                                .connect(vitalik)
                                .executeDepositRequestXDAI(
                                    OP_LZ_CHAIN_ID,
                                    user.address,
                                    0,
                                    AddressZero,
                                    [100, 10001],
                                    enoughMsgValues,
                                    { value: amount.add(enoughTotalMsgValue) }
                                );
                            const usedGasLimit = await getUsedGasLimitForExecuteCall();
                            expect(usedGasLimit).to.be.equal(10001);
                        });
                    });
                    context("when baseMinDstGasLookup is not set and minDstGasLookup is", async () => {
                        beforeEach(async () => {
                            await hub.connect(deployer).setMinDstGas(OP_LZ_CHAIN_ID, PT_SEND_DEPOSIT, 9000);
                            expect(await hub.baseMinDstGasLookup(PT_SEND_DEPOSIT)).to.be.equal(0);
                            expect(await hub.minDstGasLookup(OP_LZ_CHAIN_ID, PT_SEND_DEPOSIT)).to.be.equal(9000);
                        });
                        it("should be minDstGasLookup if gasLimit[1] is less with wxDAI", async () => {
                            await wxdai.connect(vitalik).approve(hub.address, MaxUint256);
                            await hub
                                .connect(vitalik)
                                .executeDepositRequest(
                                    OP_LZ_CHAIN_ID,
                                    user.address,
                                    0,
                                    AddressZero,
                                    [100, 8999],
                                    enoughMsgValues,
                                    { value: enoughTotalMsgValue }
                                );
                            const usedGasLimit = await getUsedGasLimitForExecuteCall();
                            expect(usedGasLimit).to.be.equal(9000);
                        });
                        it("should be gasLimit[1] if gasLimit[1] is more with wxDAI", async () => {
                            await wxdai.connect(vitalik).approve(hub.address, MaxUint256);
                            await hub
                                .connect(vitalik)
                                .executeDepositRequest(
                                    OP_LZ_CHAIN_ID,
                                    user.address,
                                    0,
                                    AddressZero,
                                    [100, 9001],
                                    enoughMsgValues,
                                    { value: enoughTotalMsgValue }
                                );
                            const usedGasLimit = await getUsedGasLimitForExecuteCall();
                            expect(usedGasLimit).to.be.equal(9001);
                        });
                        it("should be minDstGasLookup if gasLimit[1] is less with xDAI", async () => {
                            await hub
                                .connect(vitalik)
                                .executeDepositRequestXDAI(
                                    OP_LZ_CHAIN_ID,
                                    user.address,
                                    0,
                                    AddressZero,
                                    [100, 8999],
                                    enoughMsgValues,
                                    { value: amount.add(enoughTotalMsgValue) }
                                );
                            const usedGasLimit = await getUsedGasLimitForExecuteCall();
                            expect(usedGasLimit).to.be.equal(9000);
                        });
                        it("should be gasLimit[1] if gasLimit[1] is more with xDAI", async () => {
                            await hub
                                .connect(vitalik)
                                .executeDepositRequestXDAI(
                                    OP_LZ_CHAIN_ID,
                                    user.address,
                                    0,
                                    AddressZero,
                                    [100, 9001],
                                    enoughMsgValues,
                                    { value: amount.add(enoughTotalMsgValue) }
                                );
                            const usedGasLimit = await getUsedGasLimitForExecuteCall();
                            expect(usedGasLimit).to.be.equal(9001);
                        });
                    });
                    context("when both baseMinDstGasLookup and minDstGasLookup are set", async () => {
                        context("when baseMinDstGasLookup is greater than minDstGasLookup", async () => {
                            beforeEach(async () => {
                                await hub.connect(deployer).setBaseMinDstGas(PT_SEND_DEPOSIT, 20000);
                                await hub.connect(deployer).setMinDstGas(OP_LZ_CHAIN_ID, PT_SEND_DEPOSIT, 19000);
                                expect(await hub.baseMinDstGasLookup(PT_SEND_DEPOSIT)).to.be.equal(20000);
                                expect(await hub.minDstGasLookup(OP_LZ_CHAIN_ID, PT_SEND_DEPOSIT)).to.be.equal(19000);
                            });
                            it("should be baseMinDstGasLookup if gasLimit[1] is less with wxDAI", async () => {
                                await wxdai.connect(vitalik).approve(hub.address, MaxUint256);
                                await hub
                                    .connect(vitalik)
                                    .executeDepositRequest(
                                        OP_LZ_CHAIN_ID,
                                        user.address,
                                        0,
                                        AddressZero,
                                        [100, 19999],
                                        enoughMsgValues,
                                        { value: enoughTotalMsgValue }
                                    );
                                const usedGasLimit = await getUsedGasLimitForExecuteCall();
                                expect(usedGasLimit).to.be.equal(20000);
                            });
                            it("should be gasLimit[1] if gasLimit[1] is more with wxDAI", async () => {
                                await wxdai.connect(vitalik).approve(hub.address, MaxUint256);
                                await hub
                                    .connect(vitalik)
                                    .executeDepositRequest(
                                        OP_LZ_CHAIN_ID,
                                        user.address,
                                        0,
                                        AddressZero,
                                        [100, 20001],
                                        enoughMsgValues,
                                        { value: enoughTotalMsgValue }
                                    );
                                const usedGasLimit = await getUsedGasLimitForExecuteCall();
                                expect(usedGasLimit).to.be.equal(20001);
                            });
                            it("should be baseMinDstGasLookup if gasLimit[1] is less with xDAI", async () => {
                                await hub
                                    .connect(vitalik)
                                    .executeDepositRequestXDAI(
                                        OP_LZ_CHAIN_ID,
                                        user.address,
                                        0,
                                        AddressZero,
                                        [100, 19999],
                                        enoughMsgValues,
                                        { value: amount.add(enoughTotalMsgValue) }
                                    );
                                const usedGasLimit = await getUsedGasLimitForExecuteCall();
                                expect(usedGasLimit).to.be.equal(20000);
                            });
                            it("should be gasLimit[1] if gasLimit[1] is more with xDAI", async () => {
                                await hub
                                    .connect(vitalik)
                                    .executeDepositRequestXDAI(
                                        OP_LZ_CHAIN_ID,
                                        user.address,
                                        0,
                                        AddressZero,
                                        [100, 20001],
                                        enoughMsgValues,
                                        { value: amount.add(enoughTotalMsgValue) }
                                    );
                                const usedGasLimit = await getUsedGasLimitForExecuteCall();
                                expect(usedGasLimit).to.be.equal(20001);
                            });
                        });
                        context("when baseMinDstGasLookup is less than minDstGasLookup", async () => {
                            beforeEach(async () => {
                                await hub.connect(deployer).setBaseMinDstGas(PT_SEND_DEPOSIT, 29000);
                                await hub.connect(deployer).setMinDstGas(OP_LZ_CHAIN_ID, PT_SEND_DEPOSIT, 30000);
                                expect(await hub.baseMinDstGasLookup(PT_SEND_DEPOSIT)).to.be.equal(29000);
                                expect(await hub.minDstGasLookup(OP_LZ_CHAIN_ID, PT_SEND_DEPOSIT)).to.be.equal(30000);
                            });
                            it("should be minDstGasLookup if gasLimit[1] is less with wxDAI", async () => {
                                await wxdai.connect(vitalik).approve(hub.address, MaxUint256);
                                await hub
                                    .connect(vitalik)
                                    .executeDepositRequest(
                                        OP_LZ_CHAIN_ID,
                                        user.address,
                                        0,
                                        AddressZero,
                                        [100, 29999],
                                        enoughMsgValues,
                                        { value: enoughTotalMsgValue }
                                    );
                                const usedGasLimit = await getUsedGasLimitForExecuteCall();
                                expect(usedGasLimit).to.be.equal(30000);
                            });
                            it("should be gasLimit[1] if gasLimit[1] is more with wxDAI", async () => {
                                await wxdai.connect(vitalik).approve(hub.address, MaxUint256);
                                await hub
                                    .connect(vitalik)
                                    .executeDepositRequest(
                                        OP_LZ_CHAIN_ID,
                                        user.address,
                                        0,
                                        AddressZero,
                                        [100, 30001],
                                        enoughMsgValues,
                                        { value: enoughTotalMsgValue }
                                    );
                                const usedGasLimit = await getUsedGasLimitForExecuteCall();
                                expect(usedGasLimit).to.be.equal(30001);
                            });
                            it("should be minDstGasLookup if gasLimit[1] is less with xDAI", async () => {
                                await hub
                                    .connect(vitalik)
                                    .executeDepositRequestXDAI(
                                        OP_LZ_CHAIN_ID,
                                        user.address,
                                        0,
                                        AddressZero,
                                        [100, 29999],
                                        enoughMsgValues,
                                        { value: amount.add(enoughTotalMsgValue) }
                                    );
                                const usedGasLimit = await getUsedGasLimitForExecuteCall();
                                expect(usedGasLimit).to.be.equal(30000);
                            });
                            it("should be gasLimit[1] if gasLimit[1] is more with xDAI", async () => {
                                await hub
                                    .connect(vitalik)
                                    .executeDepositRequestXDAI(
                                        OP_LZ_CHAIN_ID,
                                        user.address,
                                        0,
                                        AddressZero,
                                        [100, 30001],
                                        enoughMsgValues,
                                        { value: amount.add(enoughTotalMsgValue) }
                                    );
                                const usedGasLimit = await getUsedGasLimitForExecuteCall();
                                expect(usedGasLimit).to.be.equal(30001);
                            });
                        });
                    });
                    context("when both baseMinDstGasLookup and minDstGasLookup are not set", async () => {
                        beforeEach(async () => {
                            expect(await hub.baseMinDstGasLookup(PT_SEND_DEPOSIT)).to.be.equal(0);
                            expect(await hub.minDstGasLookup(OP_LZ_CHAIN_ID, PT_SEND_DEPOSIT)).to.be.equal(0);
                        });
                        it("should be gasLimit[1] with wxDAI", async () => {
                            await wxdai.connect(vitalik).approve(hub.address, MaxUint256);
                            await hub
                                .connect(vitalik)
                                .executeDepositRequest(
                                    OP_LZ_CHAIN_ID,
                                    user.address,
                                    0,
                                    AddressZero,
                                    [100, 1],
                                    enoughMsgValues,
                                    { value: enoughTotalMsgValue }
                                );
                            const usedGasLimit = await getUsedGasLimitForExecuteCall();
                            expect(usedGasLimit).to.be.equal(1);
                        });
                        it("should be gasLimit[1] with xDAI", async () => {
                            await hub
                                .connect(vitalik)
                                .executeDepositRequestXDAI(
                                    OP_LZ_CHAIN_ID,
                                    user.address,
                                    0,
                                    AddressZero,
                                    [100, 2],
                                    enoughMsgValues,
                                    { value: amount.add(enoughTotalMsgValue) }
                                );
                            const usedGasLimit = await getUsedGasLimitForExecuteCall();
                            expect(usedGasLimit).to.be.equal(2);
                        });
                    });
                });

                context("when transaction succeeds", async () => {
                    describe("wxDAI transfer test", () => {
                        it("should transferFrom wxDAI exact amounts with wxDAI", async () => {
                            await wxdai.connect(vitalik).approve(hub.address, MaxUint256);
                            await expect(
                                hub
                                    .connect(vitalik)
                                    .executeDepositRequest(
                                        OP_LZ_CHAIN_ID,
                                        user.address,
                                        0,
                                        AddressZero,
                                        enoughGasLimits,
                                        enoughMsgValues,
                                        { value: enoughTotalMsgValue }
                                    )
                            ).to.changeTokenBalances(wxdai, [vitalik, hub], [amount.sub(fee).mul(-1), 0]);
                        });
                    });
                    describe("status update teest", () => {
                        it("should update depositRequest status with wxDAI", async () => {
                            await wxdai.connect(vitalik).approve(hub.address, MaxUint256);
                            await hub
                                .connect(vitalik)
                                .executeDepositRequest(
                                    OP_LZ_CHAIN_ID,
                                    user.address,
                                    0,
                                    AddressZero,
                                    enoughGasLimits,
                                    enoughMsgValues,
                                    { value: enoughTotalMsgValue }
                                );
                        });
                        it("should update depositRequest status with xDAI", async () => {
                            await hub
                                .connect(vitalik)
                                .executeDepositRequestXDAI(
                                    OP_LZ_CHAIN_ID,
                                    user.address,
                                    0,
                                    AddressZero,
                                    enoughGasLimits,
                                    enoughMsgValues,
                                    { value: amount.add(enoughTotalMsgValue) }
                                );
                        });
                        afterEach(async () => {
                            const req = await hub.depositRequest(OP_LZ_CHAIN_ID, user.address, 0);
                            expect(req.status).to.be.equal(Completed);
                        });
                    });
                    describe("oChai mint test", () => {
                        let pDeposit;
                        beforeEach(async () => {
                            pDeposit = await oChai.previewDeposit(amount.sub(fee));
                        });
                        it("should mint oChai to hub and transfer it to oChai and send LzMsg to srcChain with wxDAI", async () => {
                            await wxdai.connect(vitalik).approve(hub.address, MaxUint256);
                            await hub
                                .connect(vitalik)
                                .executeDepositRequest(
                                    OP_LZ_CHAIN_ID,
                                    user.address,
                                    0,
                                    AddressZero,
                                    enoughGasLimits,
                                    enoughMsgValues,
                                    { value: enoughTotalMsgValue }
                                );
                        });
                        it("should mint oChai to hub and transfer it to oChai and send LzMsg to srcChain with xDAI", async () => {
                            await hub
                                .connect(vitalik)
                                .executeDepositRequestXDAI(
                                    OP_LZ_CHAIN_ID,
                                    user.address,
                                    0,
                                    AddressZero,
                                    enoughGasLimits,
                                    enoughMsgValues,
                                    { value: amount.add(enoughTotalMsgValue) }
                                );
                        });
                        afterEach(async () => {
                            {
                                //Mint
                                const logs = await oChai.queryFilter(oChai.filters.Transfer(), "latest");
                                expect(logs.length).to.be.equal(2); //mint, transfer
                                const log0 = logs[0];
                                const decoded0 = oChai.interface.decodeEventLog("Transfer", log0.data, log0.topics);
                                expect(decoded0.from).to.be.equal(AddressZero);
                                expect(decoded0.to).to.be.equal(hub.address);
                                expect(decoded0.value).to.be.equal(pDeposit);

                                const log1 = logs[1];
                                const decoded1 = oChai.interface.decodeEventLog("Transfer", log1.data, log1.topics);
                                expect(decoded1.from).to.be.equal(hub.address);
                                expect(decoded1.to).to.be.equal(oChai.address);
                                expect(decoded1.value).to.be.equal(pDeposit);
                            }
                            {
                                //SendToChain
                                const logs = await oChai.queryFilter(oChai.filters.SendToChain(), "latest");
                                expect(logs.length).to.be.equal(1);
                                const log = logs[0];
                                const decoded = oChai.interface.decodeEventLog("SendToChain", log.data, log.topics);
                                expect(decoded._dstChainId).to.be.equal(OP_LZ_CHAIN_ID);
                                expect(decoded._from).to.be.equal(hub.address);
                                expect(decoded._toAddress).to.be.equal(user.address.toLowerCase());
                                expect(decoded._amount).to.be.equal(pDeposit);
                            }
                        });
                    });
                    describe("event emit test", () => {
                        let pDeposit;
                        beforeEach(async () => {
                            pDeposit = await oChai.previewDeposit(amount.sub(fee));
                        });
                        it("should emit ExecuteDepositRequest event with wxDAI", async () => {
                            await wxdai.connect(vitalik).approve(hub.address, MaxUint256);
                            await expect(
                                hub
                                    .connect(vitalik)
                                    .executeDepositRequest(
                                        OP_LZ_CHAIN_ID,
                                        user.address,
                                        0,
                                        AddressZero,
                                        enoughGasLimits,
                                        enoughMsgValues,
                                        { value: enoughTotalMsgValue }
                                    )
                            )
                                .to.emit(hub, "ExecuteDepositRequest")
                                .withArgs(OP_LZ_CHAIN_ID, user.address, 0, vitalik.address, amount, fee, pDeposit);
                        });
                        it("should emit ExecuteDepositRequest event with xDAI", async () => {
                            await expect(
                                hub
                                    .connect(vitalik)
                                    .executeDepositRequestXDAI(
                                        OP_LZ_CHAIN_ID,
                                        user.address,
                                        0,
                                        AddressZero,
                                        enoughGasLimits,
                                        enoughMsgValues,
                                        { value: amount.add(enoughTotalMsgValue) }
                                    )
                            )
                                .to.emit(hub, "ExecuteDepositRequest")
                                .withArgs(OP_LZ_CHAIN_ID, user.address, 0, vitalik.address, amount, fee, pDeposit);
                        });
                    });
                    describe("Excess msgValue refund test", () => {
                        let estimateFees;
                        let estimatedTotalFee;
                        beforeEach(async () => {
                            estimateFees = (
                                await hub.estimateExecuteDepositRequest(
                                    OP_LZ_CHAIN_ID,
                                    user.address,
                                    0,
                                    AddressZero,
                                    enoughGasLimits
                                )
                            ).lzNativeFees;

                            estimatedTotalFee = estimateFees[0].add(estimateFees[1]);
                        });
                        it("should refund excess msgValue to msg.sedner with wxDAI", async () => {
                            await wxdai.connect(vitalik).approve(hub.address, MaxUint256);
                            await expect(
                                hub
                                    .connect(vitalik)
                                    .executeDepositRequest(
                                        OP_LZ_CHAIN_ID,
                                        user.address,
                                        0,
                                        AddressZero,
                                        enoughGasLimits,
                                        [estimateFees[0].add(10), estimateFees[1].add(20)],
                                        { value: estimatedTotalFee.add(100) }
                                    )
                            ).to.changeEtherBalance(vitalik, estimatedTotalFee.mul(-1));
                        });
                        it("should refund excess msgValue to msg.sedner with xDAI", async () => {
                            const estimatedTotalMsgValue = estimatedTotalFee.add(amount).sub(fee);
                            await expect(
                                hub
                                    .connect(vitalik)
                                    .executeDepositRequestXDAI(
                                        OP_LZ_CHAIN_ID,
                                        user.address,
                                        0,
                                        AddressZero,
                                        enoughGasLimits,
                                        [estimateFees[0].add(10), estimateFees[1].add(20)],
                                        { value: estimatedTotalMsgValue.add(100) }
                                    )
                            ).to.changeEtherBalance(vitalik, estimatedTotalMsgValue.mul(-1));
                        });
                    });
                });
            });
        });
        describe("_cancel by LzReceive", () => {
            async function depositCall(
                srcChainId: BigNumberish,
                userAddress: string,
                nonce: BigNumberish,
                amount: BigNumberish,
                fee: BigNumberish
            ) {
                return callLzReceive(srcChainId, PT_SEND_DEPOSIT, userAddress, nonce, amount, fee);
            }
            async function cancelCall(
                srcChainId: BigNumberish,
                userAddress: string,
                nonce: BigNumberish,
                returnCallGaslimit: BigNumberish
            ) {
                return callLzReceive(
                    srcChainId,
                    PT_SEND_CANCEL,
                    userAddress,
                    nonce,
                    undefined,
                    undefined,
                    returnCallGaslimit
                );
            }

            const amount = utils.parseEther("100");
            const fee = utils.parseEther("0.2");

            beforeEach(async () => {
                await expect(depositCall(OP_LZ_CHAIN_ID, user.address, 0, amount, fee)).to.emit(
                    hub,
                    "RecordDepositRequest"
                );
            });

            describe("estimateForwardCancel", () => {
                const gaslimit = 300000;
                context("when depositRequest is invalid", async () => {
                    it("should revert", async () => {
                        await expect(
                            hub.estimateForwardCancel(OP_LZ_CHAIN_ID, user.address, 1, AddressZero, gaslimit)
                        ).to.be.revertedWithCustomError(hub, "InvalidStatus");
                        await expect(
                            hub.estimateForwardCancel(ARB_LZ_CHAIN_ID, deployer.address, 0, AddressZero, gaslimit)
                        ).to.be.revertedWithCustomError(hub, "InvalidStatus");
                    });
                });

                it("should return estimated fee corretly", async () => {
                    const estimatedFee = (
                        await hub.estimateForwardCancel(OP_LZ_CHAIN_ID, user.address, 0, AddressZero, gaslimit)
                    ).lzNativeFee;
                    await setBalance(hub.address, estimatedFee);
                    await expect(cancelCall(OP_LZ_CHAIN_ID, user.address, 0, gaslimit)).to.emit(
                        hub,
                        "ForwardCancelDepositToSrcChain"
                    );
                });
            });

            context("when depositRequest is invalid", async () => {
                it("should be failed", async () => {
                    await expect(cancelCall(OP_LZ_CHAIN_ID, user.address, 1, 300000)).to.emit(hub, "MessageFailed");

                    await expect(cancelCall(ARB_LZ_CHAIN_ID, deployer.address, 10, 300000)).to.emit(
                        hub,
                        "MessageFailed"
                    );
                });
            });

            describe("GasLimit test", () => {
                beforeEach(async () => {
                    await hub.connect(deployer).setBaseMinDstGas(PT_SEND_CANCEL, 10000);
                    await hub.connect(deployer).setMinDstGas(OP_LZ_CHAIN_ID, PT_SEND_CANCEL, 9000);
                    expect(await hub.baseMinDstGasLookup(PT_SEND_CANCEL)).to.be.equal(10000);
                    expect(await hub.minDstGasLookup(OP_LZ_CHAIN_ID, PT_SEND_CANCEL)).to.be.equal(9000);
                });
                it("should be equal fee if gaslimit is lte _getMinDstGas", async () => {
                    const fee0 = (await hub.estimateForwardCancel(OP_LZ_CHAIN_ID, user.address, 0, AddressZero, 0))
                        .lzNativeFee;
                    const fee1 = (await hub.estimateForwardCancel(OP_LZ_CHAIN_ID, user.address, 0, AddressZero, 5000))
                        .lzNativeFee;
                    const fee2 = (await hub.estimateForwardCancel(OP_LZ_CHAIN_ID, user.address, 0, AddressZero, 9000))
                        .lzNativeFee;
                    const fee3 = (await hub.estimateForwardCancel(OP_LZ_CHAIN_ID, user.address, 0, AddressZero, 9500))
                        .lzNativeFee;
                    const fee4 = (await hub.estimateForwardCancel(OP_LZ_CHAIN_ID, user.address, 0, AddressZero, 10000))
                        .lzNativeFee;
                    const fee5 = (await hub.estimateForwardCancel(OP_LZ_CHAIN_ID, user.address, 0, AddressZero, 10001))
                        .lzNativeFee;

                    expect(fee0).to.be.equal(fee1);
                    expect(fee0).to.be.equal(fee2);
                    expect(fee0).to.be.equal(fee3);
                    expect(fee0).to.be.equal(fee4);
                    expect(fee0).to.be.not.equal(fee5);
                });
                context("when gaslimit is lte _getMinDstGas", async () => {
                    let fee;
                    beforeEach(async () => {
                        fee = (await hub.estimateForwardCancel(OP_LZ_CHAIN_ID, user.address, 0, AddressZero, 10000))
                            .lzNativeFee;
                    });
                    it("should be failed if enoughFee is not airdroped before-0", async () => {
                        await setBalance(hub.address, fee.sub(1));
                        await expect(cancelCall(OP_LZ_CHAIN_ID, user.address, 0, 5000)).to.emit(hub, "MessageFailed");
                    });
                    it("should be failed if enoughFee is not airdroped before-1", async () => {
                        await setBalance(hub.address, fee.sub(1));
                        await expect(cancelCall(OP_LZ_CHAIN_ID, user.address, 0, 10000)).to.emit(hub, "MessageFailed");
                    });
                    it("should succeed if enoughFee is airdroped before", async () => {
                        await setBalance(hub.address, fee);
                        await expect(cancelCall(OP_LZ_CHAIN_ID, user.address, 0, 5000)).to.emit(
                            hub,
                            "ForwardCancelDepositToSrcChain"
                        );
                    });
                    it("should succeed if enoughFee is airdroped before", async () => {
                        await setBalance(hub.address, fee);
                        await expect(cancelCall(OP_LZ_CHAIN_ID, user.address, 0, 10000)).to.emit(
                            hub,
                            "ForwardCancelDepositToSrcChain"
                        );
                    });
                });
                context("when gaslimit is gte _getMinDstGas", async () => {
                    let fee;
                    beforeEach(async () => {
                        fee = (await hub.estimateForwardCancel(OP_LZ_CHAIN_ID, user.address, 0, AddressZero, 12345))
                            .lzNativeFee;
                    });
                    it("should be failed if enoughFee is not airdroped before", async () => {
                        await setBalance(hub.address, fee.sub(1));
                        await expect(cancelCall(OP_LZ_CHAIN_ID, user.address, 0, 12345)).to.emit(hub, "MessageFailed");
                    });
                    it("should succeed if enoughFee is airdroped before", async () => {
                        await setBalance(hub.address, fee);
                        await expect(cancelCall(OP_LZ_CHAIN_ID, user.address, 0, 12345)).to.emit(
                            hub,
                            "ForwardCancelDepositToSrcChain"
                        );
                    });
                });
            });

            context("when lzCancelCall is failed due to insufficient gas fee", async () => {
                it("should be able to retry with enough gas fee", async () => {
                    const gaslimit = 300000;
                    const estimatedFee = (
                        await hub.estimateForwardCancel(OP_LZ_CHAIN_ID, user.address, 0, AddressZero, gaslimit)
                    ).lzNativeFee;
                    await setBalance(hub.address, estimatedFee.sub(1));
                    await expect(cancelCall(OP_LZ_CHAIN_ID, user.address, 0, gaslimit)).to.emit(hub, "MessageFailed");

                    const lzCallNonce = 0;
                    const srcAddress = await hub.trustedRemoteLookup(OP_LZ_CHAIN_ID);

                    expect(await hub.failedMessages(OP_LZ_CHAIN_ID, srcAddress, lzCallNonce)).to.be.not.equal(
                        constants.HashZero
                    );

                    const payload = utils.defaultAbiCoder.encode(
                        ["uint16", "address", "uint256", "uint256"],
                        [PT_SEND_CANCEL, user.address, 0, gaslimit]
                    );
                    await expect(
                        hub.connect(vitalik).retryMessage(OP_LZ_CHAIN_ID, srcAddress, lzCallNonce, payload, {
                            value: 1,
                        })
                    ).to.emit(hub, "ForwardCancelDepositToSrcChain");
                });
            });

            context("when transaction succeeds", async () => {
                let fee;
                beforeEach(async () => {
                    fee = (await hub.estimateForwardCancel(OP_LZ_CHAIN_ID, user.address, 0, AddressZero, 300000))
                        .lzNativeFee;
                    await setBalance(hub.address, fee);
                });
                it("should update depositRequest status", async () => {
                    await cancelCall(OP_LZ_CHAIN_ID, user.address, 0, 300000);
                    const req = await hub.depositRequest(OP_LZ_CHAIN_ID, user.address, 0);
                    expect(req.status).to.be.equal(Cancelled);
                });

                it("should emit ForwardCancelDepositToSrcChain event", async () => {
                    await expect(cancelCall(OP_LZ_CHAIN_ID, user.address, 0, 300000))
                        .to.emit(hub, "ForwardCancelDepositToSrcChain")
                        .withArgs(OP_LZ_CHAIN_ID, user.address, 0);
                });

                it("should refund excess airdroped fee to user wallet on Gnosis", async () => {
                    await setBalance(hub.address, fee.add(123456));
                    await setBalance(user.address, 0);

                    expect(await ethers.provider.getBalance(hub.address)).to.be.equal(fee.add(123456));
                    expect(await ethers.provider.getBalance(user.address)).to.be.equal(0);

                    await cancelCall(OP_LZ_CHAIN_ID, user.address, 0, 300000);

                    expect(await ethers.provider.getBalance(hub.address)).to.be.equal(0);
                    expect(await ethers.provider.getBalance(user.address)).to.be.equal(123456);
                });
            });
            context("when depositRequest is completed already", async () => {
                it("should be failed", async () => {
                    const fee = (await hub.estimateForwardCancel(OP_LZ_CHAIN_ID, user.address, 0, AddressZero, 300000))
                        .lzNativeFee;
                    await setBalance(hub.address, fee);

                    await wxdai.connect(vitalik).approve(hub.address, MaxUint256);
                    await hub
                        .connect(vitalik)
                        .executeDepositRequest(
                            OP_LZ_CHAIN_ID,
                            user.address,
                            0,
                            AddressZero,
                            [300000, 300000],
                            [utils.parseEther("10"), utils.parseEther("10")],
                            { value: utils.parseEther("20") }
                        );
                    const req = await hub.depositRequest(OP_LZ_CHAIN_ID, user.address, 0);
                    expect(req.status).to.be.equal(Completed);

                    await expect(cancelCall(OP_LZ_CHAIN_ID, user.address, 0, 300000)).to.emit(hub, "MessageFailed");
                });
            });
            context("when depositRequest is cancelled already", async () => {
                it("should be failed", async () => {
                    const fee = (await hub.estimateForwardCancel(OP_LZ_CHAIN_ID, user.address, 0, AddressZero, 300000))
                        .lzNativeFee;
                    await setBalance(hub.address, fee);
                    await cancelCall(OP_LZ_CHAIN_ID, user.address, 0, 300000);
                    const req = await hub.depositRequest(OP_LZ_CHAIN_ID, user.address, 0);
                    expect(req.status).to.be.equal(Cancelled);

                    await setBalance(hub.address, fee);
                    await expect(cancelCall(OP_LZ_CHAIN_ID, user.address, 0, 300000)).to.emit(hub, "MessageFailed");
                });
            });
        });
    });
});
