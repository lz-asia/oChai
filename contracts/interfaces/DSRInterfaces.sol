// SPDX-License-Identifier: MIT
pragma solidity ^0.8.18;

interface VatLike {
    function hope(address) external;
}

interface PotLike {
    function chi() external view returns (uint256);

    function rho() external view returns (uint256);

    function dsr() external view returns (uint256);

    function drip() external returns (uint256);

    function join(uint256) external;

    function exit(uint256) external;
}

interface DaiJoinLike {
    function vat() external view returns (address);

    function dai() external view returns (address);

    function join(address, uint256) external;

    function exit(address, uint256) external;
}
