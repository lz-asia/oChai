// SPDX-License-Identifier: MIT
pragma solidity ^0.8.18;

import "@layerzerolabs/solidity-examples/contracts/token/oft/OFT.sol";

contract OmniChai is OFT {
    error InvalidChainId();

    constructor(address _layerZeroEndpoint) OFT("OmniChai", "oChai", _layerZeroEndpoint) {
        if (block.chainid == 1) revert InvalidChainId();
    }
}
