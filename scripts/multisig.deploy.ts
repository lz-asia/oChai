import { ethers, network } from "hardhat";
import config from "../hardhat.config";
import { MetamaskClient } from "hardhat_metamask_client";
import { deployedAddress as oChaiAddresses } from "../deployments/oChai.json";
import { deployedAddress as oDAIAddresses } from "../deployments/oDAI.json";
import { expect } from "chai";
import { BigNumberish, Contract } from "ethers";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { mainnet as lzChainId } from "../constants/evmIds_chainIds.json";
import fs from "fs";
import "dotenv/config";
import * as path from "path";

const { utils, constants } = ethers;

const IProxyFac = new utils.Interface([
    "function createProxyWithNonce(address _singleton, bytes memory initializer, uint256 saltNonce) external returns (address proxy)",
]);
const ISafe = new utils.Interface([
    `function execTransaction(
        address to,
        uint256 value,
        bytes calldata data,
        uint8 operation,
        uint256 safeTxGas,
        uint256 baseGas,
        uint256 gasPrice,
        address gasToken,
        address payable refundReceiver,
        bytes memory signatures
    ) public payable returns (bool success)`,
    `function isOwner(address owner) external view returns (bool)`,
]);

const proxyFactory = "0xa6B71E26C5e0845f74c812102Ca7114b6a896AB2";
const safeL2 = "0x3e5c63644e683549055b9be8653de26e0b4cd36e";
const nonce = "14897134446208232836674813187351954462619415427500845853920401810882870365401";

const hbAddress = utils.getAddress(String(process.env.DEPLOYER_ADDRESS));
const safeAddress = "0x000016F2dFfD962F7037d4710D72d103c759d280";

async function deployMultisig(signer: SignerWithAddress, networkName: string, skipDeploy = false) {
    console.log(`\nDeploying Multisig on ${networkName}........\n`);
    if (!skipDeploy && (await ethers.provider.getCode(safeAddress)) === "0x") {
        const proxyFac = new ethers.Contract(proxyFactory, IProxyFac, signer);
        expect(
            await proxyFac.callStatic.createProxyWithNonce(
                safeL2,
                "0xb63e800d0000000000000000000000000000000000000000000000000000000000000100000000000000000000000000000000000000000000000000000000000000000100000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000140000000000000000000000000f48f2b2d2a534e402487b3ee7c18c33aec0fe5e4000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000100000000000000000000000062a2cb7a5979d8a25828e0a24a88258f84af6bc30000000000000000000000000000000000000000000000000000000000000000",
                nonce
            )
        ).to.be.equal(utils.getAddress(safeAddress));

        console.log(`Address of multisig will be ${networkName} : ${safeAddress}\n`);

        const tx = await proxyFac.createProxyWithNonce(
            safeL2,
            "0xb63e800d0000000000000000000000000000000000000000000000000000000000000100000000000000000000000000000000000000000000000000000000000000000100000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000140000000000000000000000000f48f2b2d2a534e402487b3ee7c18c33aec0fe5e4000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000100000000000000000000000062a2cb7a5979d8a25828e0a24a88258f84af6bc30000000000000000000000000000000000000000000000000000000000000000",
            nonce
        );
        const res = await tx.wait();
        expect(res.events[0].address).to.be.equal(safeAddress);
    }

    const safe = new ethers.Contract(safeAddress, ISafe, signer);
    expect(await safe.isOwner(hbAddress)).to.be.equal(true);

    console.log(`\nDeployed Multisig as ${safeAddress} on ${networkName}\n`);

    return safe;
}

async function setOwnerAsMultisig(signer: SignerWithAddress, networkName: string, safe: Contract) {
    const safeAddress = safe.address;

    const chainId = String(network.config.chainId);
    if (!(chainId in oChaiAddresses)) {
        throw new Error(`oChai not deployed on ${networkName}`);
    } else if (chainId in oDAIAddresses) {
        console.log(`Setting owner of oDAI as multisig on ${networkName}........\n`);
        const oDAI = await ethers.getContractAt("LzApp", oDAIAddresses[chainId], signer);

        const owner0 = await oDAI.owner();

        if (owner0 == hbAddress) {
            expect(owner0).to.be.equal(hbAddress);

            console.log(`Owner of oDAI is ${owner0} and it will be updated to ${safeAddress}\n`);
            const tx = await oDAI.transferOwnership(safeAddress);
            await tx.wait();
        } else if (owner0 != safeAddress) {
            throw new Error(`oDAI : owner is neither hbAddress nor safeWallet. ${owner0}`);
        }
        const owner1 = await oDAI.owner();
        expect(owner1).to.be.equal(safeAddress);
        console.log(`\noDAI : owner was updated to safeWallet. ${owner1}\n`);
    }
    console.log(`Setting owner of oChai as multisig on ${networkName}........\n`);
    const oChai = await ethers.getContractAt("LzApp", oChaiAddresses[chainId], signer);

    const owner0 = await oChai.owner();

    if (owner0 == hbAddress) {
        expect(owner0).to.be.equal(hbAddress);

        console.log(`Owner of oChai is ${owner0} and it will be updated to ${safeAddress}\n`);
        const tx = await oChai.transferOwnership(safeAddress);
        await tx.wait();
    } else if (owner0 != safeAddress) {
        throw new Error(`oChai : owner is neither hbAddress nor safeWallet. ${owner0}`);
    }
    const owner1 = await oChai.owner();
    expect(owner1).to.be.equal(safeAddress);
    console.log(`\noChai : owner was updated to safeWallet. ${owner1}\n`);
}

async function executeTxThroughMultisig(
    signer: SignerWithAddress,
    safe: Contract,
    to: string,
    value: BigNumberish,
    data: string,
    multicall = false
) {
    const tx = await safe.execTransaction(
        to,
        value,
        data,
        multicall ? 1 : 0,
        0,
        0,
        0,
        "0x0000000000000000000000000000000000000000",
        "0x0000000000000000000000000000000000000000",
        utils.defaultAbiCoder.encode(["address", "uint256"], [hbAddress, "0"]) + "01"
    );
    await tx.wait();
    await signer.provider?.waitForTransaction(tx.hash);
}

async function setTrustRemote(signer: SignerWithAddress, networkName: string, safe: Contract) {
    console.log(`\nSetting trusted remote on ${networkName}........\n`);
    let multiSendCallOnlyAddress = "0x40A2aCCbd92BCA938b02010E17A5b8929b49130D";

    if ((await ethers.provider.getCode(multiSendCallOnlyAddress)) === "0x") {
        multiSendCallOnlyAddress = "0xA1dabEF33b3B82c7814B6D82A79e50F4AC44102B";

        if ((await ethers.provider.getCode(multiSendCallOnlyAddress)) === "0x") {
            throw new Error(`MultiSendCallOnly is not deployed on ${networkName}\n`);
        }
    }

    const chainId = String(network.config.chainId);
    if (!(chainId in oChaiAddresses)) {
        throw new Error(`oChai not deployed on ${networkName}`);
    }

    const oChai = await ethers.getContractAt("LzApp", oChaiAddresses[chainId], signer);

    const theOtherChains = Object.keys(oChaiAddresses).filter(key => key !== chainId);
    const theOtherOChaiLzChainIds: BigNumberish[] = [];

    const txPrefix = "0x8d80ff0a";
    let txData = "";
    for (const otherChainId of theOtherChains) {
        if (txData == "") txData += "0x";

        const _lzChainId = lzChainId[otherChainId];
        theOtherOChaiLzChainIds.push(_lzChainId);

        const data = oChai.interface.encodeFunctionData("setTrustedRemoteAddress", [
            _lzChainId,
            oChaiAddresses[otherChainId],
        ]);

        txData += "00";
        txData += oChai.address.slice(2);
        txData += constants.HashZero.slice(2);
        txData += utils.hexZeroPad(utils.hexlify(utils.hexDataLength(data)), 32).slice(2);
        txData += data.slice(2);
    }

    let oDAI;
    const theOtherODAILzChainIds: BigNumberish[] = [];
    if (chainId in oDAIAddresses) {
        oDAI = await ethers.getContractAt("LzApp", oDAIAddresses[chainId], signer);
        const theOtherChains = Object.keys(oDAIAddresses).filter(key => key !== chainId);

        for (const otherChainId of theOtherChains) {
            const _lzChainId = lzChainId[otherChainId];
            theOtherODAILzChainIds.push(_lzChainId);

            const data = oDAI.interface.encodeFunctionData("setTrustedRemoteAddress", [
                _lzChainId,
                oDAIAddresses[otherChainId],
            ]);

            txData += "00";
            txData += oDAI.address.slice(2);
            txData += constants.HashZero.slice(2);
            txData += utils.hexZeroPad(utils.hexlify(utils.hexDataLength(data)), 32).slice(2);
            txData += data.slice(2);
        }
    }

    txData = utils.defaultAbiCoder.encode(["bytes"], [txData]);
    txData = txPrefix + txData.slice(2);

    await executeTxThroughMultisig(signer, safe, multiSendCallOnlyAddress, 0, txData, true);

    for (const lzChainId of theOtherOChaiLzChainIds) {
        expect(await oChai.getTrustedRemoteAddress(lzChainId)).to.be.not.equal(constants.AddressZero);
    }
    for (const lzChainId of theOtherODAILzChainIds) {
        expect(await oDAI.getTrustedRemoteAddress(lzChainId)).to.be.not.equal(constants.AddressZero);
    }

    console.log(`\nSet trusted remote on ${networkName} successfully`);
}

async function main(networkName) {
    const client = new MetamaskClient({
        hardhatConfig: config,
        networkName: networkName,
        ethers: ethers,
    });
    console.log(networkName);

    const deploymentsPath = path.resolve(__dirname, "../deployments/multisig.json");

    let deployments = {};
    if (fs.existsSync(deploymentsPath)) {
        deployments = JSON.parse(fs.readFileSync(deploymentsPath).toString());
    }

    const skipDeploy = deployments[networkName] ? true : false;

    const signer = await client.getSigner();

    const safe = await deployMultisig(signer, networkName, skipDeploy);
    await setOwnerAsMultisig(signer, networkName, safe);
    await setTrustRemote(signer, networkName, safe);

    client.close();

    if (!skipDeploy) {
        deployments[networkName] = safe.address;
        fs.writeFileSync(deploymentsPath, JSON.stringify(deployments, null, 2));
    }
}

console.log(`\nDeploying Multisig on ${network.name}\n`);

main(network.name);
