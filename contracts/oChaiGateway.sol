// SPDX-License-Identifier: MIT
pragma solidity ^0.8.18;

import "@layerzerolabs/solidity-examples/contracts/lzApp/NonblockingLzApp.sol";
import "@openzeppelin/contracts/interfaces/IERC20.sol";
import "@openzeppelin/contracts/utils/Address.sol";
import "./interfaces/IOmniChaiGateway.sol";

/**
 * @title OmniChaiGateway
 * @author TheGreatHB
 * @notice drafts of the OmniChaiGateway contract
 */

contract OmniChaiGateway is NonblockingLzApp, IOmniChaiGateway {
    using BytesLib for bytes;

    uint16 public constant PT_SEND_DEPOSIT = 1;
    uint16 public constant PT_SEND_CANCEL = 2;

    uint16 public immutable CHAIN_ID_GNOSIS;

    address public immutable oChai;
    address public immutable dai;

    mapping(address user => DepositRequest[]) internal _depositRequests;
    mapping(address user => RedeemRequest[]) internal _redeemRequests;

    constructor(
        address _endpoint,
        address _oChai,
        address _dai,
        uint16 gnosis_chain_id,
        address _owner
    ) NonblockingLzApp(_endpoint) {
        oChai = _oChai;
        dai = _dai;
        CHAIN_ID_GNOSIS = gnosis_chain_id;
        _transferOwnership(_owner);
    }

    function depositRequest(address user, uint256 nonce) external view returns (DepositRequest memory) {
        return _depositRequests[user][nonce];
    }

    function redeemRequest(address user, uint256 nonce) external view returns (RedeemRequest memory) {
        return _redeemRequests[user][nonce];
    }

    function depositNonce(address user) public view returns (uint256) {
        return _depositRequests[user].length;
    }

    function redeemNonce(address user) public view returns (uint256) {
        return _redeemRequests[user].length;
    }

    function requestDeposit(
        uint256 amount,
        uint256 fee,
        address payable _refundAddress,
        address _zroPaymentAddress,
        uint256 gaslimit
    ) external payable {
        if (minDstGasLookup[CHAIN_ID_GNOSIS][PT_SEND_DEPOSIT] > gaslimit) revert("OmniChaiGateway: gaslimit too low"); //TODO custom Err

        uint256 nonce = depositNonce(msg.sender);

        _depositRequests[msg.sender].push(DepositRequest(Status.Pending, amount, fee, address(0)));
        IERC20(dai).transferFrom(msg.sender, address(this), amount);

        bytes memory payload = abi.encode(PT_SEND_DEPOSIT, msg.sender, amount, fee, nonce);
        _lzSend(
            CHAIN_ID_GNOSIS,
            payload,
            _refundAddress,
            _zroPaymentAddress,
            abi.encodePacked(uint16(1), gaslimit),
            msg.value
        );
        emit RequestDeposit(msg.sender, nonce, amount, fee);
    }

    function requestCancelDeposit(
        uint256 nonce,
        address payable _refundAddress,
        address _zroPaymentAddress,
        uint256 gaslimit,
        uint256 nativeForDst,
        uint256 returnCallGaslimit
    ) external payable {
        if (minDstGasLookup[CHAIN_ID_GNOSIS][PT_SEND_DEPOSIT] > gaslimit) revert("OmniChaiGateway: gaslimit too low"); //TODO custom Err
        if (nativeForDst == 0) revert("OmniChaiGateway: nativeForDst must be > 0"); //TODO custom Err

        DepositRequest storage request = _depositRequests[msg.sender][nonce];
        require(request.status == Status.Pending, "OmniChaiGateway: invalid status"); //TODO custom Err

        bytes memory payload = abi.encode(PT_SEND_CANCEL, msg.sender, nonce, returnCallGaslimit);
        _lzSend(
            CHAIN_ID_GNOSIS,
            payload,
            _refundAddress,
            _zroPaymentAddress,
            abi.encodePacked(uint16(2), gaslimit, nativeForDst, trustedRemoteLookup[CHAIN_ID_GNOSIS].toAddress(0)),
            msg.value
        );
        emit RequestCancelDeposit(msg.sender, nonce);
    }

    function executeDepositRequest(address user, uint256 nonce) external {
        DepositRequest storage request = _depositRequests[user][nonce];
        require(request.status == Status.Pending, "OmniChaiGateway: invalid status"); //TODO custom Err
        require(msg.sender == address(this) || request.eligibleTaker == msg.sender, "OmniChaiGateway: invalid taker"); //TODO custom Err

        request.status = Status.Completed;

        IERC20(dai).transfer(msg.sender, request.amount);
        emit ExecuteDepositRequest(user, nonce, msg.sender, request.amount);
    }

    function requestRedeem(uint256 amount, uint256 desiredDai, uint256 deadline) external {
        uint256 nonce = redeemNonce(msg.sender);

        _redeemRequests[msg.sender].push(RedeemRequest(Status.Pending, amount, desiredDai, deadline));
        IERC20(oChai).transferFrom(msg.sender, address(this), amount);
        emit RequestRedeem(msg.sender, nonce, amount, desiredDai, deadline);
    }

    function requestCancelRedeem(uint256 nonce) external {
        RedeemRequest storage request = _redeemRequests[msg.sender][nonce];
        require(request.status == Status.Pending, "OmniChaiGateway: invalid status"); //TODO custom Err
        request.status = Status.Cancelled;

        IERC20(oChai).transfer(msg.sender, request.amount);
        emit RequestCancelRedeem(msg.sender, nonce);
    }

    function executeRedeemRequest(address user, uint256 nonce) external {
        RedeemRequest storage request = _redeemRequests[user][nonce];
        require(request.status == Status.Pending, "OmniChaiGateway: invalid status"); //TODO custom Err
        request.status = Status.Completed;

        IERC20(dai).transferFrom(msg.sender, user, request.desiredDai);
        IERC20(oChai).transfer(msg.sender, request.amount);
        emit ExecuteRedeemRequest(user, nonce, msg.sender, request.amount, request.desiredDai);
    }

    function _nonblockingLzReceive(
        uint16 _srcChainId,
        bytes memory _srcAddress,
        uint64 _nonce,
        bytes memory _payload
    ) internal override {
        require(_srcChainId == CHAIN_ID_GNOSIS, "OmniChaiGateway: invalid srcChainId"); //TODO custom Err

        uint16 packetType;
        assembly {
            packetType := mload(add(_payload, 32))
        }

        if (packetType == PT_SEND_DEPOSIT) {
            _sendDepositAck(_srcChainId, _srcAddress, _nonce, _payload);
        } else if (packetType == PT_SEND_CANCEL) {
            _sendCancelAck(_srcChainId, _srcAddress, _nonce, _payload);
        } else {
            revert("OmniChaiGateway: unknown packet type");
        }
    }

    function _sendDepositAck(uint16, bytes memory, uint64, bytes memory _payload) internal {
        (, address user, uint256 nonce, address taker) = abi.decode(_payload, (uint16, address, uint256, address));

        _depositRequests[user][nonce].eligibleTaker = taker;
        emit UpdateEligibleTaker(user, nonce, taker);

        try OmniChaiGateway(address(this)).executeDepositRequest(user, nonce) {} catch {
            emit FailedExecutingDepositRequest(user, nonce, taker);
        }
    }

    function _sendCancelAck(uint16, bytes memory, uint64, bytes memory _payload) internal {
        (, address user, uint256 nonce) = abi.decode(_payload, (uint16, address, uint256));

        DepositRequest storage request = _depositRequests[msg.sender][nonce];
        require(request.status == Status.Pending, "OmniChaiGateway: invalid status"); //TODO custom Err
        require(request.eligibleTaker == address(0), "OmniChaiGateway: invalid taker"); //TODO custom Err

        request.status = Status.Cancelled;

        IERC20(dai).transfer(user, request.amount);
        emit CancelDeposit(user, nonce);
    }
}
