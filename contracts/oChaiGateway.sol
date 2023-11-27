// SPDX-License-Identifier: MIT
pragma solidity ^0.8.18;

import "@layerzerolabs/solidity-examples/contracts/lzApp/NonblockingLzApp.sol";
import "@openzeppelin/contracts/interfaces/IERC20.sol";
import "@openzeppelin/contracts/utils/Address.sol";
import "./interfaces/IOmniChaiGateway.sol";
import "./interfaces/IUniversalStorage.sol";

contract OmniChaiGateway is NonblockingLzApp, IOmniChaiGateway {
    using BytesLib for bytes;

    error InvalidStatus();
    error InvalidTaker();
    error InvalidSrcChain();
    error InvalidPacketType();
    error TooLowGasLimit(uint256 minGasLimit, uint256 providedGasLimit);
    error InvalidNativeForDst();
    error UncancellableDeposit();
    error TooLowFee(uint256 minFee, uint256 providedFee);
    error ExpiredRequest();
    error InvalidDeadline();
    error InvalidAmount();

    uint16 public constant PT_SEND_DEPOSIT = 1;
    uint16 public constant PT_SEND_CANCEL = 2;

    uint16 public immutable CHAIN_ID_GNOSIS;
    uint16 public constant MINIMUM_FEE_RATE = 10; // 0.1%

    //keccak256("lzEndpoint");
    bytes32 private constant LZ_EP_SLOT = 0x56be12b30f425a33a2943931f159bd39e83ed09e4ad9e0d4567a2fac237761c7;
    //keccak256("daioChai");
    bytes32 private constant DAI_OCHAI_SLOT = 0x2e3859ec9fc81630187d358e1fb32dbba14ac40a1bf667d0d6ddb77cc9b1fb15;

    address public immutable oChai;
    address public immutable dai;

    mapping(address user => DepositRequest[]) internal _depositRequests;
    mapping(address user => RedeemRequest[]) internal _redeemRequests;

    constructor(
        IUniversalStorage _universalStorage,
        uint16 gnosis_chain_id,
        address _owner
    ) NonblockingLzApp(_calculateEndpoint(_universalStorage)) {
        bytes memory d = _universalStorage.getBytesData(DAI_OCHAI_SLOT);
        dai = d.toAddress(0);
        oChai = d.toAddress(20);

        CHAIN_ID_GNOSIS = gnosis_chain_id;
        _transferOwnership(_owner);
    }

    function _calculateEndpoint(IUniversalStorage _universalStorage) private view returns (address) {
        bytes memory d = _universalStorage.getBytesData(LZ_EP_SLOT);
        return d.toAddress(0);
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

    function estimateFeeRequestDeposit(
        uint256 amount,
        uint256 fee,
        address _zroPaymentAddress,
        uint256 gaslimit
    ) external view returns (uint256 lzNativeFee, uint256 lzZROFee) {
        (lzNativeFee, lzZROFee) = lzEndpoint.estimateFees(
            CHAIN_ID_GNOSIS,
            address(this),
            abi.encode(PT_SEND_DEPOSIT, msg.sender, amount, fee, depositNonce(msg.sender)),
            _zroPaymentAddress != address(0),
            abi.encodePacked(uint16(1), gaslimit)
        );
    }

    function estimateFeeRequestCancelDeposit(
        uint256 nonce,
        address _zroPaymentAddress,
        uint256 gaslimit,
        uint256 nativeForDst,
        uint256 returnCallGaslimit
    ) external view returns (uint256 lzNativeFee, uint256 lzZROFee) {
        (lzNativeFee, lzZROFee) = lzEndpoint.estimateFees(
            CHAIN_ID_GNOSIS,
            address(this),
            abi.encode(PT_SEND_CANCEL, msg.sender, nonce, returnCallGaslimit),
            _zroPaymentAddress != address(0),
            abi.encodePacked(uint16(2), gaslimit, nativeForDst, trustedRemoteLookup[CHAIN_ID_GNOSIS].toAddress(0))
        );
    }

    function requestDeposit(
        uint256 amount,
        uint256 fee,
        address payable _refundAddress,
        address _zroPaymentAddress,
        uint256 gaslimit
    ) external payable {
        if (amount == 0) revert InvalidAmount();
        uint256 minFee = (amount * MINIMUM_FEE_RATE) / 10000;
        if (fee < minFee) revert TooLowFee(minFee, fee);
        if (minDstGasLookup[CHAIN_ID_GNOSIS][PT_SEND_DEPOSIT] > gaslimit)
            revert TooLowGasLimit(minDstGasLookup[CHAIN_ID_GNOSIS][PT_SEND_DEPOSIT], gaslimit);

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
        if (nativeForDst == 0) revert InvalidNativeForDst();
        if (minDstGasLookup[CHAIN_ID_GNOSIS][PT_SEND_CANCEL] > gaslimit)
            revert TooLowGasLimit(minDstGasLookup[CHAIN_ID_GNOSIS][PT_SEND_CANCEL], gaslimit);

        DepositRequest storage request = _depositRequests[msg.sender][nonce];
        if (request.status != Status.Pending) revert InvalidStatus();

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
        if (request.status != Status.Pending) revert InvalidStatus();
        address taker = request.eligibleTaker;
        if (msg.sender != address(this) && taker != msg.sender) revert InvalidTaker();

        request.status = Status.Completed;

        IERC20(dai).transfer(taker, request.amount);
        emit ExecuteDepositRequest(user, nonce, taker, request.amount);
    }

    function requestRedeem(uint256 amount, uint256 desiredDai, uint256 deadline) external {
        if (deadline <= block.timestamp) revert InvalidDeadline();
        if (amount == 0 || desiredDai == 0) revert InvalidAmount();
        uint256 nonce = redeemNonce(msg.sender);

        _redeemRequests[msg.sender].push(RedeemRequest(Status.Pending, amount, desiredDai, deadline));
        IERC20(oChai).transferFrom(msg.sender, address(this), amount);
        emit RequestRedeem(msg.sender, nonce, amount, desiredDai, deadline);
    }

    function requestCancelRedeem(uint256 nonce) external {
        RedeemRequest storage request = _redeemRequests[msg.sender][nonce];
        if (request.status != Status.Pending) revert InvalidStatus();
        request.status = Status.Cancelled;

        IERC20(oChai).transfer(msg.sender, request.amount);
        emit RequestCancelRedeem(msg.sender, nonce);
    }

    function executeRedeemRequest(address user, uint256 nonce) external {
        RedeemRequest storage request = _redeemRequests[user][nonce];
        if (block.timestamp > request.deadline) revert ExpiredRequest();
        if (request.status != Status.Pending) revert InvalidStatus();
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
        if (_srcChainId != CHAIN_ID_GNOSIS) revert InvalidSrcChain();

        uint16 packetType;
        assembly {
            packetType := mload(add(_payload, 32))
        }

        if (packetType == PT_SEND_DEPOSIT) {
            _sendDepositAck(_srcChainId, _srcAddress, _nonce, _payload);
        } else if (packetType == PT_SEND_CANCEL) {
            _sendCancelAck(_srcChainId, _srcAddress, _nonce, _payload);
        } else {
            revert InvalidPacketType();
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

        DepositRequest storage request = _depositRequests[user][nonce];
        if (request.status != Status.Pending) revert InvalidStatus();
        if (request.eligibleTaker != address(0)) revert UncancellableDeposit();

        request.status = Status.Cancelled;

        IERC20(dai).transfer(user, request.amount);
        emit CancelDeposit(user, nonce);
    }
}
