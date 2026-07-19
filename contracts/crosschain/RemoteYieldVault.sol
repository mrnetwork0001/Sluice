// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {MockUSDC} from "../mocks/MockUSDC.sol";
import {MockCCTPMessenger, ICCTPHookReceiver} from "./MockCCTPMessenger.sol";
import {SluiceHooks} from "./SluiceGate.sol";

/// @title RemoteYieldVault — the destination-chain half of cross-chain yield routing
/// @notice Lives on the "Base" chain. Receives hooked CCTP deposits from the Arc
///         treasury, accrues a fixed APY (interest minted in mock USDC), and on
///         `exitToArc` burns the whole position back to the treasury with a
///         REMOTE_RETURN hook so Arc credits principal + yield in one message.
contract RemoteYieldVault is ICCTPHookReceiver {
    MockUSDC public immutable usdc;
    MockCCTPMessenger public immutable messenger;
    address public immutable arcTreasury;
    uint32 public immutable arcDomain;
    uint256 public immutable apyBps;

    uint256 public principal;
    uint256 public lastAccrued;

    event RemoteDeposited(uint32 indexed sourceDomain, uint256 amount);
    event ExitedToArc(uint256 amount);

    constructor(
        MockUSDC usdc_,
        MockCCTPMessenger messenger_,
        address arcTreasury_,
        uint32 arcDomain_,
        uint256 apyBps_
    ) {
        usdc = usdc_;
        messenger = messenger_;
        arcTreasury = arcTreasury_;
        arcDomain = arcDomain_;
        apyBps = apyBps_;
        lastAccrued = block.timestamp;
    }

    function _pendingInterest() internal view returns (uint256) {
        if (principal == 0) return 0;
        return (principal * apyBps * (block.timestamp - lastAccrued)) / (365 days * 10_000);
    }

    function _accrue() internal {
        uint256 interest = _pendingInterest();
        if (interest > 0) {
            usdc.mint(address(this), interest);
            principal += interest;
        }
        lastAccrued = block.timestamp;
    }

    /// @notice Current position value including unaccrued interest.
    function totalAssets() external view returns (uint256) {
        return principal + _pendingInterest();
    }

    /// @notice Hooked CCTP mint from the Arc treasury's remote adapter.
    function onCCTPHook(uint32 sourceDomain, address, uint256 amount, bytes calldata hookData) external {
        require(msg.sender == address(messenger), "Vault: only messenger");
        (uint8 action,) = abi.decode(hookData, (uint8, bytes));
        require(action == SluiceHooks.REMOTE_DEPOSIT, "Vault: unknown action");
        _accrue();
        principal += amount;
        emit RemoteDeposited(sourceDomain, amount);
    }

    /// @notice Send the full position (principal + accrued yield) home to Arc.
    ///         Called by the relayer when the treasury requests a return.
    function exitToArc() external returns (uint256 amount) {
        _accrue();
        amount = principal;
        require(amount > 0, "Vault: empty");
        principal = 0;
        usdc.approve(address(messenger), amount);
        messenger.depositForBurnWithHook(
            amount, arcDomain, arcTreasury, abi.encode(SluiceHooks.REMOTE_RETURN, bytes(""))
        );
        emit ExitedToArc(amount);
    }
}
