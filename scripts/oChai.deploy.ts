import { ethers, network } from "hardhat";
import config from "../hardhat.config";
import { MetamaskClient } from "hardhat_metamask_client";
import { OmniChai } from "../typechain-types";
import { assert } from "chai";
import { endpoint } from "../constants/layerzero.json";

async function main(networkName: string, layerZeroEP: string) {
    const client = new MetamaskClient({
        hardhatConfig: config,
        networkName: networkName,
        ethers: ethers,
    });
    console.log(networkName);
    const epiface = new ethers.utils.Interface(["function defaultReceiveLibraryAddress() view returns (address)"]);
    const check = await ethers.provider.call({
        to: layerZeroEP,
        data: epiface.encodeFunctionData("defaultReceiveLibraryAddress"),
    });
    assert.notEqual(check.length, 2, "Invalid EP");

    const oChai = (await (
        await ethers.getContractFactory("OmniChai", await client.getSigner())
    ).deploy(layerZeroEP)) as OmniChai;
    await oChai.deployed();
    console.log(`\nDeployed as ${oChai.address} on ${networkName}\n
    name is ${await oChai.name()}\n
    symbol is ${await oChai.symbol()}`);
    client.close();
}

const epAddress = endpoint.mainnet[network.name];
assert.isDefined(epAddress, "not in endpoint list");
console.log(`\nDeploying OmniChai on ${network.name} with LayerZero EndPoint ${epAddress}\n`);

assert.include(["ethereum", "gnosis"], network.name.toLowerCase(), "Invalid network name");

main(network.name, epAddress);
