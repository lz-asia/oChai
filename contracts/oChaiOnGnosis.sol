// SPDX-License-Identifier: MIT
pragma solidity ^0.8.18;

import "@layerzerolabs/solidity-examples/contracts/token/oft/extension/BasedOFT.sol";
import "@openzeppelin/contracts/interfaces/IERC4626.sol";
import "@openzeppelin/contracts/utils/Address.sol";
import "./interfaces/IWXDAI.sol";
import "./interfaces/IBridgeInterestReceiver.sol";

contract OmniChaiOnGnosis is BasedOFT, IERC4626 {
    error InvalidChainId();
    error InvalidReceiver();

    IWXDAI public constant wxdai = IWXDAI(0xe91D153E0b41518A2Ce8Dd3D7944Fa863463a97d);
    IERC4626 public constant sDAI = IERC4626(0xaf204776c7245bF4147c2612BF6e5972Ee483701);
    IBridgeInterestReceiver public immutable interestReceiver =
        IBridgeInterestReceiver(0x670daeaF0F1a5e336090504C68179670B5059088);

    constructor(address _layerZeroEndpoint) BasedOFT("OmniChaiOnGnosis", "oChai", _layerZeroEndpoint) {
        if (block.chainid != 100) revert InvalidChainId();

        wxdai.approve(address(sDAI), type(uint256).max);
    }

    receive() external payable {}

    function asset() public view returns (address assetTokenAddress) {
        return sDAI.asset();
    }

    function totalAssets() public view returns (uint256 totalManagedAssets) {
        return sDAI.convertToAssets(sDAI.balanceOf(address(this)));
    }

    function convertToShares(uint256 assets) public view returns (uint256 shares) {
        return sDAI.convertToShares(assets);
    }

    function convertToAssets(uint256 shares) public view returns (uint256 assets) {
        return sDAI.convertToAssets(shares);
    }

    function maxDeposit(address receiver) public view returns (uint256 maxAssets) {
        return sDAI.maxDeposit(receiver);
    }

    function previewDeposit(uint256 assets) public view returns (uint256 shares) {
        return sDAI.previewDeposit(assets);
    }

    function maxMint(address receiver) public view returns (uint256 maxShares) {
        return sDAI.maxMint(receiver);
    }

    function previewMint(uint256 shares) public view returns (uint256 assets) {
        return sDAI.previewMint(shares);
    }

    function maxWithdraw(address owner) public view returns (uint256 maxAssets) {
        return sDAI.convertToAssets(balanceOf(owner));
    }

    function previewWithdraw(uint256 assets) public view returns (uint256 shares) {
        return sDAI.previewWithdraw(assets);
    }

    function maxRedeem(address owner) public view returns (uint256 maxShares) {
        return balanceOf(owner);
    }

    function previewRedeem(uint256 shares) public view returns (uint256 assets) {
        return sDAI.previewRedeem(shares);
    }

    function decimals() public view override(ERC20, IERC20Metadata) returns (uint8) {
        return sDAI.decimals();
    }

    function vaultAPY() external view returns (uint256) {
        return interestReceiver.vaultAPY();
    }

    // internal functions
    function _mintOChai(address caller, address receiver, uint256 assets, uint256 shares) internal {
        _mint(receiver, shares);
        emit Deposit(caller, receiver, assets, shares);
    }

    function _burnOChai(address caller, address receiver, address owner, uint256 assets, uint256 shares) internal {
        if (caller != owner) {
            _spendAllowance(owner, caller, shares);
        }

        _burn(owner, shares);
        emit Withdraw(caller, receiver, owner, assets, shares);
    }

    // call functions
    function deposit(uint256 assets, address receiver) public returns (uint256 shares) {
        if (receiver == address(0) || receiver == address(this)) revert InvalidReceiver();

        wxdai.transferFrom(msg.sender, address(this), assets);
        shares = sDAI.deposit(assets, address(this));

        _mintOChai(msg.sender, receiver, assets, shares);
    }

    function mint(uint256 shares, address receiver) public returns (uint256 assets) {
        if (receiver == address(0) || receiver == address(this)) revert InvalidReceiver();

        wxdai.transferFrom(msg.sender, address(this), sDAI.previewMint(shares));
        assets = sDAI.mint(shares, address(this));

        _mintOChai(msg.sender, receiver, assets, shares);
    }

    function withdraw(uint256 assets, address receiver, address owner) public returns (uint256 shares) {
        if (receiver == address(0) || receiver == address(this)) revert InvalidReceiver();

        shares = sDAI.withdraw(assets, address(this), address(this));
        _burnOChai(msg.sender, receiver, owner, assets, shares);
        wxdai.transfer(receiver, assets);
    }

    function redeem(uint256 shares, address receiver, address owner) public returns (uint256 assets) {
        if (receiver == address(0) || receiver == address(this)) revert InvalidReceiver();

        assets = sDAI.redeem(shares, address(this), address(this));
        _burnOChai(msg.sender, receiver, owner, assets, shares);
        wxdai.transfer(receiver, assets);
    }

    // xDAI functions
    function depositXDAI(address receiver) public payable returns (uint256 shares) {
        if (receiver == address(0) || receiver == address(this)) revert InvalidReceiver();

        uint256 assets = msg.value;
        if (assets == 0) {
            return 0;
        }
        wxdai.deposit{value: assets}();
        shares = sDAI.deposit(assets, address(this));

        _mintOChai(msg.sender, receiver, assets, shares);
    }

    function withdrawXDAI(uint256 assets, address receiver, address owner) public returns (uint256 shares) {
        if (receiver == address(0) || receiver == address(this)) revert InvalidReceiver();

        if (assets == 0) {
            return 0;
        }

        shares = sDAI.withdraw(assets, address(this), address(this));
        _burnOChai(msg.sender, receiver, owner, assets, shares);

        wxdai.withdraw(assets);
        Address.sendValue(payable(receiver), assets);
    }

    function redeemXDAI(uint256 shares, address receiver, address owner) public returns (uint256 assets) {
        if (receiver == address(0) || receiver == address(this)) revert InvalidReceiver();

        if (shares == 0) {
            return 0;
        }

        assets = sDAI.redeem(shares, address(this), address(this));
        _burnOChai(msg.sender, receiver, owner, assets, shares);

        wxdai.withdraw(assets);
        Address.sendValue(payable(receiver), assets);
    }

    // Wrapper functions
    function depositAndSendFrom(
        uint256 assets,
        uint16 _dstChainId,
        bytes calldata _toAddress,
        address payable _refundAddress,
        address _zroPaymentAddress,
        bytes calldata _adapterParams
    ) external payable returns (uint256 shares) {
        shares = deposit(assets, msg.sender);
        _send(msg.sender, _dstChainId, _toAddress, shares, _refundAddress, _zroPaymentAddress, _adapterParams);
    }

    function depositXDAIAndSendFrom(
        uint256 assets,
        uint16 _dstChainId,
        bytes memory _toAddress,
        address payable _refundAddress,
        address _zroPaymentAddress,
        bytes calldata _adapterParams
    ) external payable returns (uint256 shares) {
        wxdai.deposit{value: assets}();
        shares = sDAI.deposit(assets, address(this));
        _mintOChai(msg.sender, msg.sender, assets, shares);

        _checkAdapterParams(_dstChainId, PT_SEND, _adapterParams, NO_EXTRA_GAS);
        uint amount = _debitFrom(msg.sender, _dstChainId, _toAddress, shares);
        bytes memory lzPayload = abi.encode(PT_SEND, _toAddress, amount);
        _lzSend(_dstChainId, lzPayload, _refundAddress, _zroPaymentAddress, _adapterParams, msg.value - assets);
        emit SendToChain(_dstChainId, msg.sender, _toAddress, amount);
    }

    function mintAndSendFrom(
        uint256 shares,
        uint16 _dstChainId,
        bytes calldata _toAddress,
        address payable _refundAddress,
        address _zroPaymentAddress,
        bytes calldata _adapterParams
    ) external payable returns (uint256 assets) {
        assets = mint(shares, msg.sender);
        _send(msg.sender, _dstChainId, _toAddress, shares, _refundAddress, _zroPaymentAddress, _adapterParams);
    }
}
