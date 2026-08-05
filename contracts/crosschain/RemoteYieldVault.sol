// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "../Sluice.sol";
import {ITokenMessengerV2, ICCTPHookReceiver, CCTPFinality} from "./CCTPInterfaces.sol";
import {SluiceHooks} from "./SluiceGate.sol";

/// @title RemoteYieldVault — the destination-chain half of cross-chain yield routing
/// @notice Lives on Base Sepolia. Receives hooked CCTP deposits from the Arc
///         treasury, accrues a fixed APY paid in real USDC from a pre-funded
///         reserve, and on `exitToArc` burns the whole position back to the
///         treasury with a REMOTE_RETURN hook. Uses the fast-finality path on the
///         way home (Base Sepolia hard finality would take many minutes).
contract RemoteYieldVault is ICCTPHookReceiver {
    IERC20 public immutable usdc;
    ITokenMessengerV2 public immutable tokenMessenger;
    address public immutable arcTreasury;
    uint32 public immutable arcDomain;
    uint256 public immutable apyBps;
    /// @notice Attestation relayer authorized to deliver deposits and trigger exits.
    address public immutable relayer;

    /// @notice Fast-transfer fee cap on the return leg: 0.1% of the amount.
    uint256 public constant FAST_MAX_FEE_BPS = 10;

    uint256 public principal;
    uint256 public reserve;
    uint256 public lastAccrued;

    event RemoteDeposited(uint32 indexed sourceDomain, uint256 amount);
    event ExitedToArc(uint256 amount);
    event ReserveFunded(address indexed from, uint256 amount);

    constructor(
        IERC20 usdc_,
        ITokenMessengerV2 tokenMessenger_,
        address arcTreasury_,
        uint32 arcDomain_,
        uint256 apyBps_,
        address relayer_
    ) {
        require(relayer_ != address(0), "Vault: relayer zero");
        usdc = usdc_;
        tokenMessenger = tokenMessenger_;
        arcTreasury = arcTreasury_;
        arcDomain = arcDomain_;
        apyBps = apyBps_;
        relayer = relayer_;
        lastAccrued = block.timestamp;
    }

    /// @notice Top up the interest reserve with real USDC.
    function fundReserve(uint256 amount) external {
        require(usdc.transferFrom(msg.sender, address(this), amount), "Vault: pull failed");
        reserve += amount;
        emit ReserveFunded(msg.sender, amount);
    }

    function _pendingInterest() internal view returns (uint256) {
        if (principal == 0) return 0;
        uint256 interest = (principal * apyBps * (block.timestamp - lastAccrued)) / (365 days * 10_000);
        return interest > reserve ? reserve : interest;
    }

    function _accrue() internal {
        uint256 interest = _pendingInterest();
        if (interest > 0) {
            reserve -= interest;
            principal += interest;
        }
        lastAccrued = block.timestamp;
    }

    /// @notice Current position value including unaccrued interest.
    function totalAssets() external view returns (uint256) {
        return principal + _pendingInterest();
    }

    /// @notice Inbound deposit hook, executed by the relayer after the CCTP mint.
    function onCCTPHook(uint32 sourceDomain, uint256 amount, bytes calldata hookData) external {
        require(msg.sender == relayer, "Vault: only relayer");
        require(usdc.balanceOf(address(this)) >= amount, "Vault: funds not arrived");
        (uint8 action,) = abi.decode(hookData, (uint8, bytes));
        require(action == SluiceHooks.REMOTE_DEPOSIT, "Vault: unknown action");
        _accrue();
        principal += amount;
        emit RemoteDeposited(sourceDomain, amount);
    }

    /// @notice Send the full position (principal + accrued yield) home to Arc.
    ///         Relayer-triggered when the treasury requests a return.
    function exitToArc() external returns (uint256 amount) {
        require(msg.sender == relayer, "Vault: only relayer");
        _accrue();
        amount = principal;
        require(amount > 0, "Vault: empty");
        principal = 0;
        usdc.approve(address(tokenMessenger), amount);
        tokenMessenger.depositForBurnWithHook(
            amount,
            arcDomain,
            bytes32(uint256(uint160(arcTreasury))),
            address(usdc),
            bytes32(uint256(uint160(relayer))),
            (amount * FAST_MAX_FEE_BPS) / 10_000,
            CCTPFinality.FAST,
            abi.encode(SluiceHooks.REMOTE_RETURN, bytes(""))
        );
        emit ExitedToArc(amount);
    }
}
