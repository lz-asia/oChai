// SPDX-License-Identifier: MIT
pragma solidity ^0.8.18;

import "@layerzerolabs/solidity-examples/contracts/interfaces/ILayerZeroReceiver.sol";

interface IOmniChaiGateway is ILayerZeroReceiver {
    event RequestDeposit(address user, uint256 nonce, uint256 amount, uint256 fee);
    event RequestCancelDeposit(address user, uint256 nonce);

    event RequestRedeem(address user, uint256 nonce, uint256 amount, uint256 desiredDai, uint256 deadline);
    event RequestCancelRedeem(address user, uint256 nonce);

    event ExecuteDepositRequest(address user, uint256 nonce, address taker, uint256 daiAmount);
    event ExecuteRedeemRequest(address user, uint256 nonce, address taker, uint256 oChaiAmount, uint256 daiAmount);

    event UpdateEligibleTaker(address user, uint256 nonce, address taker);
    event CancelDeposit(address user, uint256 nonce);

    event FailedExecutingDepositRequest(address user, uint256 nonce, address taker);

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

    function depositNonce(address user) external view returns (uint256);

    function redeemNonce(address user) external view returns (uint256);

    function depositRequest(address user, uint256 nonce) external view returns (DepositRequest memory);

    function redeemRequest(address user, uint256 nonce) external view returns (RedeemRequest memory);

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
