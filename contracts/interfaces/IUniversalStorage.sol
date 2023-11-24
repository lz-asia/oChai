// SPDX-License-Identifier: MIT
pragma solidity ^0.8.18;

interface IUniversalStorage {
    function getBytesData(bytes32 slot) external view returns (bytes memory);
}
