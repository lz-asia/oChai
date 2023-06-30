import { BasedOmniChai, ERC20 } from "../typechain-types";

import { ethers } from "hardhat";
import { expect } from "chai";

import {
    impersonateAccount,
    setBalance,
    SnapshotRestorer,
    takeSnapshot,
    time,
} from "@nomicfoundation/hardhat-network-helpers";

import { anyValue } from "@nomicfoundation/hardhat-chai-matchers/withArgs";

import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { Wallet, utils, constants, BigNumber } from "ethers";
const { latestBlock } = time;

const { AddressZero, MaxUint256 } = constants;

describe("oChai", () => {
    let oChai: BasedOmniChai;
    let dai: ERC20;
    let sDai: BasedOmniChai;
    let user: SignerWithAddress;
    let snapshot: SnapshotRestorer;

    const wallet = Wallet.createRandom();

    before(async () => {
        expect((await ethers.provider.getNetwork()).chainId).to.be.equal(1);

        await impersonateAccount("0x47ac0Fb4F2D84898e4D9E7b4DaB3C24507a6D503");
        user = await ethers.getSigner("0x47ac0Fb4F2D84898e4D9E7b4DaB3C24507a6D503");

        await setBalance(wallet.address, utils.parseEther("1000"));

        const layerZeroEP = "0x66A71Dcef29A0fFBDBE3c6a460a3B5BC225Cd675";

        oChai = (await (await ethers.getContractFactory("BasedOmniChai", user)).deploy(layerZeroEP)) as BasedOmniChai;

        dai = (await ethers.getContractAt("ERC20", "0x6B175474E89094C44Da98b954EedeAC495271d0F")) as ERC20;
        sDai = (await ethers.getContractAt(
            "BasedOmniChai",
            "0x83F20F44975D03b1b09e64809B757c47f942BEeA"
        )) as BasedOmniChai;

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
            it("should mint oChai to receiver", async () => {
                await dai.connect(user).approve(oChai.address, MaxUint256);

                expect(await oChai.totalSupply()).to.be.equal(0);

                const amountOChaiExpected0 = await oChai.previewDeposit(1000000);
                await expect(oChai.connect(user).deposit(1000000, user.address)).to.changeTokenBalances(
                    dai,
                    [user, wallet, oChai],
                    [-1000000, 0, 0]
                );
                expect(await oChai.balanceOf(user.address)).to.be.within(
                    amountOChaiExpected0.mul(9999).div(10000),
                    amountOChaiExpected0
                );

                const amountOChaiExpected1 = await oChai.previewDeposit(2000000);
                await expect(oChai.connect(user).deposit(2000000, wallet.address)).to.changeTokenBalances(
                    dai,
                    [user, wallet, oChai],
                    [-2000000, 0, 0]
                );
                expect(await oChai.balanceOf(wallet.address)).to.be.within(
                    amountOChaiExpected1.mul(9999).div(10000),
                    amountOChaiExpected1
                );

                const tsExpected = amountOChaiExpected0.add(amountOChaiExpected1);
                expect(await oChai.totalSupply()).to.be.within(tsExpected.mul(9999).div(10000), tsExpected);
            });
            it("should emit Deposit event", async () => {
                await dai.connect(user).approve(oChai.address, MaxUint256);

                await expect(oChai.connect(user).deposit(1000000, wallet.address))
                    .to.emit(oChai, "Deposit")
                    .withArgs(user.address, wallet.address, 1000000, anyValue);

                const shares = await oChai.balanceOf(wallet.address);
                expect((await oChai.queryFilter(oChai.filters.Deposit(), await latestBlock()))[0].args[3]).to.be.equal(
                    shares
                );
            });
            it("should show correct maxWithdraw, maxRedeem value", async () => {
                await dai.connect(user).approve(oChai.address, MaxUint256);

                await oChai.connect(user).deposit(1000000, user.address);

                expect(await oChai.maxWithdraw(user.address)).to.be.within(1000000 - 1, 1000000 + 1);
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
            it("should mint oChai to receiver", async () => {
                await dai.connect(user).approve(oChai.address, MaxUint256);

                expect(await oChai.totalSupply()).to.be.equal(0);

                let bn = await latestBlock();
                const amountDaiExpected0 = await oChai.previewMint(1000000);
                await expect(oChai.connect(user).mint(1000000, user.address)).to.changeTokenBalances(
                    oChai,
                    [user, wallet, oChai],
                    [1000000, 0, 0]
                );
                expect(await oChai.balanceOf(user.address)).to.be.equal(1000000);
                expect(
                    (await dai.balanceOf(user.address, { blockTag: bn })).sub(await dai.balanceOf(user.address))
                ).to.be.within(amountDaiExpected0.mul(9999).div(10000), amountDaiExpected0);

                bn = await latestBlock();
                const amountDaiExpected1 = await oChai.previewMint(2000000);
                await expect(oChai.connect(user).mint(2000000, wallet.address)).to.changeTokenBalances(
                    oChai,
                    [user, wallet, oChai],
                    [0, 2000000, 0]
                );
                expect(await oChai.balanceOf(wallet.address)).to.be.equal(2000000);
                expect(
                    (await dai.balanceOf(user.address, { blockTag: bn })).sub(await dai.balanceOf(user.address))
                ).to.be.within(amountDaiExpected1.mul(9999).div(10000), amountDaiExpected1);

                expect(await oChai.totalSupply()).to.be.equal(3000000);
            });
            it("should emit Deposit event", async () => {
                await dai.connect(user).approve(oChai.address, MaxUint256);

                const bn = await latestBlock();
                await expect(oChai.connect(user).mint(1000000, wallet.address))
                    .to.emit(oChai, "Deposit")
                    .withArgs(user.address, wallet.address, anyValue, 1000000);

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
                expect(await oChai.maxWithdraw(user.address)).to.be.within(assets.sub(1), assets.add(1));
                expect(await oChai.maxRedeem(user.address)).to.be.equal(1000000);
            });
        });
        context("when withdraw", async () => {
            beforeEach(async () => {
                await dai.connect(user).approve(oChai.address, MaxUint256);
                await oChai.connect(user).mint(1000000, user.address);
            });
            // TODO
        });
    });
});
