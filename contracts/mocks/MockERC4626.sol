// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {MockUSDC} from "./MockUSDC.sol";

/// @notice Test double for the Morpho-style ERC-4626 vault Sluice's treasury
///         deposits into on Arc. Share price rises when yield is credited, which
///         is how the real vault's `convertToAssets` grows.
contract MockERC4626 {
    MockUSDC public immutable assetToken;
    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;

    constructor(MockUSDC asset_) {
        assetToken = asset_;
    }

    function asset() external view returns (address) {
        return address(assetToken);
    }

    function totalAssets() public view returns (uint256) {
        return assetToken.balanceOf(address(this));
    }

    function convertToShares(uint256 assets) public view returns (uint256) {
        uint256 supply = totalSupply;
        return supply == 0 || totalAssets() == 0 ? assets : (assets * supply) / totalAssets();
    }

    function convertToAssets(uint256 shares) public view returns (uint256) {
        return totalSupply == 0 ? shares : (shares * totalAssets()) / totalSupply;
    }

    function maxWithdraw(address owner) external view returns (uint256) {
        return convertToAssets(balanceOf[owner]);
    }

    function deposit(uint256 assets, address receiver) external returns (uint256 shares) {
        shares = convertToShares(assets);
        require(assetToken.transferFrom(msg.sender, address(this), assets), "vault: pull failed");
        balanceOf[receiver] += shares;
        totalSupply += shares;
    }

    function withdraw(uint256 assets, address receiver, address owner) external returns (uint256 shares) {
        shares = convertToShares(assets);
        require(balanceOf[owner] >= shares, "vault: insufficient shares");
        balanceOf[owner] -= shares;
        totalSupply -= shares;
        require(assetToken.transfer(receiver, assets), "vault: transfer failed");
    }

    function redeem(uint256 shares, address receiver, address owner) external returns (uint256 assets) {
        assets = convertToAssets(shares);
        balanceOf[owner] -= shares;
        totalSupply -= shares;
        require(assetToken.transfer(receiver, assets), "vault: transfer failed");
    }

    /// @notice Simulate the vault earning interest — share price rises.
    function accrue(uint256 yieldAmount) external {
        assetToken.mint(address(this), yieldAmount);
    }
}
