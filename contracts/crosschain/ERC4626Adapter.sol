// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "../Sluice.sol";
import {IYieldAdapter} from "./YieldAdapters.sol";

/// @notice Minimal ERC-4626 surface used by the treasury.
interface IERC4626 {
    function asset() external view returns (address);
    function deposit(uint256 assets, address receiver) external returns (uint256 shares);
    function withdraw(uint256 assets, address receiver, address owner) external returns (uint256 shares);
    function redeem(uint256 shares, address receiver, address owner) external returns (uint256 assets);
    function balanceOf(address account) external view returns (uint256);
    function convertToAssets(uint256 shares) external view returns (uint256 assets);
    function maxWithdraw(address owner) external view returns (uint256);
}

/// @title ERC4626Adapter — treasury position in a real yield vault
/// @notice Routes idle payroll escrow into an ERC-4626 vault (on Arc Testnet:
///         Circle Earn Kit's Morpho USDC vault). Yield is whatever the vault
///         actually earns — the adapter holds shares and marks the position at
///         the live exchange rate, so nothing here is simulated or pre-funded.
contract ERC4626Adapter is IYieldAdapter {
    IERC20 public immutable usdc;
    IERC4626 public immutable vault;
    address public immutable treasury;
    string private _name;
    uint32 private immutable _domain;

    /// @notice Advertised APY in bps, sourced from Circle Earn Kit's vault
    ///         listing. Display only — realized yield comes from the vault.
    uint256 private immutable _apyBps;

    modifier onlyTreasury() {
        require(msg.sender == treasury, "Adapter: only treasury");
        _;
    }

    constructor(IERC4626 vault_, address treasury_, string memory name_, uint256 apyBps_, uint32 domain_) {
        vault = vault_;
        usdc = IERC20(vault_.asset());
        treasury = treasury_;
        _name = name_;
        _apyBps = apyBps_;
        _domain = domain_;
    }

    function deposit(uint256 amount) external onlyTreasury {
        require(usdc.approve(address(vault), amount), "Adapter: approve failed");
        vault.deposit(amount, address(this));
    }

    /// @dev Withdraws up to `amount`, capped by what the vault can actually pay
    ///      out right now (`maxWithdraw`), so a partially liquid vault degrades
    ///      gracefully instead of reverting the whole recall.
    function withdraw(uint256 amount) external onlyTreasury returns (uint256 paid) {
        uint256 available = vault.maxWithdraw(address(this));
        paid = amount > available ? available : amount;
        if (paid == 0) return 0;
        vault.withdraw(paid, treasury, address(this));
    }

    function totalAssets() external view returns (uint256) {
        return vault.convertToAssets(vault.balanceOf(address(this)));
    }

    function name() external view returns (string memory) {
        return _name;
    }

    function apyBps() external view returns (uint256) {
        return _apyBps;
    }

    function chainDomain() external view returns (uint32) {
        return _domain;
    }

    function isRemote() external pure returns (bool) {
        return false;
    }
}
