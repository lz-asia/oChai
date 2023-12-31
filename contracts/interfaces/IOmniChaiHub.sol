// SPDX-License-Identifier: MIT
pragma solidity ^0.8.18;

import "@layerzerolabs/solidity-examples/contracts/interfaces/ILayerZeroReceiver.sol";

interface IOmniChaiHub is ILayerZeroReceiver {
    enum Status {
        Pending,
        Completed,
        Cancelled
    }

    struct DepositRequest {
        Status status;
        uint256 amount;
        uint256 fee;
    }

    event SetBaseMinDstGas(uint16 indexed packetType, uint256 minDstGas);
    event RecordDepositRequest(
        uint16 indexed srcChainId,
        address indexed requester,
        uint256 indexed nonce,
        uint256 amount,
        uint256 fee
    );
    event ForwardCancelDepositToSrcChain(uint16 indexed srcChainId, address indexed user, uint256 indexed nonce);

    event ExecuteDepositRequest(
        uint16 indexed srcChainId,
        address indexed requester,
        uint256 nonce,
        address indexed taker,
        uint256 totalDaiAmount,
        uint256 feeToTaker,
        uint256 oChaiAmount
    );

    function oChai() external view returns (address);

    function wxdai() external view returns (address);

    function PT_SEND_DEPOSIT() external view returns (uint16);

    function PT_SEND_CANCEL() external view returns (uint16);

    function baseMinDstGasLookup(uint16 packetType) external view returns (uint256);

    function estimateExecuteDepositRequest(
        uint16 srcChainId,
        address user,
        uint256 nonce,
        address _zroPaymentAddress,
        uint256[] calldata gaslimits
    ) external view returns (uint256[2] memory lzNativeFees, uint256[2] memory lzZROFees);

    function estimateForwardCancel(
        uint16 srcChainId,
        address user,
        uint256 nonce,
        address _zroPaymentAddress,
        uint256 returnCallGaslimit
    ) external view returns (uint256 lzNativeFee, uint256 lzZROFee);

    function depositRequest(
        uint16 srcChainId,
        address user,
        uint256 nonce
    ) external view returns (DepositRequest memory);

    function executeDepositRequest(
        uint16 srcChainId,
        address user,
        uint256 nonce,
        address _zroPaymentAddress,
        uint256[] calldata gaslimits,
        uint256[] calldata msgValues
    ) external payable;

    function executeDepositRequestXDAI(
        uint16 srcChainId,
        address user,
        uint256 nonce,
        address _zroPaymentAddress,
        uint256[] calldata gaslimits,
        uint256[] calldata msgValues
    ) external payable;
}
