// SPDX-License-Identifier: MIT
pragma solidity ^0.8.18;

import "@layerzerolabs/solidity-examples/contracts/lzApp/NonblockingLzApp.sol";
import "@openzeppelin/contracts/interfaces/IERC20.sol";
import "@openzeppelin/contracts/utils/Address.sol";

/**
 * @title oChaiTransceiver
 * @author TheGreatHB
 * @notice drafts of the oChaiTransceiver contract
 */

interface IOChaiOnGnosis {
    function useCustomAdapterParams() external view returns (bool);

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
}

interface IOChaiTransceiverOnGnosis is ILayerZeroReceiver {
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

    event SetBaseMinDstGas(uint16 packetType, uint256 minDstGas);
    event RecordDepositRequest(uint16 srcChainId, address requester, uint256 nonce, uint256 amount, uint256 fee);
    event ForwardCancelDepositToSrcChain(address user, uint256 nonce);

    event ExecuteDepositRequest(
        uint16 srcChainId,
        address requester,
        uint256 nonce,
        address taker,
        uint256 totalDaiAmount,
        uint256 feeToTaker,
        uint256 oChaiAmount
    );

    function oChai() external view returns (address);

    function wxdai() external view returns (address);

    function baseMinDstGasLookup(uint16 packetType) external view returns (uint256);

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

interface IOChaiTransceiver is ILayerZeroReceiver {
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

interface IWXDAI {
    function deposit() external payable;

    function withdraw(uint256) external;

    function approve(address guy, uint256 wad) external returns (bool);

    function transferFrom(address src, address dst, uint256 wad) external returns (bool);

    function transfer(address dst, uint256 wad) external returns (bool);
}

contract oChaiTransceiver is NonblockingLzApp, IOChaiTransceiver {
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
        if (minDstGasLookup[CHAIN_ID_GNOSIS][PT_SEND_DEPOSIT] > gaslimit) revert("oChaiTransceiver: gaslimit too low"); //TODO custom Err

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
        if (minDstGasLookup[CHAIN_ID_GNOSIS][PT_SEND_DEPOSIT] > gaslimit) revert("oChaiTransceiver: gaslimit too low"); //TODO custom Err
        if (nativeForDst == 0) revert("oChaiTransceiver: nativeForDst must be > 0"); //TODO custom Err

        DepositRequest storage request = _depositRequests[msg.sender][nonce];
        require(request.status == Status.Pending, "oChaiTransceiver: invalid status"); //TODO custom Err

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
        require(request.status == Status.Pending, "oChaiTransceiver: invalid status"); //TODO custom Err
        require(msg.sender == address(this) || request.eligibleTaker == msg.sender, "oChaiTransceiver: invalid taker"); //TODO custom Err

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
        require(request.status == Status.Pending, "oChaiTransceiver: invalid status"); //TODO custom Err
        request.status = Status.Cancelled;

        IERC20(oChai).transfer(msg.sender, request.amount);
        emit RequestCancelRedeem(msg.sender, nonce);
    }

    function executeRedeemRequest(address user, uint256 nonce) external {
        RedeemRequest storage request = _redeemRequests[user][nonce];
        require(request.status == Status.Pending, "oChaiTransceiver: invalid status"); //TODO custom Err
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
        require(_srcChainId == CHAIN_ID_GNOSIS, "oChaiTransceiver: invalid srcChainId"); //TODO custom Err

        uint16 packetType;
        assembly {
            packetType := mload(add(_payload, 32))
        }

        if (packetType == PT_SEND_DEPOSIT) {
            _sendDepositAck(_srcChainId, _srcAddress, _nonce, _payload);
        } else if (packetType == PT_SEND_CANCEL) {
            _sendCancelAck(_srcChainId, _srcAddress, _nonce, _payload);
        } else {
            revert("oChaiTransceiver: unknown packet type");
        }
    }

    function _sendDepositAck(uint16, bytes memory, uint64, bytes memory _payload) internal {
        (, address user, uint256 nonce, address taker) = abi.decode(_payload, (uint16, address, uint256, address));

        _depositRequests[user][nonce].eligibleTaker = taker;
        emit UpdateEligibleTaker(user, nonce, taker);

        try oChaiTransceiver(address(this)).executeDepositRequest(user, nonce) {} catch {
            emit FailedExecutingDepositRequest(user, nonce, taker);
        }
    }

    function _sendCancelAck(uint16, bytes memory, uint64, bytes memory _payload) internal {
        (, address user, uint256 nonce) = abi.decode(_payload, (uint16, address, uint256));

        DepositRequest storage request = _depositRequests[msg.sender][nonce];
        require(request.status == Status.Pending, "oChaiTransceiver: invalid status"); //TODO custom Err
        require(request.eligibleTaker == address(0), "oChaiTransceiver: invalid taker"); //TODO custom Err

        request.status = Status.Cancelled;

        IERC20(dai).transfer(user, request.amount);
        emit CancelDeposit(user, nonce);
    }
}

contract oChaiTransceiverOnGnosis is NonblockingLzApp, IOChaiTransceiverOnGnosis {
    uint16 public constant PT_SEND_DEPOSIT = 1;
    uint16 public constant PT_SEND_CANCEL = 2;

    address public immutable oChai;
    address public immutable wxdai;

    mapping(uint16 srcChainId => mapping(address user => mapping(uint256 nonce => DepositRequest)))
        internal _depositRequests;

    mapping(uint16 packetType => uint256) public baseMinDstGasLookup;

    constructor(address _endpoint, address _oChai, address _wxdai, address _owner) NonblockingLzApp(_endpoint) {
        oChai = _oChai;
        wxdai = _wxdai;
        _transferOwnership(_owner);
    }

    receive() external payable {}

    function setBaseMinDstGas(uint16 packetType, uint256 minDstGas) external onlyOwner {
        baseMinDstGasLookup[packetType] = minDstGas;
        emit SetBaseMinDstGas(packetType, minDstGas);
    }

    function _getMinDstGas(uint16 chainId, uint16 packetType) internal view returns (uint256 minDstGas) {
        minDstGas = baseMinDstGasLookup[packetType];
        if (minDstGas == 0) minDstGas = minDstGasLookup[chainId][packetType];
    }

    function _getGasLimit(
        uint16 chainId,
        uint16 packetType,
        uint256 givenGasLimit
    ) internal view returns (uint256 gasLimit) {
        uint256 minDstGas = _getMinDstGas(chainId, packetType);
        if (givenGasLimit < minDstGas) gasLimit = minDstGas;
        else gasLimit = givenGasLimit;
    }

    function depositRequest(
        uint16 srcChainId,
        address user,
        uint256 nonce
    ) external view returns (DepositRequest memory) {
        return _depositRequests[srcChainId][user][nonce];
    }

    function executeDepositRequest(
        uint16 srcChainId,
        address user,
        uint256 nonce,
        address _zroPaymentAddress,
        uint256[] memory gaslimits,
        uint256[] memory msgValues
    ) external payable {
        DepositRequest memory request = _depositRequests[srcChainId][user][nonce];
        require(request.status == Status.Pending, "oChaiTransceiverOnGnosis: invalid status"); //TODO custom Err

        _depositRequests[srcChainId][user][nonce].status = Status.Completed;

        // mints oChai to the requester on srcChain
        uint256 oChaiAmount = IOChaiOnGnosis(oChai).depositAndSendFrom{value: msgValues[0]}(
            request.amount - request.fee,
            srcChainId,
            abi.encodePacked(user),
            payable(address(this)),
            _zroPaymentAddress,
            IOChaiOnGnosis(oChai).useCustomAdapterParams() ? abi.encodePacked(uint16(1), gaslimits[0]) : bytes("")
        );

        // lzCall to update the eligible taker on srcChain and transfer assets to the taker on srcChain
        _lzSend(
            srcChainId,
            abi.encode(PT_SEND_DEPOSIT, user, nonce, msg.sender),
            payable(address(this)),
            _zroPaymentAddress,
            abi.encodePacked(uint16(1), _getGasLimit(srcChainId, PT_SEND_DEPOSIT, gaslimits[1])),
            msgValues[1]
        );

        Address.sendValue(payable(msg.sender), address(this).balance);

        emit ExecuteDepositRequest(srcChainId, user, nonce, msg.sender, request.amount, request.fee, oChaiAmount);
    }

    function executeDepositRequestXDAI(
        uint16 srcChainId,
        address user,
        uint256 nonce,
        address _zroPaymentAddress,
        uint256[] memory gaslimits,
        uint256[] memory msgValues
    ) external payable {
        DepositRequest memory request = _depositRequests[srcChainId][user][nonce];
        require(request.status == Status.Pending, "oChaiTransceiverOnGnosis: invalid status"); //TODO custom Err

        _depositRequests[srcChainId][user][nonce].status = Status.Completed;

        // mints oChai to the requester on srcChain
        uint256 oChaiAmount = IOChaiOnGnosis(oChai).depositXDAIAndSendFrom{value: msgValues[0]}(
            request.amount - request.fee,
            srcChainId,
            abi.encodePacked(user),
            payable(address(this)),
            _zroPaymentAddress,
            IOChaiOnGnosis(oChai).useCustomAdapterParams() ? abi.encodePacked(uint16(1), gaslimits[0]) : bytes("")
        );

        // lzCall to update the eligible taker on srcChain and transfer assets to the taker on srcChain
        _lzSend(
            srcChainId,
            abi.encode(PT_SEND_DEPOSIT, user, nonce, msg.sender),
            payable(address(this)),
            _zroPaymentAddress,
            abi.encodePacked(uint16(1), _getGasLimit(srcChainId, PT_SEND_DEPOSIT, gaslimits[1])),
            msgValues[1]
        );

        Address.sendValue(payable(msg.sender), address(this).balance);

        emit ExecuteDepositRequest(srcChainId, user, nonce, msg.sender, request.amount, request.fee, oChaiAmount);
    }

    function _nonblockingLzReceive(
        uint16 _srcChainId,
        bytes memory _srcAddress,
        uint64 _nonce,
        bytes memory _payload
    ) internal override {
        uint16 packetType;
        assembly {
            packetType := mload(add(_payload, 32))
        }

        if (packetType == PT_SEND_DEPOSIT) {
            _deposit(_srcChainId, _srcAddress, _nonce, _payload);
        } else if (packetType == PT_SEND_CANCEL) {
            _cancel(_srcChainId, _srcAddress, _nonce, _payload);
        } else {
            revert("oChaiTransceiverOnGnosis: unknown packet type");
        }
    }

    function _deposit(uint16 _srcChainId, bytes memory, uint64, bytes memory _payload) internal {
        (, address user, uint256 amount, uint256 fee, uint256 nonce) = abi.decode(
            _payload,
            (uint16, address, uint256, uint256, uint256)
        );

        DepositRequest storage request = _depositRequests[_srcChainId][user][nonce];
        require(request.status == Status.Pending, "oChaiTransceiverOnGnosis: invalid status"); //TODO custom Err

        request.amount = amount;
        request.fee = fee;

        emit RecordDepositRequest(_srcChainId, user, nonce, amount, fee);
    }

    function _cancel(uint16 _srcChainId, bytes memory, uint64, bytes memory _payload) internal {
        (, address user, uint256 nonce, uint256 returnCallGaslimit) = abi.decode(
            _payload,
            (uint16, address, uint256, uint256)
        );

        DepositRequest storage request = _depositRequests[_srcChainId][user][nonce];
        require(request.status == Status.Pending, "oChaiTransceiverOnGnosis: invalid status"); //TODO custom Err

        request.status = Status.Cancelled;

        bytes memory payload = abi.encode(PT_SEND_CANCEL, msg.sender, nonce);
        _lzSend(
            _srcChainId,
            payload,
            payable(user),
            address(0),
            abi.encodePacked(uint16(1), _getGasLimit(_srcChainId, PT_SEND_CANCEL, returnCallGaslimit)),
            address(this).balance
        );

        emit ForwardCancelDepositToSrcChain(user, nonce);
    }
}
