// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {MockUSDC} from "../mocks/MockUSDC.sol";
import {MockCCTPMessenger} from "./MockCCTPMessenger.sol";
import {SluiceHooks} from "./SluiceGate.sol";

/// @notice A venue the treasury can park idle escrow in. USDC is transferred to the
///         adapter before `deposit` is called.
interface IYieldAdapter {
    function deposit(uint256 amount) external;
    /// @return paid Amount actually sent back to the treasury (0 for async/remote).
    function withdraw(uint256 amount) external returns (uint256 paid);
    function totalAssets() external view returns (uint256);
    function name() external view returns (string memory);
    function apyBps() external view returns (uint256);
    function chainDomain() external view returns (uint32);
    function isRemote() external view returns (bool);
}

/// @notice Local money-market stand-in ("Aave on Arc"): interest accrues per second
///         at a fixed APY, realized by minting mock USDC on withdrawal.
contract MockYieldAdapter is IYieldAdapter {
    MockUSDC public immutable usdc;
    address public immutable treasury;
    string private _name;
    uint256 private immutable _apyBps;
    uint32 private immutable _domain;

    uint256 public principal;
    uint256 public lastAccrued;

    modifier onlyTreasury() {
        require(msg.sender == treasury, "Adapter: only treasury");
        _;
    }

    constructor(MockUSDC usdc_, address treasury_, string memory name_, uint256 apyBps_, uint32 domain_) {
        usdc = usdc_;
        treasury = treasury_;
        _name = name_;
        _apyBps = apyBps_;
        _domain = domain_;
        lastAccrued = block.timestamp;
    }

    function _pendingInterest() internal view returns (uint256) {
        if (principal == 0) return 0;
        return (principal * _apyBps * (block.timestamp - lastAccrued)) / (365 days * 10_000);
    }

    function _accrue() internal {
        uint256 interest = _pendingInterest();
        if (interest > 0) {
            usdc.mint(address(this), interest);
            principal += interest;
        }
        lastAccrued = block.timestamp;
    }

    function deposit(uint256 amount) external onlyTreasury {
        _accrue();
        principal += amount;
    }

    function withdraw(uint256 amount) external onlyTreasury returns (uint256 paid) {
        _accrue();
        paid = amount > principal ? principal : amount;
        principal -= paid;
        require(usdc.transfer(treasury, paid), "Adapter: transfer failed");
    }

    function totalAssets() external view returns (uint256) {
        return principal + _pendingInterest();
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

/// @notice Cross-chain position: deposits burn USDC via CCTP into a RemoteYieldVault
///         on another chain; NAV is estimated locally from the vault's APY, and funds
///         come home asynchronously via a hooked CCTP return.
contract CCTPRemoteAdapter is IYieldAdapter {
    MockUSDC public immutable usdc;
    MockCCTPMessenger public immutable messenger;
    address public immutable treasury;
    address public immutable remoteVault;
    uint32 private immutable _destDomain;
    string private _name;
    uint256 private immutable _apyBps;

    uint256 public principalSent;
    uint256 public sentAt;

    modifier onlyTreasury() {
        require(msg.sender == treasury, "Adapter: only treasury");
        _;
    }

    constructor(
        MockUSDC usdc_,
        MockCCTPMessenger messenger_,
        address treasury_,
        address remoteVault_,
        uint32 destDomain_,
        string memory name_,
        uint256 apyBps_
    ) {
        usdc = usdc_;
        messenger = messenger_;
        treasury = treasury_;
        remoteVault = remoteVault_;
        _destDomain = destDomain_;
        _name = name_;
        _apyBps = apyBps_;
    }

    function deposit(uint256 amount) external onlyTreasury {
        if (principalSent == 0) sentAt = block.timestamp;
        principalSent += amount;
        usdc.approve(address(messenger), amount);
        messenger.depositForBurnWithHook(
            amount, _destDomain, remoteVault, abi.encode(SluiceHooks.REMOTE_DEPOSIT, bytes(""))
        );
    }

    /// @dev Remote liquidity cannot be pulled synchronously — the treasury emits a
    ///      RemoteReturnRequested event and the relayer triggers the vault's exit.
    function withdraw(uint256) external view onlyTreasury returns (uint256) {
        return 0;
    }

    /// @notice Called by the treasury when hooked funds arrive back from the vault.
    function onReturn(uint256 amount) external onlyTreasury {
        principalSent = amount >= principalSent ? 0 : principalSent - amount;
        if (principalSent == 0) sentAt = 0;
    }

    function totalAssets() external view returns (uint256) {
        if (principalSent == 0) return 0;
        return principalSent + (principalSent * _apyBps * (block.timestamp - sentAt)) / (365 days * 10_000);
    }

    function name() external view returns (string memory) {
        return _name;
    }

    function apyBps() external view returns (uint256) {
        return _apyBps;
    }

    function chainDomain() external view returns (uint32) {
        return _destDomain;
    }

    function isRemote() external pure returns (bool) {
        return true;
    }
}
