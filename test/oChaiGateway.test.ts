import { OmniChaiGateway, OmniChai, IERC20 } from "../typechain-types";
import "dotenv/config";
import { ethers, network } from "hardhat";
import { expect } from "chai";

import {
    setBalance,
    SnapshotRestorer,
    takeSnapshot,
    time,
    setStorageAt,
} from "@nomicfoundation/hardhat-network-helpers";

import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { Wallet, utils, constants, BigNumberish, Signer } from "ethers";

import { endpoint } from "../constants/layerzero.json";
import { deployedAddress as oChaiAddress } from "../deployments/oChai.json";
import { mainnet as daiAddress } from "../constants/daiAddresses.json";

const { latest, setNextBlockTimestamp } = time;

const { AddressZero, MaxUint256 } = constants;
const OP_EVM_CHAIN_ID = 10;
const GNOSIS_LZ_CHAIN_ID = 145;
const Pending = 0;
const Completed = 1;
const Cancelled = 2;
const UniversalStorage = "0x985FEdb2d01130CCb1a7f9f9dB437cCFf24010e2";
const PT_SEND_DEPOSIT = 1;
const PT_SEND_CANCEL = 2;
const oChaiHubAddress = Wallet.createRandom().address;

describe("oChaiGateway", () => {
    let oChai: OmniChai;
    let dai: IERC20;
    let gw: OmniChaiGateway;
    let deployer: SignerWithAddress;
    let user: SignerWithAddress;
    let vitalik: SignerWithAddress;
    let snapshot: SnapshotRestorer;
    let minimum_fee_Rate: BigNumberish;

    before(async () => {
        const chainId = network.config.chainId;
        expect(chainId).to.be.equal(OP_EVM_CHAIN_ID); //for convinience, I use OP_EVM_CHAIN_ID as default

        deployer = await ethers.getImpersonatedSigner(process.env.DEPLOYER_ADDRESS);
        [user, vitalik] = await ethers.getSigners();

        await setBalance(deployer.address, utils.parseEther("100000"));
        await setBalance(user.address, utils.parseEther("100000"));
        await setBalance(vitalik.address, utils.parseEther("100000"));

        const networkName = (await ethers.provider.getNetwork()).name;
        expect(networkName).to.be.equal("optimism");

        oChai = (await ethers.getContractAt("OmniChai", oChaiAddress[chainId])) as OmniChai;
        dai = (await ethers.getContractAt("IERC20", daiAddress.optimism)) as IERC20;

        gw = (await (
            await ethers.getContractFactory("OmniChaiGateway", deployer)
        ).deploy(UniversalStorage, GNOSIS_LZ_CHAIN_ID, deployer.address)) as OmniChaiGateway;

        // for testing, set wards[deployer] in dai to 1, which makes deployer be able to mint dai. A slot of wards of dai on Optimism is 0.
        await setStorageAt(
            dai.address,
            utils.keccak256(utils.defaultAbiCoder.encode(["address", "uint256"], [deployer.address, 0])),
            1
        );

        const amount = utils.parseEther("10000");
        const IERC20Mintable = new utils.Interface(["function mint(address to, uint256 value)"]);

        await deployer.sendTransaction({
            to: dai.address,
            data: IERC20Mintable.encodeFunctionData("mint", [deployer.address, amount.mul(100000)]),
        });
        expect(await dai.balanceOf(deployer.address)).to.be.equal(amount.mul(100000));
        await dai.connect(deployer).transfer(user.address, amount);
        expect(await dai.balanceOf(user.address)).to.be.equal(amount);

        minimum_fee_Rate = await gw.MINIMUM_FEE_RATE();

        snapshot = await takeSnapshot();
    });

    beforeEach(async () => {
        await snapshot.restore();
    });

    describe("oChaiGateway", () => {
        context("when deployed", async () => {
            it("should return correct initial values", async () => {
                expect(await gw.CHAIN_ID_GNOSIS()).to.be.equal(GNOSIS_LZ_CHAIN_ID);
                expect(await gw.oChai()).to.be.equal(oChai.address);
                expect(await gw.dai()).to.be.equal(dai.address);

                expect(await gw.owner()).to.be.equal(deployer.address);

                expect(await gw.depositNonce(user.address)).to.be.equal(0);
                expect(await gw.redeemNonce(user.address)).to.be.equal(0);

                await expect(gw.depositRequest(user.address, 0)).to.be.reverted;
                await expect(gw.depositRequest(user.address, 1)).to.be.reverted;
                await expect(gw.redeemRequest(user.address, 0)).to.be.reverted;
                await expect(gw.redeemRequest(user.address, 1)).to.be.reverted;
            });
        });
        describe("functions related to Deposit", () => {
            describe("requestDeposit", () => {
                const amount = utils.parseEther("10");
                const highDAIFee = amount.div(100);
                const highLZFee = utils.parseEther("1");
                it("should revert if trustedRemoted is not set", async () => {
                    await dai.connect(user).approve(gw.address, amount);

                    await expect(
                        gw.connect(user).requestDeposit(amount, highDAIFee, user.address, AddressZero, 210000, {
                            value: highLZFee,
                        })
                    ).to.be.reverted;
                    await gw.setTrustedRemoteAddress(GNOSIS_LZ_CHAIN_ID, oChaiHubAddress);
                    await gw
                        .connect(user)
                        .requestDeposit(amount, highDAIFee, user.address, AddressZero, 210000, { value: highLZFee });
                });

                it("should revert if not approved", async () => {
                    await gw.setTrustedRemoteAddress(GNOSIS_LZ_CHAIN_ID, oChaiHubAddress);

                    await expect(
                        gw.connect(user).requestDeposit(amount, highDAIFee, user.address, AddressZero, 210000, {
                            value: highLZFee,
                        })
                    ).to.be.reverted;
                    await dai.connect(user).approve(gw.address, amount);
                    await gw
                        .connect(user)
                        .requestDeposit(amount, highDAIFee, user.address, AddressZero, 210000, { value: highLZFee });
                });

                context("when trustedRemote is set and dai is approved", async () => {
                    beforeEach(async () => {
                        await gw.setTrustedRemoteAddress(GNOSIS_LZ_CHAIN_ID, oChaiHubAddress);
                        await dai.connect(user).approve(gw.address, amount.mul(10));
                    });

                    it("should revert if amount is zero", async () => {
                        await expect(
                            gw.connect(user).requestDeposit(0, highDAIFee, user.address, AddressZero, 210000, {
                                value: highLZFee,
                            })
                        ).to.be.revertedWithCustomError(gw, "InvalidAmount");
                    });

                    it("should increase depositNonce", async () => {
                        expect(await gw.depositNonce(user.address)).to.be.equal(0);
                        await gw.connect(user).requestDeposit(amount, highDAIFee, user.address, AddressZero, 210000, {
                            value: highLZFee,
                        });
                        expect(await gw.depositNonce(user.address)).to.be.equal(1);
                    });

                    it("should revert if nonce is wrong", async () => {
                        await expect(gw.depositRequest(user.address, 0)).to.be.reverted;
                        await expect(gw.depositRequest(user.address, 1)).to.be.reverted;

                        await gw.connect(user).requestDeposit(amount, highDAIFee, user.address, AddressZero, 210000, {
                            value: highLZFee,
                        });

                        expect(await gw.depositRequest(user.address, 0)).to.exist;
                        await expect(gw.depositRequest(user.address, 1)).to.be.reverted;

                        await gw.connect(user).requestDeposit(amount, highDAIFee, user.address, AddressZero, 210000, {
                            value: highLZFee,
                        });
                        expect(await gw.depositRequest(user.address, 0)).to.exist;
                        expect(await gw.depositRequest(user.address, 1)).to.exist;

                        await expect(gw.depositRequest(vitalik.address, 0)).to.be.reverted;
                    });

                    it("should save correct information", async () => {
                        await gw.connect(user).requestDeposit(amount, highDAIFee, user.address, AddressZero, 210000, {
                            value: highLZFee,
                        });

                        const req = await gw.depositRequest(user.address, 0);
                        expect(req.status).to.be.equal(Pending);
                        expect(req.amount).to.be.equal(amount);
                        expect(req.fee).to.be.equal(highDAIFee);
                        expect(req.eligibleTaker).to.be.equal(AddressZero);
                    });

                    it("should emit RequestDeposit event", async () => {
                        await expect(
                            gw.connect(user).requestDeposit(amount, highDAIFee, user.address, AddressZero, 210000, {
                                value: highLZFee,
                            })
                        )
                            .to.emit(gw, "RequestDeposit")
                            .withArgs(user.address, 0, amount, highDAIFee);
                        await expect(
                            gw
                                .connect(user)
                                .requestDeposit(amount.sub(1), amount.div(200), user.address, AddressZero, 210000, {
                                    value: highLZFee,
                                })
                        )
                            .to.emit(gw, "RequestDeposit")
                            .withArgs(user.address, 1, amount.sub(1), amount.div(200));
                    });

                    it("should revert if minDstGasLookup is set and gasLimit is too low", async () => {
                        await gw.setMinDstGas(GNOSIS_LZ_CHAIN_ID, PT_SEND_DEPOSIT, 100000);
                        await expect(
                            gw.connect(user).requestDeposit(amount, highDAIFee, user.address, AddressZero, 10000, {
                                value: highLZFee,
                            })
                        )
                            .to.be.revertedWithCustomError(gw, "TooLowGasLimit")
                            .withArgs(100000, 10000);
                        await gw.connect(user).requestDeposit(amount, highDAIFee, user.address, AddressZero, 100000, {
                            value: highLZFee,
                        });
                    });

                    it("should lock dai correctly", async () => {
                        expect(await dai.balanceOf(gw.address)).to.be.equal(0);
                        await expect(
                            gw.connect(user).requestDeposit(amount, highDAIFee, user.address, AddressZero, 210000, {
                                value: highLZFee,
                            })
                        ).to.changeTokenBalances(dai, [user, gw, deployer], [amount.mul(-1), amount, 0]);

                        expect(await dai.balanceOf(gw.address)).to.be.equal(amount);
                    });

                    it("should revert if lzFee is not enough", async () => {
                        const lzFee = (await gw.estimateFeeRequestDeposit(amount, highDAIFee, AddressZero, 210000))
                            .lzNativeFee;

                        await expect(
                            gw.connect(user).requestDeposit(amount, highDAIFee, user.address, AddressZero, 210000, {
                                value: lzFee.sub(1),
                            })
                        ).to.be.reverted;

                        await gw
                            .connect(user)
                            .requestDeposit(amount, highDAIFee, user.address, AddressZero, 210000, { value: lzFee });
                    });

                    it("should refund if lzFee is too much", async () => {
                        const lzFee = (await gw.estimateFeeRequestDeposit(amount, highDAIFee, AddressZero, 210000))
                            .lzNativeFee;

                        await expect(
                            gw.connect(user).requestDeposit(amount, highDAIFee, vitalik.address, AddressZero, 210000, {
                                value: lzFee.add(15),
                            })
                        ).to.changeEtherBalance(vitalik, 15);
                    });

                    it("should revert if fee is lower than minimum fee", async () => {
                        const minFee = amount.mul(minimum_fee_Rate).div(10000);

                        await expect(
                            gw.connect(user).requestDeposit(amount, minFee.sub(1), user.address, AddressZero, 210000, {
                                value: highLZFee,
                            })
                        )
                            .to.be.revertedWithCustomError(gw, "TooLowFee")
                            .withArgs(minFee, minFee.sub(1));
                    });
                });
            });
            async function callLzReceive(
                packetType: BigNumberish,
                userAddress: string,
                nonce: BigNumberish,
                takerAddress?: string
            ) {
                const epImp = await ethers.getImpersonatedSigner(endpoint.mainnet.optimism);
                await setBalance(epImp.address, utils.parseEther("10000"));
                const tra = await gw.trustedRemoteLookup(GNOSIS_LZ_CHAIN_ID);
                expect(utils.hexDataLength(tra)).to.be.equal(40);
                let payload;

                if (packetType === PT_SEND_DEPOSIT) {
                    expect(takerAddress).to.be.not.undefined;
                    payload = utils.defaultAbiCoder.encode(
                        ["uint16", "address", "uint256", "address"],
                        [PT_SEND_DEPOSIT, userAddress, nonce, takerAddress]
                    );
                } else if (packetType === PT_SEND_CANCEL) {
                    payload = utils.defaultAbiCoder.encode(
                        ["uint16", "address", "uint256"],
                        [PT_SEND_CANCEL, userAddress, nonce]
                    );
                } else {
                    throw new Error("Invalid packetType");
                }
                return gw.connect(epImp).lzReceive(GNOSIS_LZ_CHAIN_ID, tra, 0, payload);
            }
            describe("requestCancelDeposit", () => {
                const amount = utils.parseEther("10");
                const highDAIFee = amount.div(100);
                const highLZFee = utils.parseEther("1");
                const airdropNative = utils.parseEther("0.05");

                beforeEach(async () => {
                    await gw.setTrustedRemoteAddress(GNOSIS_LZ_CHAIN_ID, oChaiHubAddress);
                    await dai.connect(user).approve(gw.address, amount.mul(10));
                    await gw
                        .connect(user)
                        .requestDeposit(amount, highDAIFee, user.address, AddressZero, 210000, { value: highLZFee });
                });

                it("should revert if nonce is wrong", async () => {
                    await expect(
                        gw
                            .connect(user)
                            .requestCancelDeposit(1, user.address, AddressZero, 210000, airdropNative, 210000, {
                                value: highLZFee,
                            })
                    ).to.be.reverted;

                    await gw
                        .connect(user)
                        .requestCancelDeposit(0, user.address, AddressZero, 210000, airdropNative, 210000, {
                            value: highLZFee,
                        });

                    await expect(
                        gw
                            .connect(vitalik)
                            .requestCancelDeposit(0, vitalik.address, AddressZero, 210000, airdropNative, 210000, {
                                value: highLZFee,
                            })
                    ).to.be.reverted;
                });
                it("should revert if minDstGasLookup is set and gasLimit is too low", async () => {
                    await gw.setMinDstGas(GNOSIS_LZ_CHAIN_ID, PT_SEND_CANCEL, 100000);
                    await expect(
                        gw
                            .connect(user)
                            .requestCancelDeposit(0, user.address, AddressZero, 10000, airdropNative, 210000, {
                                value: highLZFee,
                            })
                    )
                        .to.be.revertedWithCustomError(gw, "TooLowGasLimit")
                        .withArgs(100000, 10000);
                    await gw
                        .connect(user)
                        .requestCancelDeposit(0, user.address, AddressZero, 100000, airdropNative, 210000, {
                            value: highLZFee,
                        });
                });
                it("should revert if airdropNative is not set", async () => {
                    await expect(
                        gw.connect(user).requestCancelDeposit(0, user.address, AddressZero, 210000, 0, 210000, {
                            value: highLZFee,
                        })
                    ).to.be.revertedWithCustomError(gw, "InvalidNativeForDst");
                    await gw.connect(user).requestCancelDeposit(0, user.address, AddressZero, 210000, 1, 210000, {
                        value: highLZFee,
                    });
                });
                it("should emit RequestCancelDeposit event", async () => {
                    await expect(
                        gw
                            .connect(user)
                            .requestCancelDeposit(0, user.address, AddressZero, 210000, airdropNative, 210000, {
                                value: highLZFee,
                            })
                    )
                        .to.emit(gw, "RequestCancelDeposit")
                        .withArgs(user.address, 0);
                });
                it("should not change depositRequest", async () => {
                    const req0 = await gw.depositRequest(user.address, 0);
                    await gw
                        .connect(user)
                        .requestCancelDeposit(0, user.address, AddressZero, 210000, airdropNative, 210000, {
                            value: highLZFee,
                        });
                    const req1 = await gw.depositRequest(user.address, 0);
                    expect(req0).to.be.deep.equal(req1);
                });
                it("should not change DAI balance", async () => {
                    await expect(
                        gw
                            .connect(user)
                            .requestCancelDeposit(0, user.address, AddressZero, 210000, airdropNative, 210000, {
                                value: highLZFee,
                            })
                    ).to.changeTokenBalances(dai, [user, gw, deployer], [0, 0, 0]);
                });
                it("should revert if lzFee is not enough", async () => {
                    const lzFee = (
                        await gw.estimateFeeRequestCancelDeposit(0, AddressZero, 210000, airdropNative, 210000)
                    ).lzNativeFee;

                    await expect(
                        gw
                            .connect(user)
                            .requestCancelDeposit(0, user.address, AddressZero, 210000, airdropNative, 210000, {
                                value: lzFee.sub(1),
                            })
                    ).to.be.reverted;

                    await gw
                        .connect(user)
                        .requestCancelDeposit(0, user.address, AddressZero, 210000, airdropNative, 210000, {
                            value: lzFee,
                        });
                });
                it("should refund if lzFee is too much", async () => {
                    const lzFee = (
                        await gw.estimateFeeRequestCancelDeposit(0, AddressZero, 210000, airdropNative, 210000)
                    ).lzNativeFee;

                    await expect(
                        gw
                            .connect(user)
                            .requestCancelDeposit(0, vitalik.address, AddressZero, 210000, airdropNative, 210000, {
                                value: lzFee.add(15),
                            })
                    ).to.changeEtherBalance(vitalik, 15);
                });
                it("should revert if status is Completed", async () => {
                    await callLzReceive(PT_SEND_DEPOSIT, user.address, 0, vitalik.address);

                    const req0 = await gw.depositRequest(user.address, 0);
                    expect(req0.status).to.be.equal(Completed);
                    expect(req0.amount).to.be.equal(amount);
                    expect(req0.fee).to.be.equal(highDAIFee);
                    expect(req0.eligibleTaker).to.be.equal(vitalik.address);

                    await expect(
                        gw
                            .connect(user)
                            .requestCancelDeposit(0, user.address, AddressZero, 210000, airdropNative, 210000, {
                                value: highLZFee,
                            })
                    ).to.be.revertedWithCustomError(gw, "InvalidStatus");
                });
                it("should revert if status is Cancelled", async () => {
                    await callLzReceive(PT_SEND_CANCEL, user.address, 0);

                    const req0 = await gw.depositRequest(user.address, 0);
                    expect(req0.status).to.be.equal(Cancelled);
                    expect(req0.amount).to.be.equal(amount);
                    expect(req0.fee).to.be.equal(highDAIFee);
                    expect(req0.eligibleTaker).to.be.equal(AddressZero);

                    await expect(
                        gw
                            .connect(user)
                            .requestCancelDeposit(0, user.address, AddressZero, 210000, airdropNative, 210000, {
                                value: highLZFee,
                            })
                    ).to.be.revertedWithCustomError(gw, "InvalidStatus");
                });
            });
            describe("executeDepositReqeust", () => {
                // This functionality is executed automatically by lzReceive normally.
                // This is just for testing.
                const amount = utils.parseEther("10");
                const highDAIFee = amount.div(100);
                const highLZFee = utils.parseEther("1");

                beforeEach(async () => {
                    await gw.setTrustedRemoteAddress(GNOSIS_LZ_CHAIN_ID, oChaiHubAddress);
                    await dai.connect(user).approve(gw.address, amount.mul(10));
                    await gw
                        .connect(user)
                        .requestDeposit(amount, highDAIFee, user.address, AddressZero, 210000, { value: highLZFee });
                });
                it("should revert if already cancelled", async () => {
                    await callLzReceive(PT_SEND_CANCEL, user.address, 0);
                    const req0 = await gw.depositRequest(user.address, 0);
                    expect(req0.status).to.be.equal(Cancelled);
                    await expect(gw.connect(user).executeDepositRequest(user.address, 0)).to.be.revertedWithCustomError(
                        gw,
                        "InvalidStatus"
                    );
                    await expect(
                        gw.connect(vitalik).executeDepositRequest(user.address, 0)
                    ).to.be.revertedWithCustomError(gw, "InvalidStatus");
                });
                it("should revert if already completed", async () => {
                    await callLzReceive(PT_SEND_DEPOSIT, user.address, 0, vitalik.address);
                    const req0 = await gw.depositRequest(user.address, 0);
                    expect(req0.status).to.be.equal(Completed);
                    await expect(gw.connect(user).executeDepositRequest(user.address, 0)).to.be.revertedWithCustomError(
                        gw,
                        "InvalidStatus"
                    );
                    await expect(
                        gw.connect(vitalik).executeDepositRequest(user.address, 0)
                    ).to.be.revertedWithCustomError(gw, "InvalidStatus");
                });
                it("should update depositRequest", async () => {
                    await callLzReceive(PT_SEND_DEPOSIT, user.address, 0, vitalik.address);
                    const req0 = await gw.depositRequest(user.address, 0);
                    expect(req0.status).to.be.equal(Completed);
                    expect(req0.amount).to.be.equal(amount);
                    expect(req0.fee).to.be.equal(highDAIFee);
                    expect(req0.eligibleTaker).to.be.equal(vitalik.address);
                });
                it("should transfer dai to eligibleTaker", async () => {
                    await expect(
                        callLzReceive(PT_SEND_DEPOSIT, user.address, 0, vitalik.address)
                    ).to.changeTokenBalances(dai, [gw, user, vitalik], [amount.mul(-1), 0, amount]);
                });
                it("should emit events", async () => {
                    await expect(callLzReceive(PT_SEND_DEPOSIT, user.address, 0, vitalik.address))
                        .to.emit(gw, "UpdateEligibleTaker")
                        .withArgs(user.address, 0, vitalik.address)
                        .to.emit(gw, "ExecuteDepositRequest")
                        .withArgs(user.address, 0, vitalik.address, amount);
                });
            });
        });
        describe("functions related to Redeem", () => {
            const oChaiAmount = utils.parseEther("10000");
            async function mintOChai(to: string, amount: BigNumberish) {
                const epImp = await ethers.getImpersonatedSigner(endpoint.mainnet.optimism);
                await setBalance(epImp.address, utils.parseEther("10000"));
                const tra = await oChai.trustedRemoteLookup(GNOSIS_LZ_CHAIN_ID);
                expect(utils.hexDataLength(tra)).to.be.equal(40);
                return oChai
                    .connect(epImp)
                    .lzReceive(
                        GNOSIS_LZ_CHAIN_ID,
                        tra,
                        0,
                        utils.defaultAbiCoder.encode(["uint16", "bytes", "uint256"], [0, to, amount])
                    );
            }
            beforeEach(async () => {
                await mintOChai(user.address, oChaiAmount);
            });
            describe("requestRedeem", () => {
                const amount = utils.parseEther("100");
                const desiredDai = utils.parseEther("101");
                const deadline = 2000000000;
                it("should revert if oChai not approved", async () => {
                    await expect(gw.connect(user).requestRedeem(amount, desiredDai, deadline)).to.be.reverted;
                    await oChai.connect(user).approve(gw.address, amount);
                    await gw.connect(user).requestRedeem(amount, desiredDai, deadline);
                });
                describe("when oChai is approved", () => {
                    beforeEach(async () => {
                        await oChai.connect(user).approve(gw.address, amount.mul(2));
                    });

                    it("should revert if amount is zero", async () => {
                        await expect(
                            gw.connect(user).requestRedeem(0, desiredDai, deadline)
                        ).to.be.revertedWithCustomError(gw, "InvalidAmount");
                    });
                    it("should revert if desiredDai is zero", async () => {
                        await expect(gw.connect(user).requestRedeem(amount, 0, deadline)).to.be.revertedWithCustomError(
                            gw,
                            "InvalidAmount"
                        );
                    });
                    it("should revert if deadline is passed", async () => {
                        const lastTs = await latest();
                        await expect(
                            gw.connect(user).requestRedeem(amount, desiredDai, lastTs)
                        ).to.be.revertedWithCustomError(gw, "InvalidDeadline");
                    });
                    it("should revert if amount is bigger than allowance", async () => {
                        await expect(gw.connect(user).requestRedeem(amount.mul(3), desiredDai, deadline)).to.be
                            .reverted;
                    });
                    it("should revert if amount is bigger than balanceOf", async () => {
                        await oChai.connect(user).approve(gw.address, MaxUint256);
                        expect(await oChai.balanceOf(user.address)).to.be.equal(oChaiAmount);
                        await expect(gw.connect(user).requestRedeem(oChaiAmount.add(1), desiredDai, deadline)).to.be
                            .reverted;
                    });
                    it("should increase redeemNonce", async () => {
                        expect(await gw.redeemNonce(user.address)).to.be.equal(0);
                        await gw.connect(user).requestRedeem(amount, desiredDai, deadline);
                        expect(await gw.redeemNonce(user.address)).to.be.equal(1);
                    });
                    it("should revert if nonce is wrong", async () => {
                        await expect(gw.redeemRequest(user.address, 0)).to.be.reverted;
                        await expect(gw.redeemRequest(user.address, 1)).to.be.reverted;

                        await gw.connect(user).requestRedeem(amount, desiredDai, deadline);

                        expect(await gw.redeemRequest(user.address, 0)).to.exist;
                        await expect(gw.redeemRequest(user.address, 1)).to.be.reverted;

                        await gw.connect(user).requestRedeem(amount, desiredDai, deadline);
                        expect(await gw.redeemRequest(user.address, 0)).to.exist;
                        expect(await gw.redeemRequest(user.address, 1)).to.exist;

                        await expect(gw.redeemRequest(vitalik.address, 0)).to.be.reverted;
                    });
                    it("should store correct information", async () => {
                        await gw.connect(user).requestRedeem(amount, desiredDai, deadline);

                        const req = await gw.redeemRequest(user.address, 0);
                        expect(req.status).to.be.equal(Pending);
                        expect(req.amount).to.be.equal(amount);
                        expect(req.desiredDai).to.be.equal(desiredDai);
                        expect(req.deadline).to.be.equal(deadline);
                    });
                    it("should emit RequestRedeem event", async () => {
                        await expect(gw.connect(user).requestRedeem(amount, desiredDai, deadline))
                            .to.emit(gw, "RequestRedeem")
                            .withArgs(user.address, 0, amount, desiredDai, deadline);

                        await expect(gw.connect(user).requestRedeem(amount.sub(1), desiredDai, deadline))
                            .to.emit(gw, "RequestRedeem")
                            .withArgs(user.address, 1, amount.sub(1), desiredDai, deadline);
                    });
                    it("should transfer oChai to gw", async () => {
                        expect(await oChai.balanceOf(gw.address)).to.be.equal(0);
                        await expect(
                            gw.connect(user).requestRedeem(amount, desiredDai, deadline)
                        ).to.changeTokenBalances(oChai, [user, gw], [amount.mul(-1), amount]);
                        expect(await oChai.balanceOf(gw.address)).to.be.equal(amount);
                    });
                });
            });
            describe("requestCancelRedeem", () => {
                const amount = utils.parseEther("100");
                const desiredDai = utils.parseEther("101");
                const deadline = 2000000000;

                beforeEach(async () => {
                    await oChai.connect(user).approve(gw.address, amount.mul(2));
                    await gw.connect(user).requestRedeem(amount, desiredDai, deadline);
                });

                it("should revert if nonce is wrong", async () => {
                    await expect(gw.redeemRequest(user.address, 0)).to.exist;
                    await expect(gw.redeemRequest(user.address, 1)).to.be.reverted;

                    await expect(gw.connect(user).requestCancelRedeem(1)).to.be.reverted;

                    await gw.connect(user).requestCancelRedeem(0);

                    await expect(gw.connect(vitalik).requestCancelRedeem(0)).to.be.reverted;
                });
                it("should update status", async () => {
                    await gw.connect(user).requestCancelRedeem(0);
                    expect((await gw.redeemRequest(user.address, 0)).status).to.be.equal(Cancelled);
                });
                it("should revert if status is Cancelled", async () => {
                    await gw.connect(user).requestCancelRedeem(0);
                    expect((await gw.redeemRequest(user.address, 0)).status).to.be.equal(Cancelled);

                    await expect(gw.connect(user).requestCancelRedeem(0)).to.be.revertedWithCustomError(
                        gw,
                        "InvalidStatus"
                    );
                });
                it("should revert if status is Completed", async () => {
                    await dai.connect(deployer).transfer(vitalik.address, desiredDai);
                    await dai.connect(vitalik).approve(gw.address, desiredDai);
                    await gw.connect(vitalik).executeRedeemRequest(user.address, 0);
                    expect((await gw.redeemRequest(user.address, 0)).status).to.be.equal(Completed);

                    await expect(gw.connect(user).requestCancelRedeem(0)).to.be.revertedWithCustomError(
                        gw,
                        "InvalidStatus"
                    );
                });
                it("should transfer oChai to user", async () => {
                    await expect(gw.connect(user).requestCancelRedeem(0)).to.changeTokenBalances(
                        oChai,
                        [gw, user],
                        [amount.mul(-1), amount]
                    );
                });
                it("should emit RequestCancelRedeem event", async () => {
                    await expect(gw.connect(user).requestCancelRedeem(0))
                        .to.emit(gw, "RequestCancelRedeem")
                        .withArgs(user.address, 0);
                });
            });
            describe("executeRedeemRequest", () => {
                const amount = utils.parseEther("100");
                const desiredDai = utils.parseEther("101");
                const deadline = 2000000000;

                beforeEach(async () => {
                    await oChai.connect(user).approve(gw.address, amount.mul(2));
                    await gw.connect(user).requestRedeem(amount, desiredDai, deadline);
                    await dai.connect(deployer).transfer(vitalik.address, desiredDai);
                });

                it("should revert if dai not approved", async () => {
                    await expect(gw.connect(vitalik).executeRedeemRequest(user.address, 0)).to.be.reverted;
                    await dai.connect(vitalik).approve(gw.address, desiredDai);
                    await gw.connect(vitalik).executeRedeemRequest(user.address, 0);
                });

                describe("when dai is approved", () => {
                    beforeEach(async () => {
                        await dai.connect(vitalik).approve(gw.address, MaxUint256);
                    });

                    it("should revert if nonce is wrong", async () => {
                        await expect(gw.connect(vitalik).executeRedeemRequest(user.address, 1)).to.be.reverted;
                        await gw.connect(vitalik).executeRedeemRequest(user.address, 0);
                    });
                    it("should revert if deadline is passed", async () => {
                        await setNextBlockTimestamp(deadline + 1);
                        await expect(
                            gw.connect(vitalik).executeRedeemRequest(user.address, 0)
                        ).to.be.revertedWithCustomError(gw, "ExpiredRequest");
                    });
                    it("should revert if status is Cancelled", async () => {
                        await gw.connect(user).requestCancelRedeem(0);
                        expect((await gw.redeemRequest(user.address, 0)).status).to.be.equal(Cancelled);

                        await expect(
                            gw.connect(vitalik).executeRedeemRequest(user.address, 0)
                        ).to.be.revertedWithCustomError(gw, "InvalidStatus");
                    });
                    it("should revert if status is Completed", async () => {
                        await gw.connect(vitalik).executeRedeemRequest(user.address, 0);
                        expect((await gw.redeemRequest(user.address, 0)).status).to.be.equal(Completed);

                        await expect(
                            gw.connect(vitalik).executeRedeemRequest(user.address, 0)
                        ).to.be.revertedWithCustomError(gw, "InvalidStatus");
                    });
                    it("should revert if amount of dai is not enough", async () => {
                        await dai.connect(vitalik).transfer(deployer.address, 1);
                        expect(await dai.balanceOf(vitalik.address)).to.be.equal(desiredDai.sub(1));
                        await expect(gw.connect(vitalik).executeRedeemRequest(user.address, 0)).to.be.reverted;
                    });
                    it("should transfer dai to user and oChai to caller", async () => {
                        const oChaiBalance0 = {};
                        oChaiBalance0["gw"] = await oChai.balanceOf(gw.address);
                        oChaiBalance0["user"] = await oChai.balanceOf(user.address);
                        oChaiBalance0["vitalik"] = await oChai.balanceOf(vitalik.address);

                        await expect(gw.connect(vitalik).executeRedeemRequest(user.address, 0)).to.changeTokenBalances(
                            dai,
                            [gw, vitalik, user],
                            [0, desiredDai.mul(-1), desiredDai]
                        );
                        const oChaiBalance1 = {};
                        oChaiBalance1["gw"] = await oChai.balanceOf(gw.address);
                        oChaiBalance1["user"] = await oChai.balanceOf(user.address);
                        oChaiBalance1["vitalik"] = await oChai.balanceOf(vitalik.address);

                        expect(oChaiBalance1["gw"]).to.be.equal(oChaiBalance0["gw"].sub(amount));
                        expect(oChaiBalance1["user"]).to.be.equal(oChaiBalance0["user"]);
                        expect(oChaiBalance1["vitalik"]).to.be.equal(oChaiBalance0["vitalik"].add(amount));
                    });
                    it("should update status", async () => {
                        await gw.connect(vitalik).executeRedeemRequest(user.address, 0);
                        expect((await gw.redeemRequest(user.address, 0)).status).to.be.equal(Completed);
                    });
                });
            });
        });
    });
});
