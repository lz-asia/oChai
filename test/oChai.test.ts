import { BasedOmniChai, ERC20, PotLike } from "../typechain-types";

import { ethers } from "hardhat";
import { expect } from "chai";

import {
    impersonateAccount,
    setBalance,
    SnapshotRestorer,
    takeSnapshot,
    time,
    setStorageAt,
} from "@nomicfoundation/hardhat-network-helpers";

import { anyValue } from "@nomicfoundation/hardhat-chai-matchers/withArgs";

import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { Wallet, utils, constants, BigNumber } from "ethers";
const { increase, latestBlock } = time;

const { AddressZero, MaxUint256 } = constants;

describe("oChai", () => {
    let oChai: BasedOmniChai;
    let dai: ERC20;
    let sDai: BasedOmniChai;
    let user: SignerWithAddress;
    let vitalik: SignerWithAddress;
    let snapshot: SnapshotRestorer;

    before(async () => {
        expect((await ethers.provider.getNetwork()).chainId).to.be.equal(1);

        [user, vitalik] = await ethers.getSigners();
        await setBalance(user.address, utils.parseEther("1000"));
        await setBalance(vitalik.address, utils.parseEther("1000"));

        const layerZeroEP = "0x66A71Dcef29A0fFBDBE3c6a460a3B5BC225Cd675";

        oChai = (await (await ethers.getContractFactory("BasedOmniChai", user)).deploy(layerZeroEP)) as BasedOmniChai;

        dai = (await ethers.getContractAt("ERC20", "0x6B175474E89094C44Da98b954EedeAC495271d0F")) as ERC20;
        sDai = (await ethers.getContractAt(
            "BasedOmniChai",
            "0x83F20F44975D03b1b09e64809B757c47f942BEeA"
        )) as BasedOmniChai;

        const amount = utils.parseEther("100000");
        await setStorageAt(dai.address, 1, (await dai.totalSupply()).add(amount));
        await setStorageAt(
            dai.address,
            utils.keccak256(utils.hexZeroPad(user.address, 32) + utils.hexZeroPad("0x02", 32).slice(2)),
            (await dai.balanceOf(user.address)).add(amount)
        );

        snapshot = await takeSnapshot();
    });

    beforeEach(async () => {
        await snapshot.restore();
    });

    describe("oChai", () => {
        context("when deployed", async () => {
            it("should return correct initial values", async () => {
                expect(await oChai.dai()).to.be.equal(dai.address);
                expect(await oChai.dai()).to.be.equal(await sDai.dai());
                expect(await oChai.pot()).to.be.equal(await sDai.pot());
                expect(await oChai.vat()).to.be.equal(await sDai.vat());
                expect(await oChai.daiJoin()).to.be.equal(await sDai.daiJoin());

                expect(await oChai.name()).to.be.equal("BasedOmniChai");
                expect(await oChai.symbol()).to.be.equal("oChai");
                expect(await oChai.decimals()).to.be.equal(18);

                expect(await oChai.asset()).to.be.equal(dai.address);
                expect(await oChai.totalAssets()).to.be.equal(0);

                expect(await oChai.balanceOf(user.address)).to.be.equal(0);
                expect(await oChai.totalSupply()).to.be.equal(0);
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
                await expect(oChai.connect(user).deposit(1000000, user.address)).to.be.revertedWith(
                    "Dai/insufficient-allowance"
                );
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
            it("should mint oChai to receiver, transfer Dai, and change totalSupply/totalAssets", async () => {
                await dai.connect(user).approve(oChai.address, MaxUint256);

                expect(await oChai.totalSupply()).to.be.equal(0);
                expect(await oChai.totalAssets()).to.be.equal(0);

                const amountOChaiExpected0 = await oChai.previewDeposit(1000000);
                await expect(oChai.connect(user).deposit(1000000, user.address)).to.changeTokenBalances(
                    dai,
                    [user, vitalik, oChai],
                    [-1000000, 0, 0]
                );
                expect(await oChai.balanceOf(user.address)).to.be.within(
                    amountOChaiExpected0.mul(9999).div(10000),
                    amountOChaiExpected0
                );

                const amountOChaiExpected1 = await oChai.previewDeposit(2000000);
                await expect(oChai.connect(user).deposit(2000000, vitalik.address)).to.changeTokenBalances(
                    dai,
                    [user, vitalik, oChai],
                    [-2000000, 0, 0]
                );
                expect(await oChai.balanceOf(vitalik.address)).to.be.within(
                    amountOChaiExpected1.mul(9999).div(10000),
                    amountOChaiExpected1
                );

                const tsExpected = amountOChaiExpected0.add(amountOChaiExpected1);
                expect(await oChai.totalSupply()).to.be.within(tsExpected.mul(9999).div(10000), tsExpected);
                expect(await oChai.totalAssets()).to.be.closeTo(3000000, 5);
            });
            it("should emit Deposit event", async () => {
                await dai.connect(user).approve(oChai.address, MaxUint256);

                await expect(oChai.connect(user).deposit(1000000, vitalik.address))
                    .to.emit(oChai, "Deposit")
                    .withArgs(user.address, vitalik.address, 1000000, anyValue);

                const shares = await oChai.balanceOf(vitalik.address);
                expect((await oChai.queryFilter(oChai.filters.Deposit(), await latestBlock()))[0].args[3]).to.be.equal(
                    shares
                );
            });
            it("should show correct maxWithdraw, maxRedeem value", async () => {
                await dai.connect(user).approve(oChai.address, MaxUint256);

                await oChai.connect(user).deposit(1000000, user.address);

                expect(await oChai.maxWithdraw(user.address)).to.be.closeTo(1000000, 1);
                expect(await oChai.maxRedeem(user.address)).to.be.equal(await oChai.balanceOf(user.address));
            });
        });
        context("when mint", async () => {
            it("should revert if not approved", async () => {
                await expect(oChai.connect(user).mint(1000000, user.address)).to.be.revertedWith(
                    "Dai/insufficient-allowance"
                );
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
                await dai.connect(user).approve(oChai.address, MaxUint256);

                expect(await oChai.totalSupply()).to.be.equal(0);
                expect(await oChai.totalAssets()).to.be.equal(0);

                let bn = await latestBlock();
                const amountDaiExpected0 = await oChai.previewMint(1000000);
                await expect(oChai.connect(user).mint(1000000, user.address)).to.changeTokenBalances(
                    oChai,
                    [user, vitalik, oChai],
                    [1000000, 0, 0]
                );
                expect(await oChai.balanceOf(user.address)).to.be.equal(1000000);
                expect(
                    (await dai.balanceOf(user.address, { blockTag: bn })).sub(await dai.balanceOf(user.address))
                ).to.be.within(amountDaiExpected0, amountDaiExpected0.mul(10001).div(10000));

                bn = await latestBlock();
                const amountDaiExpected1 = await oChai.previewMint(2000000);
                await expect(oChai.connect(user).mint(2000000, vitalik.address)).to.changeTokenBalances(
                    oChai,
                    [user, vitalik, oChai],
                    [0, 2000000, 0]
                );
                expect(await oChai.balanceOf(vitalik.address)).to.be.equal(2000000);
                expect(
                    (await dai.balanceOf(user.address, { blockTag: bn })).sub(await dai.balanceOf(user.address))
                ).to.be.within(amountDaiExpected1, amountDaiExpected1.mul(10001).div(10000));

                expect(await oChai.totalSupply()).to.be.equal(3000000);
                const taExpected = amountDaiExpected0.add(amountDaiExpected1);
                expect(await oChai.totalAssets()).to.be.closeTo(taExpected, 5);
            });
            it("should emit Deposit event", async () => {
                await dai.connect(user).approve(oChai.address, MaxUint256);

                const bn = await latestBlock();
                await expect(oChai.connect(user).mint(1000000, vitalik.address))
                    .to.emit(oChai, "Deposit")
                    .withArgs(user.address, vitalik.address, anyValue, 1000000);

                const assets = (await dai.balanceOf(user.address, { blockTag: bn })).sub(
                    await dai.balanceOf(user.address)
                );
                expect((await oChai.queryFilter(oChai.filters.Deposit(), await latestBlock()))[0].args[2]).to.be.equal(
                    assets
                );
            });
            it("should show correct maxWithdraw, maxRedeem value", async () => {
                await dai.connect(user).approve(oChai.address, MaxUint256);

                const bn = await latestBlock();
                await oChai.connect(user).mint(1000000, user.address);

                const assets = (await dai.balanceOf(user.address, { blockTag: bn })).sub(
                    await dai.balanceOf(user.address)
                );
                expect(await oChai.maxWithdraw(user.address)).to.be.closeTo(assets, 1);
                expect(await oChai.maxRedeem(user.address)).to.be.equal(1000000);
            });
        });
        context("when withdraw", async () => {
            beforeEach(async () => {
                await dai.connect(user).approve(oChai.address, MaxUint256);
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

                await oChai.connect(user).withdraw(100000, user.address, user.address);

                const ts1 = await oChai.totalSupply();
                const ta1 = await oChai.totalAssets();
                const bal1 = await oChai.balanceOf(user.address);

                const subShares = await oChai.convertToShares(100000);

                expect(ts1).to.be.closeTo(eShares.sub(subShares), 5);
                expect(ta1).to.be.closeTo(900000, 2);
                expect(bal1).to.be.equal(ts1);
            });

            it("should emit Withdraw event", async () => {
                const pWithdraw = await oChai.previewWithdraw(100000);
                const tx = await oChai.connect(user).withdraw(100000, vitalik.address, user.address);
                const e = await tx.wait();

                const withdrawEvent = e.events.find(e => e.event == "Withdraw");

                expect(withdrawEvent).to.exist;
                expect(withdrawEvent.args.sender).to.be.equal(user.address);
                expect(withdrawEvent.args.receiver).to.be.equal(vitalik.address);
                expect(withdrawEvent.args.owner).to.be.equal(user.address);
                expect(withdrawEvent.args.assets).to.be.equal(100000);

                expect(withdrawEvent.args.shares).to.be.within(pWithdraw.sub(3), pWithdraw);
            });

            it("should withdraw received oChai when a caller is not a depositor", async () => {
                await oChai.connect(user).transfer(vitalik.address, 10000);
                await oChai.connect(vitalik).withdraw(10000, vitalik.address, vitalik.address);
            });

            it("should transfer Dai to receiver", async () => {
                const bn = await latestBlock();
                await expect(
                    oChai.connect(user).withdraw(100000, vitalik.address, user.address)
                ).to.changeTokenBalances(dai, [user, vitalik, oChai], [0, 100000, 0]);
                expect((await dai.totalSupply()).sub(await dai.totalSupply({ blockTag: bn }))).to.be.equal(100000);
            });
        });
        context("when redeem", async () => {
            beforeEach(async () => {
                await dai.connect(user).approve(oChai.address, MaxUint256);
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

                await oChai.connect(user).redeem(100000, user.address, user.address);

                const ts1 = await oChai.totalSupply();
                const ta1 = await oChai.totalAssets();
                const bal1 = await oChai.balanceOf(user.address);

                const subAssets = await oChai.convertToAssets(100000);

                expect(ts1).to.be.equal(900000);
                expect(ta1).to.be.closeTo(eAssets.sub(subAssets), 2);
                expect(bal1).to.be.equal(ts1);
            });

            it("should emit Withdraw event", async () => {
                const pRedeem = await oChai.previewRedeem(100000);
                const tx = await oChai.connect(user).redeem(100000, vitalik.address, user.address);
                const e = await tx.wait();

                const withdrawEvent = e.events.find(e => e.event == "Withdraw");

                expect(withdrawEvent).to.exist;
                expect(withdrawEvent.args.sender).to.be.equal(user.address);
                expect(withdrawEvent.args.receiver).to.be.equal(vitalik.address);
                expect(withdrawEvent.args.owner).to.be.equal(user.address);
                expect(withdrawEvent.args.shares).to.be.equal(100000);

                expect(withdrawEvent.args.assets).to.be.within(pRedeem.sub(3), pRedeem);
            });

            it("should redeem received oChai when a caller is not a depositor", async () => {
                await oChai.connect(user).transfer(vitalik.address, 10000);
                await oChai.connect(vitalik).redeem(10000, vitalik.address, vitalik.address);
            });

            it("should transfer Dai to receiver", async () => {
                const bn = await latestBlock();
                const eAssets = await oChai.convertToAssets(100000);

                await oChai.connect(user).redeem(100000, vitalik.address, user.address);

                expect(
                    (await dai.balanceOf(user.address)).sub(await dai.balanceOf(user.address, { blockTag: bn }))
                ).to.be.equal(0);
                expect(
                    (await dai.balanceOf(vitalik.address)).sub(await dai.balanceOf(vitalik.address, { blockTag: bn }))
                ).to.be.closeTo(eAssets, 2);
                expect(
                    (await dai.balanceOf(oChai.address)).sub(await dai.balanceOf(oChai.address, { blockTag: bn }))
                ).to.be.equal(0);
                expect((await dai.totalSupply()).sub(await dai.totalSupply({ blockTag: bn }))).to.be.closeTo(
                    eAssets,
                    2
                );
            });
        });
        context("basic test", async () => {
            it("should increase underlying Dai balance", async () => {
                const daiBal0 = await dai.balanceOf(user.address);

                await dai.connect(user).approve(oChai.address, MaxUint256);
                const depositAmount = utils.parseEther("12345");
                await oChai.connect(user).deposit(depositAmount, user.address);
                const bal = await oChai.balanceOf(user.address);

                const pRedeem0 = await oChai.previewRedeem(bal);
                expect(pRedeem0).to.be.closeTo(depositAmount, 1);

                await increase(10000);

                const pot = (await ethers.getContractAt("PotLike", await oChai.pot())) as PotLike;
                const newChi = await pot.callStatic.drip();

                const pRedeem1 = await oChai.previewRedeem(bal);
                expect(pRedeem1).to.be.gt(pRedeem0);
                expect(pRedeem1).to.be.closeTo(bal.mul(newChi).div(utils.parseUnits("1", 27)), 1);

                await oChai.connect(user).redeem(bal, user.address, user.address);

                const daiBal1 = await dai.balanceOf(user.address);
                expect(daiBal1).to.be.gt(daiBal0);
            });
        });
    });
});
