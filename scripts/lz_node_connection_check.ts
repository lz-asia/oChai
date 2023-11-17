import { ethers } from "hardhat";
import config from "../hardhat.config";
import { mainnet as lzChainIds } from "../constants/chainIds.json";
import { endpoint as lzEndpoint } from "../constants/layerzero.json";

const networkNames = [
    "ethereum",
    "bsc",
    "gnosis",
    "polygon",
    "zkevm",
    "moonbeam",
    "arbitrum",
    "linea",
    "scroll",
    "optimism",
    "mantle",
    "base",
    "avalanche",
];

interface Network {
    url: string;
}

const IEP = new ethers.utils.Interface(["function defaultSendLibrary() external view returns (address uln)"]);
const IULN = new ethers.utils.Interface([
    "function defaultAppConfig(uint16 chainId) external view returns (uint16 inboundProofLibraryVersion, uint64 inboundBlockConfirmations, address relayer, uint16 outboundProofType, uint64 outboundBlockConfirmations, address oracle)",
]);

async function _checkLzConnection(provider: any, networkName: string) {
    const theOtherChains = networkNames.filter(name => name !== networkName);

    const epContract = new ethers.Contract(lzEndpoint.mainnet[networkName], IEP, provider);
    const uln = await epContract.defaultSendLibrary();

    const ulnContract = new ethers.Contract(uln, IULN, provider);

    const promises = theOtherChains.map(_networkName => {
        const lzChainId = lzChainIds[_networkName];
        return ulnContract.defaultAppConfig(lzChainId).then(res => {
            if (res.oracle === ethers.constants.AddressZero) {
                console.log(
                    `Network "${networkName}" -> Network ${_networkName} (chainId : ${lzChainId}) : No connection`
                );
            }
        });
    });

    await Promise.all(promises);

    return "Done";
}

async function getOnChainData(networkName: string, fn: (_provider, _networkName) => void) {
    if (config.networks) {
        const network = config.networks[networkName] as Network;
        if (network) {
            const provider = new ethers.providers.JsonRpcProvider(network.url);
            console.log(
                `Network "${networkName}" (chainId : ${(await provider.getNetwork()).chainId}) : ${await fn(
                    provider,
                    networkName
                )}`
            );
        }
    } else {
        console.log(`Network "${networkName}" does not exist.`);
    }
}

async function checkLzConnection() {
    for (const networkName of networkNames) {
        await getOnChainData(networkName, _checkLzConnection);
    }
}

checkLzConnection();
