// SPDX-License-Identifier: MIT
pragma solidity ^0.8.18;

import "@layerzerolabs/solidity-examples/contracts/token/oft/extension/BasedOFT.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";

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

    // view functions
    function maxDeposit(address) public pure override returns (uint256) {
        return type(uint256).max;
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
}

contract OmniChai is OFT {
    constructor(address _layerZeroEndpoint) OFT("OmniChai", "oChai", _layerZeroEndpoint) {
        if (block.chainid == 1) revert InvalidChainId();
    }
}
