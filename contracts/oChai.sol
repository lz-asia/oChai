// SPDX-License-Identifier: MIT
pragma solidity ^0.8.18;

import "@layerzerolabs/solidity-examples/contracts/token/oft/extension/BasedOFT.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";
import "@openzeppelin/contracts/utils/Address.sol";

interface VatLike {
    function hope(address) external;
}

interface PotLike {
    function chi() external view returns (uint256);

    function rho() external view returns (uint256);

    function dsr() external view returns (uint256);

    function drip() external returns (uint256);

    function join(uint256) external;

    function exit(uint256) external;
}

interface DaiJoinLike {
    function vat() external view returns (address);

    function dai() external view returns (address);

    function join(address, uint256) external;

    function exit(address, uint256) external;
}

error InvalidChainId();
error InvalidReceiver();

contract BasedOmniChai is BasedOFT, ERC4626 {
    IERC20 public constant dai = IERC20(0x6B175474E89094C44Da98b954EedeAC495271d0F);
    DaiJoinLike public constant daiJoin = DaiJoinLike(0x9759A6Ac90977b93B58547b4A71c78317f391A28);
    PotLike public constant pot = PotLike(0x197E90f9FAD81970bA7976f33CbD77088E5D7cf7);
    VatLike public constant vat = VatLike(0x35D1b3F3D7966A1DFe207aa4514C12a259A0492B);

    uint256 private constant RAY = 1e27;

    constructor(address _layerZeroEndpoint) BasedOFT("BasedOmniChai", "oChai", _layerZeroEndpoint) ERC4626(dai) {
        if (block.chainid != 1) revert InvalidChainId();

        vat.hope(address(daiJoin));
        vat.hope(address(pot));

        dai.approve(address(daiJoin), type(uint256).max);
    }

    function decimals() public view override(ERC20, ERC4626) returns (uint8) {
        return ERC4626.decimals();
    }

    // internal functions
    // prettier-ignore
    function _rpow(uint x, uint n) internal pure returns (uint z) {
        assembly {
            switch x case 0 {switch n case 0 {z := RAY} default {z := 0}}
            default {
                switch mod(n, 2) case 0 { z := RAY } default { z := x }
                let half := div(RAY, 2)  // for rounding.
                for { n := div(n, 2) } n { n := div(n,2) } {
                    let xx := mul(x, x)
                    if iszero(eq(div(xx, x), x)) { revert(0,0) }
                    let xxRound := add(xx, half)
                    if lt(xxRound, xx) { revert(0,0) }
                    x := div(xxRound, RAY)
                    if mod(n,2) {
                        let zx := mul(z, x)
                        if and(iszero(iszero(x)), iszero(eq(div(zx, x), z))) { revert(0,0) }
                        let zxRound := add(zx, half)
                        if lt(zxRound, zx) { revert(0,0) }
                        z := div(zxRound, RAY)
                    }
                }
            }
        }
    }

    function _getCurrentChi() internal returns (uint256 chi) {
        return (block.timestamp > pot.rho()) ? pot.drip() : pot.chi();
    }

    function _calculateCurrentChi() internal view returns (uint256 chi) {
        uint256 rho = pot.rho();
        return (block.timestamp > rho) ? (_rpow(pot.dsr(), block.timestamp - rho) * pot.chi()) / RAY : pot.chi();
    }

    function _convertToShares(uint256 assets, Math.Rounding rounding) internal view override returns (uint256 shares) {
        return
            rounding == Math.Rounding.Up
                ? Math.ceilDiv((assets * RAY), _calculateCurrentChi())
                : (assets * RAY) / _calculateCurrentChi();
    }

    function _convertToAssets(uint256 shares, Math.Rounding rounding) internal view override returns (uint256 assets) {
        return
            rounding == Math.Rounding.Up
                ? Math.ceilDiv((shares * _calculateCurrentChi()), RAY)
                : (shares * _calculateCurrentChi()) / RAY;
    }

    function _deposit(address caller, address receiver, uint256 assets, uint256 shares) internal override {
        dai.transferFrom(caller, address(this), assets);
        daiJoin.join(address(this), assets);
        pot.join(shares);

        _mint(receiver, shares);

        emit Deposit(caller, receiver, assets, shares);
    }

    function _withdraw(
        address caller,
        address receiver,
        address owner,
        uint256 assets,
        uint256 shares
    ) internal override {
        if (caller != owner) {
            _spendAllowance(owner, caller, shares);
        }

        _burn(owner, shares);
        pot.exit(shares);
        daiJoin.exit(receiver, assets);

        emit Withdraw(caller, receiver, owner, assets, shares);
    }

    // staticcall functions
    function totalAssets() public view override returns (uint256) {
        return convertToAssets(totalSupply());
    }

    // call functions
    function deposit(uint256 assets, address receiver) public override returns (uint256 shares) {
        if (receiver == address(0) || receiver == address(this)) revert InvalidReceiver();

        shares = (assets * RAY) / _getCurrentChi();
        _deposit(msg.sender, receiver, assets, shares);
    }

    function mint(uint256 shares, address receiver) public override returns (uint256 assets) {
        if (receiver == address(0) || receiver == address(this)) revert InvalidReceiver();

        assets = Math.ceilDiv(shares * _getCurrentChi(), RAY);
        _deposit(msg.sender, receiver, assets, shares);
    }

    function withdraw(uint256 assets, address receiver, address owner) public override returns (uint256 shares) {
        if (receiver == address(0) || receiver == address(this)) revert InvalidReceiver();

        shares = Math.ceilDiv(assets * RAY, _getCurrentChi());
        _withdraw(msg.sender, receiver, owner, assets, shares);
    }

    function redeem(uint256 shares, address receiver, address owner) public override returns (uint256 assets) {
        if (receiver == address(0) || receiver == address(this)) revert InvalidReceiver();

        assets = (shares * _getCurrentChi()) / RAY;
        _withdraw(msg.sender, receiver, owner, assets, shares);
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
        shares = (assets * RAY) / _getCurrentChi();
        _deposit(msg.sender, msg.sender, assets, shares);
        _send(msg.sender, _dstChainId, _toAddress, shares, _refundAddress, _zroPaymentAddress, _adapterParams);
    }

    function mintAndSendFrom(
        uint256 shares,
        uint16 _dstChainId,
        bytes calldata _toAddress,
        address payable _refundAddress,
        address _zroPaymentAddress,
        bytes calldata _adapterParams
    ) external payable returns (uint256 assets) {
        assets = Math.ceilDiv(shares * _getCurrentChi(), RAY);
        _deposit(msg.sender, msg.sender, assets, shares);
        _send(msg.sender, _dstChainId, _toAddress, shares, _refundAddress, _zroPaymentAddress, _adapterParams);
    }
}

contract OmniChai is OFT {
    constructor(address _layerZeroEndpoint) OFT("OmniChai", "oChai", _layerZeroEndpoint) {
        if (block.chainid == 1) revert InvalidChainId();
    }
}

interface IWXDAI {
    function deposit() external payable;

    function withdraw(uint256) external;

    function approve(address guy, uint256 wad) external returns (bool);

    function transferFrom(address src, address dst, uint256 wad) external returns (bool);

    function transfer(address dst, uint256 wad) external returns (bool);
}

interface IBridgeInterestReceiver {
    // mutations
    function claim() external;

    // view functions
    function vaultAPY() external view returns (uint256);

    function previewClaimable() external view returns (uint256);

    //variables
    function claimer() external view returns (address);

    function dripRate() external view returns (uint256);

    function nextClaimEpoch() external view returns (uint256);

    function lastClaimTimestamp() external view returns (uint256);

    function currentEpochBalance() external view returns (uint256);

    function epochLength() external view returns (uint256);
}

contract OmniChaiOnGnosis is BasedOFT, IERC4626 {
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
