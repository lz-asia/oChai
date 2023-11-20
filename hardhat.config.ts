import "dotenv/config";
import "@nomiclabs/hardhat-solhint";
import "@nomicfoundation/hardhat-toolbox";
import "hardhat-abi-exporter";
import "hardhat-deploy";
import "hardhat-spdx-license-identifier";
import "hardhat-watcher";
import "@lz-asia/lz-kit/hardhat";
import "@primitivefi/hardhat-dodoc";
import "@nomicfoundation/hardhat-chai-matchers";

import { HardhatUserConfig, task } from "hardhat/config";

import { removeConsoleLog } from "hardhat-preprocessor";

const accounts = { mnemonic: process.env.MNEMONIC || "test test test test test test test test test test test junk" };

// This is a sample Hardhat task. To learn how to create your own go to
// https://hardhat.org/guides/create-task.html
task("accounts", "Prints the list of accounts", async (args, { ethers }) => {
    const accounts = await ethers.getSigners();

    for (const account of accounts) {
        console.log(await account.address);
    }
});

const config: HardhatUserConfig = {
    abiExporter: {
        path: "./abis",
        runOnCompile: true,
        clear: true,
        flat: true,
        spacing: 2,
    },
    defaultNetwork: "hardhat",
    dodoc: {
        exclude: ["hardhat/"],
    },
    etherscan: {
        apiKey: process.env.ETHERSCAN_API_KEY,
    },
    gasReporter: {
        coinmarketcap: process.env.COINMARKETCAP_API_KEY,
        currency: "USD",
        enabled: process.env.REPORT_GAS === "true",
    },
    mocha: {
        timeout: 300_000, // 5 mins
    },
    namedAccounts: {
        deployer: {
            default: 0,
        },
        alice: {
            default: 1,
        },
        bob: {
            default: 2,
        },
        carol: {
            default: 3,
        },
    },
    networks: {
        localhost: {
            live: false,
            saveDeployments: true,
            tags: ["local"],
        },
        hardhat: {
            // Seems to be a bug with this, even when false it complains about being unauthenticated.
            // Reported to HardHat team and fix is incoming
            forking: {
                enabled: process.env.FORKING === "true",
                url:
                    process.env.FORKING_CHAINID === "1"
                        ? `https://eth-mainnet.alchemyapi.io/v2/${process.env.ALCHEMY_API_KEY}`
                        : process.env.FORKING_RPC_URL,
            },
            chainId: process.env.FORKING === "true" ? Number(process.env.FORKING_CHAINID) : 31337,
            live: false,
            saveDeployments: true,
            tags: ["test", "local"],
        },
        ethereum: {
            url: `https://mainnet.infura.io/v3/${process.env.INFURA_API_KEY}`,
            accounts,
            chainId: 1,
            live: true,
            saveDeployments: true,
            tags: ["production"],
        },
        goerli: {
            url: `https://goerli.infura.io/v3/${process.env.INFURA_API_KEY}`,
            accounts,
            chainId: 5,
            live: true,
            saveDeployments: true,
            tags: ["staging"],
        },
        bsc: {
            url: `https://1rpc.io/${process.env.ONERPC_API_KEY}/bnb`,
            accounts,
            chainId: 56,
            live: true,
            saveDeployments: true,
            tags: ["production"],
        },
        polygon: {
            url: `https://polygon-mainnet.infura.io/v3/${process.env.INFURA_API_KEY}`,
            accounts,
            chainId: 137,
            live: true,
            saveDeployments: true,
            tags: ["production"],
        },
        avalanche: {
            url: `https://avalanche-mainnet.infura.io/v3/${process.env.INFURA_API_KEY}`,
            accounts,
            chainId: 43114,
            live: true,
            saveDeployments: true,
            tags: ["production"],
        },
        optimism: {
            url: `https://optimism-mainnet.infura.io/v3/${process.env.INFURA_API_KEY}`,
            accounts,
            chainId: 10,
            live: true,
            saveDeployments: true,
            tags: ["production"],
        },
        arbitrum: {
            url: `https://arbitrum-mainnet.infura.io/v3/${process.env.INFURA_API_KEY}`,
            accounts,
            chainId: 42161,
            live: true,
            saveDeployments: true,
            tags: ["production"],
        },
        base: {
            url: `https://1rpc.io/${process.env.ONERPC_API_KEY}/base`,
            accounts,
            chainId: 8453,
            live: true,
            saveDeployments: true,
            tags: ["production"],
        },
        linea: {
            url: `https://1rpc.io/${process.env.ONERPC_API_KEY}/linea`,
            accounts,
            chainId: 59144,
            live: true,
            saveDeployments: true,
            tags: ["production"],
        },
        moonbeam: {
            url: `https://1rpc.io/${process.env.ONERPC_API_KEY}/glmr`,
            accounts,
            chainId: 1284,
            live: true,
            saveDeployments: true,
            tags: ["production"],
        },
        zkevm: {
            url: `https://1rpc.io/${process.env.ONERPC_API_KEY}/polygon/zkevm`,
            accounts,
            chainId: 1101,
            live: true,
            saveDeployments: true,
            tags: ["production"],
        },
        mantle: {
            url: `https://1rpc.io/${process.env.ONERPC_API_KEY}/mantle`,
            accounts,
            chainId: 5000,
            live: true,
            saveDeployments: true,
            tags: ["production"],
        },
        scroll: {
            url: `https://1rpc.io/${process.env.ONERPC_API_KEY}/scroll`,
            accounts,
            chainId: 534352,
            live: true,
            saveDeployments: true,
            tags: ["production"],
        },
        gnosis: {
            url: `https://1rpc.io/${process.env.ONERPC_API_KEY}/gnosis`,
            accounts,
            chainId: 100,
            live: true,
            saveDeployments: true,
            tags: ["production"],
        },
    },
    preprocess: {
        eachLine: removeConsoleLog(bre => bre.network.name !== "hardhat" && bre.network.name !== "localhost"),
    },
    solidity: {
        version: "0.8.18",
        settings: {
            optimizer: {
                enabled: true,
                runs: 200,
            },
            viaIR: false,
        },
    },
    watcher: {
        compile: {
            tasks: ["compile"],
            files: ["./contracts"],
            verbose: true,
        },
    },
};

// You need to export an object to set up your config
// Go to https://hardhat.org/config/ to learn more
export default config;
