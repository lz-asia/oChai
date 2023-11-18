// SPDX-License-Identifier: MIT
pragma solidity ^0.8.18;

import "@layerzerolabs/solidity-examples/contracts/lzApp/NonblockingLzApp.sol";
import "@openzeppelin/contracts/interfaces/IERC20.sol";
import "@openzeppelin/contracts/utils/Address.sol";
import "./interfaces/IOmniChaiHub.sol";
import "./interfaces/IOmniChaiOnGnosis.sol";

contract OmniChaiHub is NonblockingLzApp, IOmniChaiHub {
    error InvalidStatus();
    error InsufficientMsgValue();
    error InvalidPacketType();

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

        IERC20(wxdai).approve(oChai, type(uint256).max);
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

    /**
        @notice These function calls invoke lzCall twice. The first call is for minting oChai and transferring it to dstChain, while the second call is for updating the taker and transferring assets on dstChain. If either call fails locally, it won't be a problem. However, if both messages are sent locally but one of them fails on the dstChain, it might pose an issue. Nevertheless, the only likely cause for a failure on the dstChain is a lack of gas. Even if oChai is minted to the user on the dstChain successfully and the updating/transferring of assets fails, the user's deposited DAI remains in the oChaiGateway, and the user cannot withdraw that. The only way to withdraw that is by calling a cancelDepositRequest to this network, which should fail since the status has already been updated as 'Completed' on this network. Therefore, the taker can call retryMessage on the dstChain with a higher gas limit to retrieve it safely. If the minting of oChai fails due to a lack of gas, but the assets were transferred to the taker on the dstChain, this should not be a problem either. The user can simply call retryMessage on the dstChain to receive the oChai. To prevent this inconvenient situation, we can set minDstGas for the message on the dstChain. (Actually, a default gasLimit might be sufficient for cross-chain minting.)
    */
    function executeDepositRequest(
        uint16 srcChainId,
        address user,
        uint256 nonce,
        address _zroPaymentAddress,
        uint256[] memory gaslimits,
        uint256[] memory msgValues
    ) external payable {
        DepositRequest memory request = _depositRequests[srcChainId][user][nonce];
        if (request.status != Status.Pending) revert InvalidStatus();
        if (msgValues[0] + msgValues[1] > msg.value) revert InsufficientMsgValue();

        _depositRequests[srcChainId][user][nonce].status = Status.Completed;

        uint256 amountForDeposit = request.amount - request.fee;
        IERC20(wxdai).transferFrom(msg.sender, address(this), amountForDeposit);

        // mints oChai to the requester on srcChain
        uint256 oChaiAmount = IOmniChaiOnGnosis(oChai).depositAndSendFrom{value: msgValues[0]}(
            amountForDeposit,
            srcChainId,
            abi.encodePacked(user),
            payable(address(this)),
            _zroPaymentAddress,
            IOmniChaiOnGnosis(oChai).useCustomAdapterParams() ? abi.encodePacked(uint16(1), gaslimits[0]) : bytes("")
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
        if (request.status != Status.Pending) revert InvalidStatus();
        if (msgValues[0] + msgValues[1] > msg.value) revert InsufficientMsgValue();

        _depositRequests[srcChainId][user][nonce].status = Status.Completed;

        // mints oChai to the requester on srcChain
        uint256 oChaiAmount = IOmniChaiOnGnosis(oChai).depositXDAIAndSendFrom{value: msgValues[0]}(
            request.amount - request.fee,
            srcChainId,
            abi.encodePacked(user),
            payable(address(this)),
            _zroPaymentAddress,
            IOmniChaiOnGnosis(oChai).useCustomAdapterParams() ? abi.encodePacked(uint16(1), gaslimits[0]) : bytes("")
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
            revert InvalidPacketType();
        }
    }

    function _deposit(uint16 _srcChainId, bytes memory, uint64, bytes memory _payload) internal {
        (, address user, uint256 amount, uint256 fee, uint256 nonce) = abi.decode(
            _payload,
            (uint16, address, uint256, uint256, uint256)
        );

        DepositRequest storage request = _depositRequests[_srcChainId][user][nonce];
        if (request.status != Status.Pending) revert InvalidStatus();

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
        if (request.status != Status.Pending) revert InvalidStatus();

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
