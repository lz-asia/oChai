// SPDX-License-Identifier: MIT
pragma solidity ^0.8.18;

import "@layerzerolabs/solidity-examples/contracts/token/oft/IOFT.sol";
import "@openzeppelin/contracts/interfaces/IERC4626.sol";

interface IOmniChaiOnGnosis is IOFT, IERC4626 {
    function wxdai() external view returns (address);

    function sDAI() external view returns (address);

    function interestReceiver() external view returns (address);

    function vaultAPY() external view returns (uint256);

    function useCustomAdapterParams() external view returns (bool);

    function depositXDAI(uint256 amount) external payable returns (uint256 shares);

    function withdrawXDAI(uint256 assets, address receiver, address owner) external returns (uint256 shares);

    function redeemXDAI(uint256 shares, address receiver, address owner) external returns (uint256 assets);

    function depositAndSendFrom(
        uint256 assets,
        uint16 _dstChainId,
        bytes calldata _toAddress,
        address payable _refundAddress,
        address _zroPaymentAddress,
        bytes calldata _adapterParams
    ) external payable returns (uint256 shares);

    function depositXDAIAndSendFrom(
        uint256 assets,
        uint16 _dstChainId,
        bytes memory _toAddress,
        address payable _refundAddress,
        address _zroPaymentAddress,
        bytes calldata _adapterParams
    ) external payable returns (uint256 shares);

    function mintAndSendFrom(
        uint256 shares,
        uint16 _dstChainId,
        bytes calldata _toAddress,
        address payable _refundAddress,
        address _zroPaymentAddress,
        bytes calldata _adapterParams
    ) external payable returns (uint256 assets);
}
