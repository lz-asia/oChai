// SPDX-License-Identifier: MIT
pragma solidity ^0.8.18;

import "@layerzerolabs/solidity-examples/contracts/interfaces/ILayerZeroReceiver.sol";

interface IOmniChaiGateway is ILayerZeroReceiver {
    event RequestDeposit(address indexed user, uint256 indexed nonce, uint256 amount, uint256 fee);
    event RequestCancelDeposit(address indexed user, uint256 indexed nonce);

    event RequestRedeem(
        address indexed user,
        uint256 indexed nonce,
        uint256 amount,
        uint256 desiredDai,
        uint256 deadline
    );
    event RequestCancelRedeem(address indexed user, uint256 indexed nonce);

    event ExecuteDepositRequest(address indexed user, uint256 indexed nonce, address indexed taker, uint256 daiAmount);
    event ExecuteRedeemRequest(
        address indexed user,
        uint256 indexed nonce,
        address indexed taker,
        uint256 oChaiAmount,
        uint256 daiAmount
    );

    event UpdateEligibleTaker(address indexed user, uint256 indexed nonce, address indexed taker);
    event CancelDeposit(address indexed user, uint256 indexed nonce);

    event FailedExecutingDepositRequest(address indexed user, uint256 indexed nonce, address indexed taker);

    enum Status {
        Pending,
        Completed,
        Cancelled
    }

    struct DepositRequest {
        Status status;
        uint256 amount;
        uint256 fee;
        address eligibleTaker;
    }

    struct RedeemRequest {
        Status status;
        uint256 amount;
        uint256 desiredDai;
        uint256 deadline;
    }

    function oChai() external view returns (address);

    function dai() external view returns (address);

    function CHAIN_ID_GNOSIS() external view returns (uint16);

    function PT_SEND_DEPOSIT() external view returns (uint16);

    function PT_SEND_CANCEL() external view returns (uint16);

    function MINIMUM_FEE_RATE() external view returns (uint16);

    function depositNonce(address user) external view returns (uint256);

    function redeemNonce(address user) external view returns (uint256);

    function depositRequest(address user, uint256 nonce) external view returns (DepositRequest memory);

    function redeemRequest(address user, uint256 nonce) external view returns (RedeemRequest memory);

    function estimateFeeRequestDeposit(
        uint256 amount,
        uint256 fee,
        address _zeroPaymentAddress,
        uint256 gaslimit
    ) external view returns (uint256, uint256);

    function estimateFeeRequestCancelDeposit(
        uint256 nonce,
        address _zeroPaymentAddress,
        uint256 gaslimit,
        uint256 nativeForDst,
        uint256 returnCallGaslimit
    ) external view returns (uint256, uint256);

    function requestDeposit(
        uint256 amount,
        uint256 fee,
        address payable _refundAddress,
        address _zroPaymentAddress,
        uint256 gaslimit
    ) external payable;

    function requestCancelDeposit(
        uint256 nonce,
        address payable _refundAddress,
        address _zroPaymentAddress,
        uint256 gaslimit,
        uint256 nativeForDst,
        uint256 returnCallGaslimit
    ) external payable;

    function executeDepositRequest(address user, uint256 nonce) external;

    function requestRedeem(uint256 amount, uint256 desiredDai, uint256 deadline) external;

    function requestCancelRedeem(uint256 nonce) external;

    function executeRedeemRequest(address user, uint256 nonce) external;
}
