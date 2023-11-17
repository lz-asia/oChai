// SPDX-License-Identifier: MIT
pragma solidity ^0.8.18;

import "@layerzerolabs/solidity-examples/contracts/lzApp/NonblockingLzApp.sol";
import "@openzeppelin/contracts/interfaces/IERC20.sol";
import "@openzeppelin/contracts/utils/Address.sol";
import "./interfaces/IOmniChaiHub.sol";
import "./interfaces/IOmniChaiOnGnosis.sol";

/**
 * @title OmniChaiHub
 * @author TheGreatHB
 * @notice drafts of the OmniChaiHub contract
 */

contract OmniChaiHub is NonblockingLzApp, IOmniChaiHub {
    uint16 public constant PT_SEND_DEPOSIT = 1;
    uint16 public constant PT_SEND_CANCEL = 2;

    address public immutable oChai;

    mapping(uint16 srcChainId => mapping(address user => mapping(uint256 nonce => DepositRequest)))
        internal _depositRequests;

    mapping(uint16 packetType => uint256) public baseMinDstGasLookup;

    constructor(address _endpoint, address _oChai, address _owner) NonblockingLzApp(_endpoint) {
        oChai = _oChai;
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
        require(request.status == Status.Pending, "OmniChaiHub: invalid status"); //TODO custom Err

        _depositRequests[srcChainId][user][nonce].status = Status.Completed;

        // mints oChai to the requester on srcChain
        uint256 oChaiAmount = IOmniChaiOnGnosis(oChai).depositAndSendFrom{value: msgValues[0]}(
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

    function executeDepositRequestXDAI(
        uint16 srcChainId,
        address user,
        uint256 nonce,
        address _zroPaymentAddress,
        uint256[] memory gaslimits,
        uint256[] memory msgValues
    ) external payable {
        DepositRequest memory request = _depositRequests[srcChainId][user][nonce];
        require(request.status == Status.Pending, "OmniChaiHub: invalid status"); //TODO custom Err

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
            revert("OmniChaiHub: unknown packet type");
        }
    }

    function _deposit(uint16 _srcChainId, bytes memory, uint64, bytes memory _payload) internal {
        (, address user, uint256 amount, uint256 fee, uint256 nonce) = abi.decode(
            _payload,
            (uint16, address, uint256, uint256, uint256)
        );

        DepositRequest storage request = _depositRequests[_srcChainId][user][nonce];
        require(request.status == Status.Pending, "OmniChaiHub: invalid status"); //TODO custom Err

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
        require(request.status == Status.Pending, "OmniChaiHub: invalid status"); //TODO custom Err

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
