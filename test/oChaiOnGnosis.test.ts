import { OmniChaiOnGnosis, ERC20, ERC4626 } from "../typechain-types";

import { ethers, network } from "hardhat";
import { expect } from "chai";

import { setBalance, SnapshotRestorer, takeSnapshot, time } from "@nomicfoundation/hardhat-network-helpers";

import { anyValue } from "@nomicfoundation/hardhat-chai-matchers/withArgs";

import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { Wallet, utils, constants, BigNumber } from "ethers";
const { latestBlock } = time;

const { AddressZero, MaxUint256 } = constants;

describe("oChaiOnGnosis", () => {
    let oChai: OmniChaiOnGnosis;
    let wxdai: ERC20;
    let sDai: ERC4626;
    let user: SignerWithAddress;
    let vitalik: SignerWithAddress;
    let snapshot: SnapshotRestorer;

    before(async () => {
        expect(network.config.chainId).to.be.equal(100);

        [user, vitalik] = await ethers.getSigners();
        await setBalance(user.address, utils.parseEther("100000"));
        await setBalance(vitalik.address, utils.parseEther("100000"));

        const layerZeroEP = "0x9740FF91F1985D8d2B71494aE1A2f723bb3Ed9E4";

        oChai = (await (
            await ethers.getContractFactory("OmniChaiOnGnosis", user)
        ).deploy(layerZeroEP)) as OmniChaiOnGnosis;

        wxdai = (await ethers.getContractAt("ERC20", "0xe91D153E0b41518A2Ce8Dd3D7944Fa863463a97d")) as ERC20;
        sDai = (await ethers.getContractAt("ERC4626", "0xaf204776c7245bF4147c2612BF6e5972Ee483701")) as ERC4626;

        const amount = utils.parseEther("10000");

        await user.sendTransaction({ to: wxdai.address, value: amount });
        await vitalik.sendTransaction({ to: wxdai.address, value: amount });
        snapshot = await takeSnapshot();
    });

    beforeEach(async () => {
        await snapshot.restore();
    });

    describe("oChaiOnGnosis", () => {
        context("when deployed", async () => {
            it("should return correct initial values", async () => {
                expect(await oChai.wxdai()).to.be.equal(wxdai.address);
                expect(await oChai.sDAI()).to.be.equal(sDai.address);
                expect(await oChai.interestReceiver()).to.be.equal("0x670daeaF0F1a5e336090504C68179670B5059088");

                expect(await oChai.name()).to.be.equal("OmniChaiOnGnosis");
                expect(await oChai.symbol()).to.be.equal("oChai");
                expect(await oChai.decimals()).to.be.equal(18);

                expect(await oChai.asset()).to.be.equal(wxdai.address);
                expect(await oChai.totalAssets()).to.be.equal(0);
                expect(await sDai.totalAssets()).to.be.not.equal(0);

                expect(await oChai.balanceOf(user.address)).to.be.equal(0);
                expect(await oChai.totalSupply()).to.be.equal(0);
                expect(await sDai.totalSupply()).to.be.not.equal(0);
                console.log((await sDai.totalSupply()).toString()); // TODO for a test. remove this line

                expect(await oChai.maxDeposit(user.address)).to.be.equal(MaxUint256);
                expect(await oChai.maxMint(user.address)).to.be.equal(MaxUint256);
                expect(await oChai.maxWithdraw(user.address)).to.be.equal(0);
                expect(await oChai.maxRedeem(user.address)).to.be.equal(0);
            });
        });
        context("when comparing sDai", async () => {
            it("should return same values", async () => {
                const bn = await latestBlock();

                const randBigNumber = () => {
                    return BigNumber.from(utils.hexDataSlice(Wallet.createRandom().address, 10));
                };

                let num = randBigNumber();
                expect(await oChai.convertToShares(num, { blockTag: bn })).to.be.equal(
                    await sDai.convertToShares(num, { blockTag: bn })
                );
                num = randBigNumber();
                expect(await oChai.convertToAssets(num, { blockTag: bn })).to.be.equal(
                    await sDai.convertToAssets(num, { blockTag: bn })
                );
                num = randBigNumber();
                expect(await oChai.previewDeposit(num, { blockTag: bn })).to.be.equal(
                    await sDai.previewDeposit(num, { blockTag: bn })
                );
                num = randBigNumber();
                expect(await oChai.previewMint(num, { blockTag: bn })).to.be.equal(
                    await sDai.previewMint(num, { blockTag: bn })
                );
                num = randBigNumber();
                expect(await oChai.previewWithdraw(num, { blockTag: bn })).to.be.equal(
                    await sDai.previewWithdraw(num, { blockTag: bn })
                );
                num = randBigNumber();
                expect(await oChai.previewRedeem(num, { blockTag: bn })).to.be.equal(
                    await sDai.previewRedeem(num, { blockTag: bn })
                );
            });
        });
        context("when deposit", async () => {
            it("should revert if not approved", async () => {
                await expect(oChai.connect(user).deposit(1000000, user.address)).to.be.reverted;
            });
            it("should revert if receiver is wrong", async () => {
                await expect(oChai.connect(user).deposit(1000000, AddressZero)).to.be.revertedWithCustomError(
                    oChai,
                    "InvalidReceiver"
                );
                await expect(oChai.connect(user).deposit(1000000, oChai.address)).to.be.revertedWithCustomError(
                    oChai,
                    "InvalidReceiver"
                );
            });
            it("should mint oChai to receiver, transfer wxDai, and change totalSupply/totalAssets", async () => {
                await wxdai.connect(user).approve(oChai.address, MaxUint256);

                expect(await oChai.totalSupply()).to.be.equal(0);
                expect(await oChai.totalAssets()).to.be.equal(0);

                expect(await sDai.balanceOf(oChai.address)).to.be.equal(0);

                const sDaiTs0 = await sDai.totalSupply();

                const amountOChaiExpected0 = await oChai.previewDeposit(1000000);
                await expect(oChai.connect(user).deposit(1000000, user.address)).to.changeTokenBalances(
                    wxdai,
                    [user, vitalik, oChai],
                    [-1000000, 0, 0]
                );
                expect(await oChai.balanceOf(user.address)).to.be.within(
                    amountOChaiExpected0.mul(9999).div(10000),
                    amountOChaiExpected0
                );

                const sDaiTs1 = await sDai.totalSupply();

                const diff10 = sDaiTs1.sub(sDaiTs0);

                expect(await oChai.totalSupply()).to.be.equal(diff10);
                expect(await oChai.totalAssets()).to.be.closeTo(1000000, 1);
                expect(await oChai.totalAssets()).to.be.equal(await sDai.maxWithdraw(oChai.address));

                expect(await sDai.balanceOf(oChai.address)).to.be.equal(diff10);
                expect(await sDai.balanceOf(user.address)).to.be.equal(0);

                expect(await oChai.balanceOf(oChai.address)).to.be.equal(0);
                expect(await oChai.balanceOf(user.address)).to.be.equal(diff10);

                const amountOChaiExpected1 = await oChai.previewDeposit(2000000);
                await expect(oChai.connect(user).deposit(2000000, vitalik.address)).to.changeTokenBalances(
                    wxdai,
                    [user, vitalik, oChai],
                    [-2000000, 0, 0]
                );
                expect(await oChai.balanceOf(vitalik.address)).to.be.within(
                    amountOChaiExpected1.mul(9999).div(10000),
                    amountOChaiExpected1
                );

                const sDaiTs2 = await sDai.totalSupply();

                const diff21 = sDaiTs2.sub(sDaiTs1);
                const diff20 = sDaiTs2.sub(sDaiTs0);

                const tsExpected = amountOChaiExpected0.add(amountOChaiExpected1);
                expect(await oChai.totalSupply()).to.be.within(tsExpected.mul(9999).div(10000), tsExpected);

                expect(await oChai.totalSupply()).to.be.equal(diff20);
                expect(await oChai.totalAssets()).to.be.closeTo(3000000, 2);
                expect(await oChai.totalAssets()).to.be.equal(await sDai.maxWithdraw(oChai.address));

                expect(await sDai.balanceOf(oChai.address)).to.be.equal(diff20);
                expect(await sDai.balanceOf(user.address)).to.be.equal(0);
                expect(await sDai.balanceOf(vitalik.address)).to.be.equal(0);

                expect(await oChai.balanceOf(oChai.address)).to.be.equal(0);
                expect(await oChai.balanceOf(user.address)).to.be.equal(diff10);
                expect(await oChai.balanceOf(vitalik.address)).to.be.equal(diff21);
            });

            it("should emit Deposit event", async () => {
                await wxdai.connect(user).approve(oChai.address, MaxUint256);

                await expect(oChai.connect(user).deposit(1000000, vitalik.address))
                    .to.emit(oChai, "Deposit")
                    .withArgs(user.address, vitalik.address, 1000000, anyValue);

                const shares = await oChai.balanceOf(vitalik.address);
                expect((await oChai.queryFilter(oChai.filters.Deposit(), await latestBlock()))[0].args[3]).to.be.equal(
                    shares
                );
            });

            it("should show correct maxWithdraw, maxRedeem value", async () => {
                await wxdai.connect(user).approve(oChai.address, MaxUint256);

                await oChai.connect(user).deposit(1000000, user.address);

                expect(await oChai.maxWithdraw(user.address)).to.be.closeTo(1000000, 1);
                expect(await oChai.maxRedeem(user.address)).to.be.equal(await oChai.balanceOf(user.address));

                expect(await sDai.maxWithdraw(user.address)).to.be.equal(0);
                expect(await sDai.maxRedeem(user.address)).to.be.equal(0);
            });
        });
        context("when mint", async () => {
            it("should revert if not approved", async () => {
                await expect(oChai.connect(user).mint(1000000, user.address)).to.be.reverted;
            });

            it("should revert if receiver is wrong", async () => {
                await expect(oChai.connect(user).mint(1000000, AddressZero)).to.be.revertedWithCustomError(
                    oChai,
                    "InvalidReceiver"
                );
                await expect(oChai.connect(user).mint(1000000, oChai.address)).to.be.revertedWithCustomError(
                    oChai,
                    "InvalidReceiver"
                );
            });

            it("should mint oChai to receiver, transfer Dai, and change totalSupply/totalAssets", async () => {
                await wxdai.connect(user).approve(oChai.address, MaxUint256);

                expect(await oChai.totalSupply()).to.be.equal(0);
                expect(await oChai.totalAssets()).to.be.equal(0);

                expect(await sDai.balanceOf(oChai.address)).to.be.equal(0);

                const sDaiTs0 = await sDai.totalSupply();

                let bn = await latestBlock();
                const amountDaiExpected0 = await oChai.previewMint(1000000);
                await expect(oChai.connect(user).mint(1000000, user.address)).to.changeTokenBalances(
                    oChai,
                    [user, vitalik, oChai],
                    [1000000, 0, 0]
                );

                const userXDaiDeposit = (await wxdai.balanceOf(user.address, { blockTag: bn })).sub(
                    await wxdai.balanceOf(user.address)
                );

                expect(await oChai.balanceOf(user.address)).to.be.equal(1000000);
                expect(userXDaiDeposit).to.be.within(amountDaiExpected0, amountDaiExpected0.mul(10001).div(10000));

                const sDaiTs1 = await sDai.totalSupply();

                const diff10 = sDaiTs1.sub(sDaiTs0);
                expect(diff10).to.be.equal(1000000);

                expect(await oChai.totalSupply()).to.be.equal(diff10);
                expect(await oChai.totalAssets()).to.be.closeTo(userXDaiDeposit, 1);
                expect(await oChai.totalAssets()).to.be.equal(await sDai.maxWithdraw(oChai.address));

                expect(await sDai.balanceOf(oChai.address)).to.be.equal(diff10);
                expect(await sDai.balanceOf(user.address)).to.be.equal(0);

                expect(await oChai.balanceOf(oChai.address)).to.be.equal(0);
                expect(await oChai.balanceOf(user.address)).to.be.equal(diff10);

                bn = await latestBlock();
                const amountDaiExpected1 = await oChai.previewMint(2000000);
                await expect(oChai.connect(user).mint(2000000, vitalik.address)).to.changeTokenBalances(
                    oChai,
                    [user, vitalik, oChai],
                    [0, 2000000, 0]
                );

                const vitalikXDaiDeposit = (await wxdai.balanceOf(user.address, { blockTag: bn })).sub(
                    await wxdai.balanceOf(user.address)
                );

                expect(await oChai.balanceOf(vitalik.address)).to.be.equal(2000000);
                expect(vitalikXDaiDeposit).to.be.within(amountDaiExpected1, amountDaiExpected1.mul(10001).div(10000));

                const sDaiTs2 = await sDai.totalSupply();

                const diff21 = sDaiTs2.sub(sDaiTs1);
                const diff20 = sDaiTs2.sub(sDaiTs0);
                expect(diff21).to.be.equal(2000000);
                expect(diff20).to.be.equal(3000000);

                expect(await oChai.totalSupply()).to.be.equal(diff20);
                expect(await oChai.totalAssets()).to.be.closeTo(userXDaiDeposit.add(vitalikXDaiDeposit), 2);
                expect(await oChai.totalAssets()).to.be.equal(await sDai.maxWithdraw(oChai.address));

                expect(await sDai.balanceOf(oChai.address)).to.be.equal(diff20);
                expect(await sDai.balanceOf(user.address)).to.be.equal(0);
                expect(await sDai.balanceOf(vitalik.address)).to.be.equal(0);

                expect(await oChai.balanceOf(oChai.address)).to.be.equal(0);
                expect(await oChai.balanceOf(user.address)).to.be.equal(diff10);
                expect(await oChai.balanceOf(vitalik.address)).to.be.equal(diff21);

                const taExpected = amountDaiExpected0.add(amountDaiExpected1);
                expect(await oChai.totalAssets()).to.be.closeTo(taExpected, 5);
            });

            it("should emit Deposit event", async () => {
                await wxdai.connect(user).approve(oChai.address, MaxUint256);

                const bn = await latestBlock();
                await expect(oChai.connect(user).mint(1000000, vitalik.address))
                    .to.emit(oChai, "Deposit")
                    .withArgs(user.address, vitalik.address, anyValue, 1000000);

                const assets = (await wxdai.balanceOf(user.address, { blockTag: bn })).sub(
                    await wxdai.balanceOf(user.address)
                );
                expect((await oChai.queryFilter(oChai.filters.Deposit(), await latestBlock()))[0].args[2]).to.be.equal(
                    assets
                );
            });

            it("should show correct maxWithdraw, maxRedeem value", async () => {
                await wxdai.connect(user).approve(oChai.address, MaxUint256);

                const bn = await latestBlock();

                await oChai.connect(user).mint(1000000, user.address);

                const assets = (await wxdai.balanceOf(user.address, { blockTag: bn })).sub(
                    await wxdai.balanceOf(user.address)
                );
                expect(await oChai.maxWithdraw(user.address)).to.be.closeTo(assets, 1);
                expect(await oChai.maxRedeem(user.address)).to.be.equal(1000000);

                expect(await sDai.maxWithdraw(user.address)).to.be.equal(0);
                expect(await sDai.maxRedeem(user.address)).to.be.equal(0);
            });
        });
        context("when withdraw", async () => {
            beforeEach(async () => {
                await wxdai.connect(user).approve(oChai.address, MaxUint256);
                await oChai.connect(user).deposit(1000000, user.address);
            });

            it("should revert if receiver is wrong", async () => {
                await expect(
                    oChai.connect(user).withdraw(100000, AddressZero, user.address)
                ).to.be.revertedWithCustomError(oChai, "InvalidReceiver");
                await expect(
                    oChai.connect(user).withdraw(100000, oChai.address, user.address)
                ).to.be.revertedWithCustomError(oChai, "InvalidReceiver");
            });

            it("should revert if assets amount is too much", async () => {
                await expect(oChai.connect(user).withdraw(1000002, user.address, user.address)).to.be.reverted; //customError in sDai

                await oChai.connect(user).deposit(1000000, vitalik.address);
                await expect(oChai.connect(user).withdraw(1000002, user.address, user.address)).to.be.revertedWith(
                    "ERC20: burn amount exceeds balance"
                );
            });

            it("should revert if owner is wrong", async () => {
                await expect(oChai.connect(vitalik).withdraw(100000, vitalik.address, user.address)).to.be.revertedWith(
                    "ERC20: insufficient allowance"
                );
                await expect(oChai.connect(vitalik).withdraw(100000, user.address, user.address)).to.be.revertedWith(
                    "ERC20: insufficient allowance"
                );
            });

            it("should withdraw another's Dai if allowed", async () => {
                await oChai.connect(user).approve(vitalik.address, 100000);
                await expect(oChai.connect(vitalik).withdraw(300000, vitalik.address, user.address)).to.be.revertedWith(
                    "ERC20: insufficient allowance"
                );
                await oChai.connect(vitalik).withdraw(100000, vitalik.address, user.address);
            });

            it("should decrease totalSupply and totalAssets", async () => {
                const ts0 = await oChai.totalSupply();
                const ta0 = await oChai.totalAssets();
                const bal0 = await oChai.balanceOf(user.address);

                const eShares = await oChai.convertToShares(1000000);

                expect(ts0).to.be.closeTo(eShares, 5);
                expect(ta0).to.be.closeTo(1000000, 2);
                expect(bal0).to.be.equal(ts0);

                const sDaiTs0 = await sDai.totalSupply();
                const sDaiBal0 = await sDai.balanceOf(oChai.address);
                const sDaiTa0 = await sDai.totalAssets();

                await oChai.connect(user).withdraw(100000, user.address, user.address);

                const ts1 = await oChai.totalSupply();
                const ta1 = await oChai.totalAssets();
                const bal1 = await oChai.balanceOf(user.address);

                const subShares = await oChai.convertToShares(100000);

                expect(ts1).to.be.closeTo(eShares.sub(subShares), 5);
                expect(ta1).to.be.closeTo(900000, 2);
                expect(bal1).to.be.equal(ts1);

                const sDaiTs1 = await sDai.totalSupply();
                const sDaiBal1 = await sDai.balanceOf(oChai.address);
                const sDaiTa1 = await sDai.totalAssets();

                const burnedOChai = ts0.sub(ts1);
                expect(sDaiTs0.sub(sDaiTs1)).to.be.equal(burnedOChai);
                expect(sDaiBal0.sub(sDaiBal1)).to.be.equal(burnedOChai);

                expect(sDaiTa0.sub(sDaiTa1)).to.be.closeTo(100000, 1);
            });

            it("should emit Withdraw event", async () => {
                const pWithdraw = await oChai.previewWithdraw(100000);
                const tx = await oChai.connect(user).withdraw(100000, vitalik.address, user.address);
                const e = await tx.wait();

                const withdrawEvent = e.events.find(e => e.event == "Withdraw" && e.address == oChai.address);

                expect(withdrawEvent).to.exist;
                expect(withdrawEvent.args.sender).to.be.equal(user.address);
                expect(withdrawEvent.args.receiver).to.be.equal(vitalik.address);
                expect(withdrawEvent.args.owner).to.be.equal(user.address);
                expect(withdrawEvent.args.assets).to.be.equal(100000);

                expect(withdrawEvent.args.shares).to.be.within(pWithdraw.sub(3), pWithdraw);
            });

            it("should withdraw received oChai even if a caller is not a depositor", async () => {
                await oChai.connect(user).transfer(vitalik.address, 10000);
                await oChai.connect(vitalik).withdraw(10000, vitalik.address, vitalik.address);
            });

            it("should transfer wxDai to receiver", async () => {
                const bn = await latestBlock();
                await expect(
                    oChai.connect(user).withdraw(100000, vitalik.address, user.address)
                ).to.changeTokenBalances(wxdai, [user, vitalik, oChai], [0, 100000, 0]);
                expect(await wxdai.totalSupply()).to.be.equal(await wxdai.totalSupply({ blockTag: bn }));

                expect(
                    (await wxdai.balanceOf(sDai.address, { blockTag: bn })).sub(await wxdai.balanceOf(sDai.address))
                ).to.be.equal(100000);

                expect(
                    (await wxdai.balanceOf(vitalik.address)).sub(
                        await wxdai.balanceOf(vitalik.address, { blockTag: bn })
                    )
                ).to.be.equal(100000);
            });

            it("should work properly in more complicated circumstances", async () => {
                await oChai.connect(user).deposit(1000000, vitalik.address);

                await wxdai.connect(vitalik).approve(oChai.address, MaxUint256);
                await oChai.connect(vitalik).deposit(9000000, vitalik.address);

                const userBal0 = await oChai.balanceOf(user.address);
                const vitalikBal0 = await oChai.balanceOf(vitalik.address);
                expect(userBal0.add(vitalikBal0)).to.be.equal(await sDai.balanceOf(oChai.address));

                await expect(oChai.connect(user).withdraw(10000000000, user.address, vitalik.address)).to.be.reverted; //customError in sDai
                await expect(oChai.connect(user).withdraw(10000, user.address, vitalik.address)).to.be.revertedWith(
                    "ERC20: insufficient allowance"
                );

                await oChai.connect(vitalik).approve(user.address, 15000);
                await expect(oChai.connect(user).withdraw(10000, user.address, vitalik.address)).to.changeTokenBalances(
                    wxdai,
                    [sDai, oChai, user, vitalik],
                    [-10000, 0, 10000, 0]
                );

                const withdrawnOChai = (await oChai.totalSupply({ blockTag: (await latestBlock()) - 1 })).sub(
                    await oChai.totalSupply()
                );

                expect(await getBalDiffBy1Blk(oChai, user)).to.be.equal(0);
                expect(await getBalDiffBy1Blk(oChai, vitalik)).to.be.equal(withdrawnOChai.mul(-1));

                expect(await getBalDiffBy1Blk(sDai, oChai)).to.be.equal(withdrawnOChai.mul(-1));
                expect(await getBalDiffBy1Blk(sDai, user)).to.be.equal(0);
                expect(await getBalDiffBy1Blk(sDai, vitalik)).to.be.equal(0);

                await expect(oChai.connect(user).withdraw(2000000, user.address, user.address)).to.be.revertedWith(
                    "ERC20: burn amount exceeds balance"
                );
                await expect(oChai.connect(user).withdraw(7000, user.address, vitalik.address)).to.be.revertedWith(
                    "ERC20: insufficient allowance"
                );
            });
        });
        async function getBalDiffBy1Blk(token, wallet): Promise<BigNumber> {
            return (await token.balanceOf(wallet.address)).sub(
                await token.balanceOf(wallet.address, { blockTag: (await latestBlock()) - 1 })
            );
        }
        context("when redeem", async () => {
            beforeEach(async () => {
                await wxdai.connect(user).approve(oChai.address, MaxUint256);
                await oChai.connect(user).mint(1000000, user.address);
            });

            it("should revert if receiver is wrong", async () => {
                await expect(
                    oChai.connect(user).redeem(100000, AddressZero, user.address)
                ).to.be.revertedWithCustomError(oChai, "InvalidReceiver");
                await expect(
                    oChai.connect(user).redeem(100000, oChai.address, user.address)
                ).to.be.revertedWithCustomError(oChai, "InvalidReceiver");
            });

            it("should revert if assets amount is too much", async () => {
                await expect(oChai.connect(user).redeem(1000001, user.address, user.address)).to.be.reverted; //customError in sDai

                await oChai.connect(user).mint(1000000, vitalik.address);
                await expect(oChai.connect(user).redeem(1000001, user.address, user.address)).to.be.revertedWith(
                    "ERC20: burn amount exceeds balance"
                );
            });

            it("should revert if owner is wrong", async () => {
                await expect(oChai.connect(vitalik).redeem(100000, vitalik.address, user.address)).to.be.revertedWith(
                    "ERC20: insufficient allowance"
                );
                await expect(oChai.connect(vitalik).redeem(100000, user.address, user.address)).to.be.revertedWith(
                    "ERC20: insufficient allowance"
                );
            });

            it("should redeem another's Dai if allowed", async () => {
                await oChai.connect(user).approve(vitalik.address, 100000);
                await expect(oChai.connect(vitalik).redeem(300000, vitalik.address, user.address)).to.be.revertedWith(
                    "ERC20: insufficient allowance"
                );
                await oChai.connect(vitalik).redeem(100000, vitalik.address, user.address);
            });

            it("should decrease totalSupply and totalAssets", async () => {
                const ts0 = await oChai.totalSupply();
                const ta0 = await oChai.totalAssets();
                const bal0 = await oChai.balanceOf(user.address);

                const eAssets = await oChai.convertToAssets(1000000);

                expect(ts0).to.be.equal(1000000);
                expect(ta0).to.be.closeTo(eAssets, 2);
                expect(bal0).to.be.equal(ts0);

                const sDaiTs0 = await sDai.totalSupply();
                const sDaiBal0 = await sDai.balanceOf(oChai.address);
                const sDaiTa0 = await sDai.totalAssets();

                await oChai.connect(user).redeem(100000, user.address, user.address);

                const ts1 = await oChai.totalSupply();
                const ta1 = await oChai.totalAssets();
                const bal1 = await oChai.balanceOf(user.address);

                const subAssets = await oChai.convertToAssets(100000);

                expect(ts1).to.be.equal(900000);
                expect(ta1).to.be.closeTo(eAssets.sub(subAssets), 2);
                expect(bal1).to.be.equal(ts1);

                const sDaiTs1 = await sDai.totalSupply();
                const sDaiBal1 = await sDai.balanceOf(oChai.address);
                const sDaiTa1 = await sDai.totalAssets();

                const burnedOChai = ts0.sub(ts1);
                expect(burnedOChai).to.be.equal(100000);
                expect(sDaiTs0.sub(sDaiTs1)).to.be.equal(burnedOChai);
                expect(sDaiBal0.sub(sDaiBal1)).to.be.equal(burnedOChai);

                expect(sDaiTa0.sub(sDaiTa1)).to.be.closeTo(subAssets, 1);
            });

            it("should emit Withdraw event", async () => {
                const pRedeem = await oChai.previewRedeem(100000);
                const tx = await oChai.connect(user).redeem(100000, vitalik.address, user.address);
                const e = await tx.wait();

                const withdrawEvent = e.events.find(e => e.event == "Withdraw" && e.address == oChai.address);

                expect(withdrawEvent).to.exist;
                expect(withdrawEvent.args.sender).to.be.equal(user.address);
                expect(withdrawEvent.args.receiver).to.be.equal(vitalik.address);
                expect(withdrawEvent.args.owner).to.be.equal(user.address);
                expect(withdrawEvent.args.shares).to.be.equal(100000);

                expect(withdrawEvent.args.assets).to.be.within(pRedeem.sub(3), pRedeem);
            });

            it("should redeem received oChai even if a caller is not a depositor", async () => {
                await oChai.connect(user).transfer(vitalik.address, 10000);
                await oChai.connect(vitalik).redeem(10000, vitalik.address, vitalik.address);
            });

            it("should transfer Dai to receiver", async () => {
                const bn = await latestBlock();
                const eAssets = await oChai.previewRedeem(100000);

                await expect(oChai.connect(user).redeem(100000, vitalik.address, user.address)).to.changeTokenBalances(
                    wxdai,
                    [sDai, vitalik, user, oChai],
                    [eAssets.mul(-1), eAssets, 0, 0]
                );

                expect(await wxdai.totalSupply()).to.be.equal(await wxdai.totalSupply({ blockTag: bn })); //wxdai ts unchanged
            });
            it("should work properly in more complicated circumstances", async () => {
                await oChai.connect(user).mint(1000000, vitalik.address);

                await wxdai.connect(vitalik).approve(oChai.address, MaxUint256);
                await oChai.connect(vitalik).mint(9000000, vitalik.address);

                const userBal0 = await oChai.balanceOf(user.address);
                const vitalikBal0 = await oChai.balanceOf(vitalik.address);
                expect(userBal0.add(vitalikBal0)).to.be.equal(await sDai.balanceOf(oChai.address));

                await expect(oChai.connect(user).redeem(10000000000, user.address, vitalik.address)).to.be.reverted; //customError in sDai
                await expect(oChai.connect(user).redeem(10000, user.address, vitalik.address)).to.be.revertedWith(
                    "ERC20: insufficient allowance"
                );

                await oChai.connect(vitalik).approve(user.address, 15000);
                const pRedeem = await oChai.previewRedeem(10000);
                await expect(oChai.connect(user).redeem(10000, user.address, vitalik.address)).to.changeTokenBalances(
                    wxdai,
                    [sDai, oChai, user, vitalik],
                    [pRedeem.mul(-1), 0, pRedeem, 0]
                );

                expect(
                    (await oChai.totalSupply({ blockTag: (await latestBlock()) - 1 })).sub(await oChai.totalSupply())
                ).to.be.equal(10000);

                expect(await getBalDiffBy1Blk(oChai, user)).to.be.equal(0);
                expect(await getBalDiffBy1Blk(oChai, vitalik)).to.be.equal(-10000);

                expect(await getBalDiffBy1Blk(sDai, oChai)).to.be.equal(-10000);
                expect(await getBalDiffBy1Blk(sDai, user)).to.be.equal(0);
                expect(await getBalDiffBy1Blk(sDai, vitalik)).to.be.equal(0);

                await expect(oChai.connect(user).redeem(2000000, user.address, user.address)).to.be.revertedWith(
                    "ERC20: burn amount exceeds balance"
                );
                await expect(oChai.connect(user).redeem(7000, user.address, vitalik.address)).to.be.revertedWith(
                    "ERC20: insufficient allowance"
                );
            });
        });

        describe("xDAI functions", () => {
            context("when depositXDAI", async () => {
                it("test", async () => {
                    expect(await oChai.totalSupply()).to.be.equal(0);
                    expect(await oChai.totalAssets()).to.be.equal(0);

                    expect(await sDai.balanceOf(oChai.address)).to.be.equal(0);

                    const sDaiTs0 = await sDai.totalSupply();

                    const amountOChaiExpected0 = await oChai.previewDeposit(1000000);
                    await expect(
                        oChai.connect(user).depositXDAI(user.address, { value: 1000000 })
                    ).to.changeTokenBalances(wxdai, [user, vitalik, oChai, sDai], [0, 0, 0, 1000000]);
                    expect(await oChai.balanceOf(user.address)).to.be.equal(amountOChaiExpected0);

                    const sDaiTs1 = await sDai.totalSupply();

                    const diff10 = sDaiTs1.sub(sDaiTs0);

                    expect(await oChai.totalSupply()).to.be.equal(diff10);
                    expect(await oChai.totalAssets()).to.be.closeTo(1000000, 1);
                    expect(await oChai.totalAssets()).to.be.equal(await sDai.maxWithdraw(oChai.address));

                    expect(await sDai.balanceOf(oChai.address)).to.be.equal(diff10);
                    expect(await sDai.balanceOf(user.address)).to.be.equal(0);

                    expect(await oChai.balanceOf(oChai.address)).to.be.equal(0);
                    expect(await oChai.balanceOf(user.address)).to.be.equal(diff10);

                    const amountOChaiExpected1 = await oChai.previewDeposit(2000000);
                    await expect(
                        oChai.connect(user).depositXDAI(vitalik.address, { value: 2000000 })
                    ).to.changeTokenBalances(wxdai, [user, vitalik, oChai, sDai], [0, 0, 0, 2000000]);
                    expect(await oChai.balanceOf(vitalik.address)).to.be.equal(amountOChaiExpected1);

                    const sDaiTs2 = await sDai.totalSupply();

                    const diff21 = sDaiTs2.sub(sDaiTs1);
                    const diff20 = sDaiTs2.sub(sDaiTs0);

                    const tsExpected = amountOChaiExpected0.add(amountOChaiExpected1);
                    expect(await oChai.totalSupply()).to.be.equal(tsExpected);

                    expect(await oChai.totalSupply()).to.be.equal(diff20);
                    expect(await oChai.totalAssets()).to.be.closeTo(3000000, 2);
                    expect(await oChai.totalAssets()).to.be.equal(await sDai.maxWithdraw(oChai.address));

                    expect(await sDai.balanceOf(oChai.address)).to.be.equal(diff20);
                    expect(await sDai.balanceOf(user.address)).to.be.equal(0);
                    expect(await sDai.balanceOf(vitalik.address)).to.be.equal(0);

                    expect(await oChai.balanceOf(oChai.address)).to.be.equal(0);
                    expect(await oChai.balanceOf(user.address)).to.be.equal(diff10);
                    expect(await oChai.balanceOf(vitalik.address)).to.be.equal(diff21);

                    await oChai.connect(user).depositXDAI(user.address, { value: 0 });
                    expect(await oChai.totalSupply()).to.be.equal(tsExpected);

                    expect(await oChai.totalSupply()).to.be.equal(diff20);
                    expect(await oChai.totalAssets()).to.be.closeTo(3000000, 2);
                    expect(await oChai.totalAssets()).to.be.equal(await sDai.maxWithdraw(oChai.address));

                    expect(await sDai.balanceOf(oChai.address)).to.be.equal(diff20);
                    expect(await sDai.balanceOf(user.address)).to.be.equal(0);
                    expect(await sDai.balanceOf(vitalik.address)).to.be.equal(0);

                    expect(await oChai.balanceOf(oChai.address)).to.be.equal(0);
                    expect(await oChai.balanceOf(user.address)).to.be.equal(diff10);
                    expect(await oChai.balanceOf(vitalik.address)).to.be.equal(diff21);

                    await oChai.depositXDAI(user.address);
                });
            });
            context("when withdrawXDAI", async () => {
                it("test", async () => {
                    await wxdai.connect(user).approve(oChai.address, MaxUint256);
                    await oChai.connect(user).deposit(1000000, user.address);
                    await oChai.connect(user).deposit(9000000, vitalik.address);

                    const ts0 = await oChai.totalSupply();
                    const ta0 = await oChai.totalAssets();

                    expect(await sDai.balanceOf(oChai.address)).to.be.equal(ts0);
                    expect(await sDai.maxWithdraw(oChai.address)).to.be.equal(ta0);

                    await expect(oChai.connect(user).withdrawXDAI(20000000, user.address, user.address)).to.be.reverted; //exceed ts
                    await expect(
                        oChai.connect(user).withdrawXDAI(2000000, user.address, user.address)
                    ).to.be.revertedWith("ERC20: burn amount exceeds balance"); //exceed bal
                    await expect(
                        oChai.connect(user).withdrawXDAI(10000, user.address, vitalik.address)
                    ).to.be.revertedWith("ERC20: insufficient allowance"); //exceed allowance

                    await expect(
                        oChai.connect(user).withdrawXDAI(10000, sDai.address, user.address)
                    ).to.be.revertedWith("Address: unable to send value, recipient may have reverted"); //non-receivable receiver
                    const pWithdraw = await oChai.previewWithdraw(10000);
                    await expect(
                        oChai.connect(user).withdrawXDAI(10000, user.address, user.address)
                    ).to.changeEtherBalances([wxdai, user], [-10000, 10000]);

                    expect(await getBalDiffBy1Blk(oChai, user)).to.be.equal(pWithdraw.mul(-1));

                    const ts1 = await oChai.totalSupply();
                    const ta1 = await oChai.totalAssets();

                    expect(await sDai.balanceOf(oChai.address)).to.be.equal(ts1);
                    expect(await sDai.maxWithdraw(oChai.address)).to.be.equal(ta1);

                    expect(ts0.sub(ts1)).to.be.equal(pWithdraw);
                    expect(ta0.sub(ta1)).to.be.closeTo(10000, 1);

                    await oChai.connect(user).withdrawXDAI(0, sDai.address, vitalik.address); // zero asset => returns zero
                });
            });
            context("when redeemXDAI", async () => {
                it("test", async () => {
                    await wxdai.connect(user).approve(oChai.address, MaxUint256);
                    await oChai.connect(user).deposit(1000000, user.address);
                    await oChai.connect(user).deposit(9000000, vitalik.address);

                    const ts0 = await oChai.totalSupply();
                    const ta0 = await oChai.totalAssets();

                    expect(await sDai.balanceOf(oChai.address)).to.be.equal(ts0);
                    expect(await sDai.maxWithdraw(oChai.address)).to.be.equal(ta0);

                    await expect(oChai.connect(user).redeemXDAI(20000000, user.address, user.address)).to.be.reverted; //exceed ts
                    await expect(
                        oChai.connect(user).redeemXDAI(2000000, user.address, user.address)
                    ).to.be.revertedWith("ERC20: burn amount exceeds balance"); //exceed bal
                    await expect(
                        oChai.connect(user).redeemXDAI(10000, user.address, vitalik.address)
                    ).to.be.revertedWith("ERC20: insufficient allowance"); //exceed allowance

                    await expect(oChai.connect(user).redeemXDAI(10000, sDai.address, user.address)).to.be.revertedWith(
                        "Address: unable to send value, recipient may have reverted"
                    ); //non-receivable receiver
                    const pRedeem = await oChai.previewRedeem(10000);
                    await expect(
                        oChai.connect(user).redeemXDAI(10000, user.address, user.address)
                    ).to.changeEtherBalances([wxdai, user], [-pRedeem, pRedeem]);

                    expect(await getBalDiffBy1Blk(oChai, user)).to.be.equal(-10000);

                    const ts1 = await oChai.totalSupply();
                    const ta1 = await oChai.totalAssets();

                    expect(await sDai.balanceOf(oChai.address)).to.be.equal(ts1);
                    expect(await sDai.maxWithdraw(oChai.address)).to.be.equal(ta1);

                    expect(ts0.sub(ts1)).to.be.equal(10000);
                    expect(ta0.sub(ta1)).to.be.closeTo(pRedeem, 1);

                    await oChai.connect(user).redeemXDAI(0, sDai.address, vitalik.address); // zero asset => returns zero
                });
            });
        });
        describe("wrapper functions", () => {
            const registeredChainId = 111;
            const unregisteredChainId = 222;
            const enoughGas = ethers.utils.parseEther("10");

            context("when depositAndSendFrom", async () => {
                it("should revert if not approved", async () => {
                    await expect(
                        oChai
                            .connect(user)
                            .depositAndSendFrom(
                                1000000,
                                registeredChainId,
                                user.address,
                                user.address,
                                AddressZero,
                                "0x"
                            )
                    ).to.be.reverted;
                });
                it("should revert with unregisteredChainId", async () => {
                    await wxdai.connect(user).approve(oChai.address, MaxUint256);
                    await oChai.connect(user).setTrustedRemoteAddress(registeredChainId, oChai.address);
                    await expect(
                        oChai
                            .connect(user)
                            .depositAndSendFrom(
                                1000000,
                                unregisteredChainId,
                                user.address,
                                user.address,
                                AddressZero,
                                "0x"
                            )
                    ).to.be.revertedWith("LzApp: destination chain is not a trusted source");
                });
                it("should revert with invalid adapterParams", async () => {
                    await wxdai.connect(user).approve(oChai.address, MaxUint256);
                    await oChai.connect(user).setTrustedRemoteAddress(registeredChainId, oChai.address);
                    await expect(
                        oChai
                            .connect(user)
                            .depositAndSendFrom(
                                1000000,
                                registeredChainId,
                                user.address,
                                user.address,
                                AddressZero,
                                "0x01"
                            )
                    ).to.be.revertedWith("OFTCore: _adapterParams must be empty.");
                });
                it("should revert if msg.value is not enough", async () => {
                    await wxdai.connect(user).approve(oChai.address, MaxUint256);
                    await oChai.connect(user).setTrustedRemoteAddress(registeredChainId, oChai.address);
                    await expect(
                        oChai
                            .connect(user)
                            .depositAndSendFrom(
                                1000000,
                                registeredChainId,
                                user.address,
                                user.address,
                                AddressZero,
                                "0x"
                            )
                    ).to.be.revertedWith("LayerZero: not enough native for fees");

                    const pDeposit = await oChai.previewDeposit(1000000);
                    const estGas = (await oChai.estimateSendFee(registeredChainId, user.address, pDeposit, false, "0x"))
                        .nativeFee;
                    await expect(
                        oChai
                            .connect(user)
                            .depositAndSendFrom(
                                1000000,
                                registeredChainId,
                                user.address,
                                user.address,
                                AddressZero,
                                "0x",
                                { value: estGas.sub(1) }
                            )
                    ).to.be.revertedWith("LayerZero: not enough native for fees");

                    await oChai
                        .connect(user)
                        .depositAndSendFrom(1000000, registeredChainId, user.address, user.address, AddressZero, "0x", {
                            value: estGas,
                        });
                });
                it("should refund if msg.value exceeds", async () => {
                    await wxdai.connect(user).approve(oChai.address, MaxUint256);
                    await oChai.connect(user).setTrustedRemoteAddress(registeredChainId, oChai.address);

                    const pDeposit = await oChai.previewDeposit(1000000);
                    const estGas = (await oChai.estimateSendFee(registeredChainId, user.address, pDeposit, false, "0x"))
                        .nativeFee;

                    await expect(
                        oChai
                            .connect(user)
                            .depositAndSendFrom(
                                1000000,
                                registeredChainId,
                                user.address,
                                user.address,
                                AddressZero,
                                "0x",
                                { value: estGas.mul(10) }
                            )
                    ).to.changeEtherBalance(user, estGas.mul(-1));
                });
                it("should be oChai is deposited not burned", async () => {
                    await wxdai.connect(user).approve(oChai.address, MaxUint256);
                    await oChai.connect(user).setTrustedRemoteAddress(registeredChainId, oChai.address);

                    const pDeposit = await oChai.previewDeposit(1000000);

                    expect(await oChai.totalSupply()).to.be.equal(0);
                    expect(await oChai.balanceOf(oChai.address)).to.be.equal(0);
                    expect(await oChai.balanceOf(user.address)).to.be.equal(0);
                    await oChai
                        .connect(user)
                        .depositAndSendFrom(1000000, registeredChainId, user.address, user.address, AddressZero, "0x", {
                            value: enoughGas,
                        });
                    expect(await oChai.totalSupply()).to.be.equal(pDeposit);
                    expect(await oChai.balanceOf(oChai.address)).to.be.equal(pDeposit);
                    expect(await oChai.balanceOf(user.address)).to.be.equal(0);
                });
                it("should mint oChai to msg.sender and send it from msg.sender", async () => {
                    await wxdai.connect(user).approve(oChai.address, MaxUint256);
                    await oChai.connect(user).setTrustedRemoteAddress(registeredChainId, oChai.address);
                    const pDeposit = await oChai.previewDeposit(1000000);

                    await expect(
                        oChai
                            .connect(user)
                            .depositAndSendFrom(
                                1000000,
                                registeredChainId,
                                user.address,
                                user.address,
                                AddressZero,
                                "0x",
                                {
                                    value: enoughGas,
                                }
                            )
                    )
                        .to.emit(oChai, "Transfer")
                        .withArgs(AddressZero, user.address, pDeposit)
                        .to.emit(oChai, "Deposit")
                        .withArgs(user.address, user.address, 1000000, pDeposit)
                        .to.emit(oChai, "Transfer")
                        .withArgs(user.address, oChai.address, pDeposit)
                        .to.emit(oChai, "SendToChain")
                        .withArgs(registeredChainId, user.address, user.address.toLowerCase(), pDeposit);
                });
                it("should be that maxWithdraw, maxRedeem value go to zero", async () => {
                    await wxdai.connect(user).approve(oChai.address, MaxUint256);
                    await oChai.connect(user).setTrustedRemoteAddress(registeredChainId, oChai.address);

                    await oChai
                        .connect(user)
                        .depositAndSendFrom(1000000, registeredChainId, user.address, user.address, AddressZero, "0x", {
                            value: enoughGas,
                        });
                    expect(await oChai.maxWithdraw(user.address)).to.be.equal(0);
                    expect(await oChai.maxRedeem(user.address)).to.be.equal(0);

                    expect(await sDai.maxWithdraw(user.address)).to.be.equal(0);
                    expect(await sDai.maxRedeem(user.address)).to.be.equal(0);
                });
                it("should mint oChai to receiver, transfer wxDai, and change totalSupply/totalAssets", async () => {
                    await wxdai.connect(user).approve(oChai.address, MaxUint256);
                    await oChai.connect(user).setTrustedRemoteAddress(registeredChainId, oChai.address);

                    expect(await oChai.totalSupply()).to.be.equal(0);
                    expect(await oChai.totalAssets()).to.be.equal(0);

                    expect(await sDai.balanceOf(oChai.address)).to.be.equal(0);

                    const sDaiTs0 = await sDai.totalSupply();

                    const amountOChaiExpected0 = await oChai.previewDeposit(1000000);
                    await expect(
                        oChai
                            .connect(user)
                            .depositAndSendFrom(
                                1000000,
                                registeredChainId,
                                user.address,
                                user.address,
                                AddressZero,
                                "0x",
                                {
                                    value: enoughGas,
                                }
                            )
                    ).to.changeTokenBalances(wxdai, [user, vitalik, oChai, sDai], [-1000000, 0, 0, 1000000]);
                    expect(await oChai.balanceOf(oChai.address)).to.be.equal(amountOChaiExpected0);
                    expect(await oChai.balanceOf(user.address)).to.be.equal(0);

                    const sDaiTs1 = await sDai.totalSupply();

                    const diff10 = sDaiTs1.sub(sDaiTs0);
                    expect(amountOChaiExpected0).to.be.equal(diff10);

                    expect(await oChai.totalSupply()).to.be.equal(diff10);
                    expect(await oChai.totalAssets()).to.be.closeTo(1000000, 1);
                    expect(await oChai.totalAssets()).to.be.equal(await sDai.maxWithdraw(oChai.address));

                    expect(await sDai.balanceOf(oChai.address)).to.be.equal(diff10);
                    expect(await sDai.balanceOf(user.address)).to.be.equal(0);

                    expect(await oChai.balanceOf(oChai.address)).to.be.equal(diff10);
                    expect(await oChai.balanceOf(user.address)).to.be.equal(0);

                    const amountOChaiExpected1 = await oChai.previewDeposit(2000000);
                    await expect(
                        oChai
                            .connect(user)
                            .depositAndSendFrom(
                                2000000,
                                registeredChainId,
                                vitalik.address,
                                user.address,
                                AddressZero,
                                "0x",
                                {
                                    value: enoughGas,
                                }
                            )
                    ).to.changeTokenBalances(wxdai, [user, vitalik, oChai, sDai], [-2000000, 0, 0, 2000000]);
                    expect(await oChai.balanceOf(vitalik.address)).to.be.equal(0);
                    expect(await oChai.balanceOf(user.address)).to.be.equal(0);

                    const sDaiTs2 = await sDai.totalSupply();

                    const diff21 = sDaiTs2.sub(sDaiTs1);
                    const diff20 = sDaiTs2.sub(sDaiTs0);

                    const tsExpected = amountOChaiExpected0.add(amountOChaiExpected1);
                    expect(await oChai.totalSupply()).to.be.equal(tsExpected);

                    expect(await oChai.totalSupply()).to.be.equal(diff20);
                    expect(await oChai.totalAssets()).to.be.closeTo(3000000, 2);
                    expect(await oChai.totalAssets()).to.be.equal(await sDai.maxWithdraw(oChai.address));

                    expect(await sDai.balanceOf(oChai.address)).to.be.equal(diff20);
                    expect(await sDai.balanceOf(user.address)).to.be.equal(0);
                    expect(await sDai.balanceOf(vitalik.address)).to.be.equal(0);

                    expect(await oChai.balanceOf(oChai.address)).to.be.equal(diff20);
                    expect(await oChai.balanceOf(user.address)).to.be.equal(0);
                    expect(await oChai.balanceOf(vitalik.address)).to.be.equal(0);
                });
            });
            context("when depositXDAIAndSendFrom", async () => {
                it("should revert with unregisteredChainId", async () => {
                    await oChai.connect(user).setTrustedRemoteAddress(registeredChainId, oChai.address);
                    await expect(
                        oChai
                            .connect(user)
                            .depositXDAIAndSendFrom(
                                1000000,
                                unregisteredChainId,
                                user.address,
                                user.address,
                                AddressZero,
                                "0x",
                                { value: 1000000 }
                            )
                    ).to.be.revertedWith("LzApp: destination chain is not a trusted source");
                });
                it("should revert with invalid adapterParams", async () => {
                    await oChai.connect(user).setTrustedRemoteAddress(registeredChainId, oChai.address);
                    await expect(
                        oChai
                            .connect(user)
                            .depositXDAIAndSendFrom(
                                1000000,
                                registeredChainId,
                                user.address,
                                user.address,
                                AddressZero,
                                "0x01",
                                { value: 1000000 }
                            )
                    ).to.be.revertedWith("OFTCore: _adapterParams must be empty.");
                });
                it("should revert if msg.value is not enough", async () => {
                    await oChai.connect(user).setTrustedRemoteAddress(registeredChainId, oChai.address);
                    await expect(
                        oChai
                            .connect(user)
                            .depositXDAIAndSendFrom(
                                1000000,
                                registeredChainId,
                                user.address,
                                user.address,
                                AddressZero,
                                "0x",
                                { value: 100000 }
                            )
                    ).to.be.reverted; //wxdai deposit failure

                    await expect(
                        oChai
                            .connect(user)
                            .depositXDAIAndSendFrom(
                                1000000,
                                registeredChainId,
                                user.address,
                                user.address,
                                AddressZero,
                                "0x",
                                { value: 1000000 }
                            )
                    ).to.be.revertedWith("LayerZero: not enough native for fees"); //not enough native for fees

                    const pDeposit = await oChai.previewDeposit(1000000);
                    const estGas = (await oChai.estimateSendFee(registeredChainId, user.address, pDeposit, false, "0x"))
                        .nativeFee;

                    await expect(
                        oChai
                            .connect(user)
                            .depositXDAIAndSendFrom(
                                1000000,
                                registeredChainId,
                                user.address,
                                user.address,
                                AddressZero,
                                "0x",
                                { value: estGas }
                            )
                    ).to.be.revertedWith("LayerZero: not enough native for fees"); //need assets more

                    await oChai
                        .connect(user)
                        .depositXDAIAndSendFrom(
                            1000000,
                            registeredChainId,
                            user.address,
                            user.address,
                            AddressZero,
                            "0x",
                            {
                                value: estGas.add(1000000),
                            }
                        );
                });
                it("should refund if msg.value exceeds", async () => {
                    await oChai.connect(user).setTrustedRemoteAddress(registeredChainId, oChai.address);

                    const pDeposit = await oChai.previewDeposit(1000000);
                    const estGas = (await oChai.estimateSendFee(registeredChainId, user.address, pDeposit, false, "0x"))
                        .nativeFee;

                    await expect(
                        oChai
                            .connect(user)
                            .depositXDAIAndSendFrom(
                                1000000,
                                registeredChainId,
                                user.address,
                                user.address,
                                AddressZero,
                                "0x",
                                { value: estGas.mul(10) }
                            )
                    ).to.changeEtherBalance(user, estGas.add(1000000).mul(-1));
                });
                it("should be oChai is deposited not burned", async () => {
                    await oChai.connect(user).setTrustedRemoteAddress(registeredChainId, oChai.address);

                    const pDeposit = await oChai.previewDeposit(1000000);

                    expect(await oChai.totalSupply()).to.be.equal(0);
                    expect(await oChai.balanceOf(oChai.address)).to.be.equal(0);
                    expect(await oChai.balanceOf(user.address)).to.be.equal(0);
                    await oChai
                        .connect(user)
                        .depositXDAIAndSendFrom(
                            1000000,
                            registeredChainId,
                            user.address,
                            user.address,
                            AddressZero,
                            "0x",
                            {
                                value: enoughGas,
                            }
                        );
                    expect(await oChai.totalSupply()).to.be.equal(pDeposit);
                    expect(await oChai.balanceOf(oChai.address)).to.be.equal(pDeposit);
                    expect(await oChai.balanceOf(user.address)).to.be.equal(0);
                });
                it("should mint oChai to msg.sender and send it from msg.sender", async () => {
                    await oChai.connect(user).setTrustedRemoteAddress(registeredChainId, oChai.address);
                    const pDeposit = await oChai.previewDeposit(1000000);

                    await expect(
                        oChai
                            .connect(user)
                            .depositXDAIAndSendFrom(
                                1000000,
                                registeredChainId,
                                user.address,
                                user.address,
                                AddressZero,
                                "0x",
                                {
                                    value: enoughGas,
                                }
                            )
                    )
                        .to.emit(oChai, "Transfer")
                        .withArgs(AddressZero, user.address, pDeposit)
                        .to.emit(oChai, "Deposit")
                        .withArgs(user.address, user.address, 1000000, pDeposit)
                        .to.emit(oChai, "Transfer")
                        .withArgs(user.address, oChai.address, pDeposit)
                        .to.emit(oChai, "SendToChain")
                        .withArgs(registeredChainId, user.address, user.address.toLowerCase(), pDeposit);
                });
                it("should be that maxWithdraw, maxRedeem value go to zero", async () => {
                    await oChai.connect(user).setTrustedRemoteAddress(registeredChainId, oChai.address);

                    await oChai
                        .connect(user)
                        .depositXDAIAndSendFrom(
                            1000000,
                            registeredChainId,
                            user.address,
                            user.address,
                            AddressZero,
                            "0x",
                            {
                                value: enoughGas,
                            }
                        );
                    expect(await oChai.maxWithdraw(user.address)).to.be.equal(0);
                    expect(await oChai.maxRedeem(user.address)).to.be.equal(0);

                    expect(await sDai.maxWithdraw(user.address)).to.be.equal(0);
                    expect(await sDai.maxRedeem(user.address)).to.be.equal(0);
                });
                it("should mint oChai to receiver, transfer wxDai, and change totalSupply/totalAssets", async () => {
                    await oChai.connect(user).setTrustedRemoteAddress(registeredChainId, oChai.address);

                    expect(await oChai.totalSupply()).to.be.equal(0);
                    expect(await oChai.totalAssets()).to.be.equal(0);

                    expect(await sDai.balanceOf(oChai.address)).to.be.equal(0);

                    const sDaiTs0 = await sDai.totalSupply();

                    const amountOChaiExpected0 = await oChai.previewDeposit(1000000);
                    const estGas0 = (
                        await oChai.estimateSendFee(registeredChainId, user.address, amountOChaiExpected0, false, "0x")
                    ).nativeFee;
                    await expect(
                        oChai
                            .connect(user)
                            .depositXDAIAndSendFrom(
                                1000000,
                                registeredChainId,
                                user.address,
                                user.address,
                                AddressZero,
                                "0x",
                                {
                                    value: enoughGas,
                                }
                            )
                    ).to.changeEtherBalances(
                        [user, vitalik, oChai, sDai, wxdai],
                        [estGas0.add(1000000).mul(-1), 0, 0, 0, 1000000]
                    );
                    expect(await oChai.balanceOf(oChai.address)).to.be.equal(amountOChaiExpected0);
                    expect(await oChai.balanceOf(user.address)).to.be.equal(0);

                    const sDaiTs1 = await sDai.totalSupply();

                    const diff10 = sDaiTs1.sub(sDaiTs0);
                    expect(amountOChaiExpected0).to.be.equal(diff10);

                    expect(await oChai.totalSupply()).to.be.equal(diff10);
                    expect(await oChai.totalAssets()).to.be.closeTo(1000000, 1);
                    expect(await oChai.totalAssets()).to.be.equal(await sDai.maxWithdraw(oChai.address));

                    expect(await sDai.balanceOf(oChai.address)).to.be.equal(diff10);
                    expect(await sDai.balanceOf(user.address)).to.be.equal(0);

                    expect(await oChai.balanceOf(oChai.address)).to.be.equal(diff10);
                    expect(await oChai.balanceOf(user.address)).to.be.equal(0);

                    const amountOChaiExpected1 = await oChai.previewDeposit(2000000);
                    const estGas1 = (
                        await oChai.estimateSendFee(
                            registeredChainId,
                            vitalik.address,
                            amountOChaiExpected1,
                            false,
                            "0x"
                        )
                    ).nativeFee;
                    await expect(
                        oChai
                            .connect(user)
                            .depositXDAIAndSendFrom(
                                2000000,
                                registeredChainId,
                                vitalik.address,
                                user.address,
                                AddressZero,
                                "0x",
                                {
                                    value: enoughGas,
                                }
                            )
                    ).to.changeEtherBalances(
                        [user, vitalik, oChai, sDai, wxdai],
                        [estGas1.add(2000000).mul(-1), 0, 0, 0, 2000000]
                    );
                    expect(await oChai.balanceOf(vitalik.address)).to.be.equal(0);
                    expect(await oChai.balanceOf(user.address)).to.be.equal(0);

                    const sDaiTs2 = await sDai.totalSupply();

                    const diff21 = sDaiTs2.sub(sDaiTs1);
                    const diff20 = sDaiTs2.sub(sDaiTs0);

                    const tsExpected = amountOChaiExpected0.add(amountOChaiExpected1);
                    expect(await oChai.totalSupply()).to.be.equal(tsExpected);

                    expect(await oChai.totalSupply()).to.be.equal(diff20);
                    expect(await oChai.totalAssets()).to.be.closeTo(3000000, 2);
                    expect(await oChai.totalAssets()).to.be.equal(await sDai.maxWithdraw(oChai.address));

                    expect(await sDai.balanceOf(oChai.address)).to.be.equal(diff20);
                    expect(await sDai.balanceOf(user.address)).to.be.equal(0);
                    expect(await sDai.balanceOf(vitalik.address)).to.be.equal(0);

                    expect(await oChai.balanceOf(oChai.address)).to.be.equal(diff20);
                    expect(await oChai.balanceOf(user.address)).to.be.equal(0);
                    expect(await oChai.balanceOf(vitalik.address)).to.be.equal(0);
                });
            });
            context("when mintAndSendFrom", async () => {
                it("should revert if not approved", async () => {
                    await expect(
                        oChai
                            .connect(user)
                            .mintAndSendFrom(1000000, registeredChainId, user.address, user.address, AddressZero, "0x")
                    ).to.be.reverted;
                });
                it("should revert with unregisteredChainId", async () => {
                    await wxdai.connect(user).approve(oChai.address, MaxUint256);
                    await oChai.connect(user).setTrustedRemoteAddress(registeredChainId, oChai.address);
                    await expect(
                        oChai
                            .connect(user)
                            .mintAndSendFrom(
                                1000000,
                                unregisteredChainId,
                                user.address,
                                user.address,
                                AddressZero,
                                "0x"
                            )
                    ).to.be.revertedWith("LzApp: destination chain is not a trusted source");
                });
                it("should revert with invalid adapterParams", async () => {
                    await wxdai.connect(user).approve(oChai.address, MaxUint256);
                    await oChai.connect(user).setTrustedRemoteAddress(registeredChainId, oChai.address);
                    await expect(
                        oChai
                            .connect(user)
                            .mintAndSendFrom(
                                1000000,
                                registeredChainId,
                                user.address,
                                user.address,
                                AddressZero,
                                "0x01"
                            )
                    ).to.be.revertedWith("OFTCore: _adapterParams must be empty.");
                });
                it("should revert if msg.value is not enough", async () => {
                    await wxdai.connect(user).approve(oChai.address, MaxUint256);
                    await oChai.connect(user).setTrustedRemoteAddress(registeredChainId, oChai.address);
                    await expect(
                        oChai
                            .connect(user)
                            .mintAndSendFrom(1000000, registeredChainId, user.address, user.address, AddressZero, "0x")
                    ).to.be.revertedWith("LayerZero: not enough native for fees");

                    const estGas = (await oChai.estimateSendFee(registeredChainId, user.address, 1000000, false, "0x"))
                        .nativeFee;
                    await expect(
                        oChai
                            .connect(user)
                            .mintAndSendFrom(
                                1000000,
                                registeredChainId,
                                user.address,
                                user.address,
                                AddressZero,
                                "0x",
                                { value: estGas.sub(1) }
                            )
                    ).to.be.revertedWith("LayerZero: not enough native for fees");

                    await oChai
                        .connect(user)
                        .mintAndSendFrom(1000000, registeredChainId, user.address, user.address, AddressZero, "0x", {
                            value: estGas,
                        });
                });
                it("should refund if msg.value exceeds", async () => {
                    await wxdai.connect(user).approve(oChai.address, MaxUint256);
                    await oChai.connect(user).setTrustedRemoteAddress(registeredChainId, oChai.address);

                    const estGas = (await oChai.estimateSendFee(registeredChainId, user.address, 1000000, false, "0x"))
                        .nativeFee;

                    await expect(
                        oChai
                            .connect(user)
                            .mintAndSendFrom(
                                1000000,
                                registeredChainId,
                                user.address,
                                user.address,
                                AddressZero,
                                "0x",
                                { value: estGas.mul(10) }
                            )
                    ).to.changeEtherBalance(user, estGas.mul(-1));
                });
                it("should be oChai is minted not burned", async () => {
                    await wxdai.connect(user).approve(oChai.address, MaxUint256);
                    await oChai.connect(user).setTrustedRemoteAddress(registeredChainId, oChai.address);

                    const pMint = await oChai.previewMint(1000000);

                    expect(await oChai.totalSupply()).to.be.equal(0);
                    expect(await oChai.totalAssets()).to.be.equal(0);
                    expect(await oChai.balanceOf(oChai.address)).to.be.equal(0);
                    expect(await oChai.balanceOf(user.address)).to.be.equal(0);
                    await oChai
                        .connect(user)
                        .mintAndSendFrom(1000000, registeredChainId, user.address, user.address, AddressZero, "0x", {
                            value: enoughGas,
                        });
                    expect(await oChai.totalSupply()).to.be.equal(1000000);
                    expect(await oChai.totalAssets()).to.be.closeTo(pMint, 1);
                    expect(await oChai.balanceOf(oChai.address)).to.be.equal(1000000);
                    expect(await oChai.balanceOf(user.address)).to.be.equal(0);
                });
                it("should mint oChai to msg.sender and send it from msg.sender", async () => {
                    await wxdai.connect(user).approve(oChai.address, MaxUint256);
                    await oChai.connect(user).setTrustedRemoteAddress(registeredChainId, oChai.address);
                    const pMint = await oChai.previewMint(1000000);

                    await expect(
                        oChai
                            .connect(user)
                            .mintAndSendFrom(
                                1000000,
                                registeredChainId,
                                user.address,
                                user.address,
                                AddressZero,
                                "0x",
                                {
                                    value: enoughGas,
                                }
                            )
                    )
                        .to.emit(oChai, "Transfer")
                        .withArgs(AddressZero, user.address, 1000000)
                        .to.emit(oChai, "Deposit")
                        .withArgs(user.address, user.address, pMint, 1000000)
                        .to.emit(oChai, "Transfer")
                        .withArgs(user.address, oChai.address, 1000000)
                        .to.emit(oChai, "SendToChain")
                        .withArgs(registeredChainId, user.address, user.address.toLowerCase(), 1000000);
                });
                it("should be that maxWithdraw, maxRedeem value go to zero", async () => {
                    await wxdai.connect(user).approve(oChai.address, MaxUint256);
                    await oChai.connect(user).setTrustedRemoteAddress(registeredChainId, oChai.address);

                    await oChai
                        .connect(user)
                        .mintAndSendFrom(1000000, registeredChainId, user.address, user.address, AddressZero, "0x", {
                            value: enoughGas,
                        });
                    expect(await oChai.maxWithdraw(user.address)).to.be.equal(0);
                    expect(await oChai.maxRedeem(user.address)).to.be.equal(0);

                    expect(await sDai.maxWithdraw(user.address)).to.be.equal(0);
                    expect(await sDai.maxRedeem(user.address)).to.be.equal(0);
                });
                it("should mint oChai to receiver, transfer wxDai, and change totalSupply/totalAssets", async () => {
                    await wxdai.connect(user).approve(oChai.address, MaxUint256);
                    await oChai.connect(user).setTrustedRemoteAddress(registeredChainId, oChai.address);

                    expect(await oChai.totalSupply()).to.be.equal(0);
                    expect(await oChai.totalAssets()).to.be.equal(0);

                    expect(await sDai.balanceOf(oChai.address)).to.be.equal(0);

                    const sDaiTs0 = await sDai.totalSupply();

                    const amountDaiExpected0 = await oChai.previewMint(1000000);
                    await expect(
                        oChai
                            .connect(user)
                            .mintAndSendFrom(
                                1000000,
                                registeredChainId,
                                user.address,
                                user.address,
                                AddressZero,
                                "0x",
                                {
                                    value: enoughGas,
                                }
                            )
                    ).to.changeTokenBalances(
                        wxdai,
                        [user, vitalik, oChai, sDai],
                        [amountDaiExpected0.mul(-1), 0, 0, amountDaiExpected0]
                    );
                    expect(await oChai.balanceOf(oChai.address)).to.be.equal(1000000);
                    expect(await oChai.balanceOf(user.address)).to.be.equal(0);

                    const sDaiTs1 = await sDai.totalSupply();

                    const diff10 = sDaiTs1.sub(sDaiTs0);
                    expect(1000000).to.be.equal(diff10);

                    expect(await oChai.totalSupply()).to.be.equal(diff10);
                    expect(await oChai.totalAssets()).to.be.closeTo(amountDaiExpected0, 1);
                    expect(await oChai.totalAssets()).to.be.equal(await sDai.maxWithdraw(oChai.address));

                    expect(await sDai.balanceOf(oChai.address)).to.be.equal(diff10);
                    expect(await sDai.balanceOf(user.address)).to.be.equal(0);

                    expect(await oChai.balanceOf(oChai.address)).to.be.equal(diff10);
                    expect(await oChai.balanceOf(user.address)).to.be.equal(0);

                    const amountDaiExpected1 = await oChai.previewMint(2000000);
                    await expect(
                        oChai
                            .connect(user)
                            .mintAndSendFrom(
                                2000000,
                                registeredChainId,
                                vitalik.address,
                                user.address,
                                AddressZero,
                                "0x",
                                {
                                    value: enoughGas,
                                }
                            )
                    ).to.changeTokenBalances(
                        wxdai,
                        [user, vitalik, oChai, sDai],
                        [amountDaiExpected1.mul(-1), 0, 0, amountDaiExpected1]
                    );
                    expect(await oChai.balanceOf(vitalik.address)).to.be.equal(0);
                    expect(await oChai.balanceOf(user.address)).to.be.equal(0);

                    const sDaiTs2 = await sDai.totalSupply();

                    const diff20 = sDaiTs2.sub(sDaiTs0);

                    expect(await oChai.totalSupply()).to.be.equal(3000000);
                    expect(await oChai.totalAssets()).to.be.closeTo(amountDaiExpected0.add(amountDaiExpected1), 2);
                    expect(await oChai.totalAssets()).to.be.equal(await sDai.maxWithdraw(oChai.address));

                    expect(await sDai.balanceOf(oChai.address)).to.be.equal(diff20);
                    expect(await sDai.balanceOf(user.address)).to.be.equal(0);
                    expect(await sDai.balanceOf(vitalik.address)).to.be.equal(0);

                    expect(await oChai.balanceOf(oChai.address)).to.be.equal(diff20);
                    expect(await oChai.balanceOf(user.address)).to.be.equal(0);
                    expect(await oChai.balanceOf(vitalik.address)).to.be.equal(0);
                });
            });
        });
    });
});
