// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Sluice, IERC20} from "../Sluice.sol";
import {ICCTPHookReceiver} from "./CCTPInterfaces.sol";
import {SluiceHooks} from "./SluiceGate.sol";
import {IYieldAdapter, CCTPRemoteAdapter} from "./YieldAdapters.sol";

/// @title SluiceTreasury — cross-chain auto-yield routing for idle payroll escrow
/// @notice Receives idle escrow swept from Sluice, allocates it across yield
///         venues (an on-chain reserve vault on Arc + CCTP-bridged remote vaults),
///         and returns liquidity on demand when Sluice's withdrawal buffer runs
///         low. Remote positions come home via hooked CCTP mints delivered by the
///         attestation relayer.
contract SluiceTreasury is ICCTPHookReceiver {
    Sluice public immutable sluice;
    IERC20 public immutable usdc;
    address public immutable deployer;
    /// @notice Attestation relayer authorized to execute inbound return hooks.
    address public immutable relayer;

    IYieldAdapter[] public adapters;
    uint256[] public targetBps;

    /// @notice Net escrow swept from Sluice and still outstanding.
    uint256 public principal;

    event Swept(uint256 amount);
    event Recalled(uint256 amount);
    event Rebalanced(uint256[] allocations);
    event RemoteReturnRequested(address indexed vault, uint32 indexed domain);
    event RemoteReturned(uint256 amount);

    modifier onlySluice() {
        require(msg.sender == address(sluice), "Treasury: only sluice");
        _;
    }

    constructor(Sluice sluice_, address relayer_) {
        require(relayer_ != address(0), "Treasury: relayer zero");
        sluice = sluice_;
        usdc = sluice_.usdc();
        deployer = msg.sender;
        relayer = relayer_;
    }

    /// @notice Deploy-time wiring of yield venues and their target weights.
    function addAdapter(IYieldAdapter adapter, uint256 targetBps_) external {
        require(msg.sender == deployer, "Treasury: only deployer");
        adapters.push(adapter);
        targetBps.push(targetBps_);
    }

    // ------------------------------------------------------------------ views

    function adapterCount() external view returns (uint256) {
        return adapters.length;
    }

    /// @notice Unallocated USDC sitting in the treasury.
    function idle() public view returns (uint256) {
        return usdc.balanceOf(address(this));
    }

    /// @notice NAV: idle + every adapter position marked at current accrual.
    function totalAssets() public view returns (uint256) {
        uint256 total = idle();
        for (uint256 i = 0; i < adapters.length; i++) {
            total += adapters[i].totalAssets();
        }
        return total;
    }

    /// @notice Lifetime yield: NAV in excess of swept principal.
    function yieldEarned() external view returns (uint256) {
        uint256 assets = totalAssets();
        return assets > principal ? assets - principal : 0;
    }

    /// @notice Flat arrays for the frontend treasury page.
    function adaptersInfo()
        external
        view
        returns (
            string[] memory names,
            uint256[] memory apys,
            uint256[] memory assets,
            uint32[] memory domains,
            bool[] memory remote
        )
    {
        uint256 n = adapters.length;
        names = new string[](n);
        apys = new uint256[](n);
        assets = new uint256[](n);
        domains = new uint32[](n);
        remote = new bool[](n);
        for (uint256 i = 0; i < n; i++) {
            names[i] = adapters[i].name();
            apys[i] = adapters[i].apyBps();
            assets[i] = adapters[i].totalAssets();
            domains[i] = adapters[i].chainDomain();
            remote[i] = adapters[i].isRemote();
        }
    }

    // ------------------------------------------------------------ sluice flows

    /// @notice Called by Sluice right after it transfers swept escrow here.
    function notifyDeposit(uint256 amount) external onlySluice {
        principal += amount;
        emit Swept(amount);
    }

    /// @notice Sluice pulls liquidity back to cover a withdrawal: idle first, then
    ///         local adapters. Remote funds return asynchronously via the relayer.
    function recall(uint256 amount) external onlySluice {
        uint256 have = idle();
        for (uint256 i = 0; i < adapters.length && have < amount; i++) {
            if (!adapters[i].isRemote()) {
                have += adapters[i].withdraw(amount - have);
            }
        }
        require(usdc.balanceOf(address(this)) >= amount, "Treasury: illiquid");
        principal = amount >= principal ? 0 : principal - amount;
        require(usdc.transfer(address(sluice), amount), "Treasury: transfer failed");
        emit Recalled(amount);
    }

    // ------------------------------------------------------------- allocation

    /// @notice Allocate idle USDC across adapters per target weights. Anyone can poke.
    function rebalance() external {
        uint256 available = idle();
        require(available > 0, "Treasury: nothing to allocate");
        uint256[] memory allocations = new uint256[](adapters.length);
        for (uint256 i = 0; i < adapters.length; i++) {
            uint256 share = (available * targetBps[i]) / 10_000;
            if (share == 0) continue;
            allocations[i] = share;
            require(usdc.transfer(address(adapters[i]), share), "Treasury: transfer failed");
            adapters[i].deposit(share);
        }
        emit Rebalanced(allocations);
    }

    /// @notice Ask the relayer to bring a remote vault position home (principal +
    ///         accrued yield arrive via a hooked CCTP mint).
    function requestRemoteReturn(uint256 adapterIndex) external {
        IYieldAdapter adapter = adapters[adapterIndex];
        require(adapter.isRemote(), "Treasury: not remote");
        emit RemoteReturnRequested(CCTPRemoteAdapter(address(adapter)).remoteVault(), adapter.chainDomain());
    }

    /// @notice Inbound hook for funds coming back from remote vaults, executed by
    ///         the attestation relayer after the CCTP mint lands.
    function onCCTPHook(uint32, uint256 amount, bytes calldata hookData) external {
        require(msg.sender == relayer, "Treasury: only relayer");
        require(usdc.balanceOf(address(this)) >= amount, "Treasury: funds not arrived");
        (uint8 action,) = abi.decode(hookData, (uint8, bytes));
        require(action == SluiceHooks.REMOTE_RETURN, "Treasury: unknown action");
        for (uint256 i = 0; i < adapters.length; i++) {
            if (adapters[i].isRemote()) {
                CCTPRemoteAdapter(address(adapters[i])).onReturn(amount);
                break; // exactly one position comes home per return message
            }
        }
        emit RemoteReturned(amount);
    }
}
