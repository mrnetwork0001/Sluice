// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Sluice, IERC20} from "../Sluice.sol";
import {ITokenMessengerV2, ICCTPHookReceiver, CCTPFinality} from "./CCTPInterfaces.sol";

/// @notice Hook action ids shared by contracts, the relayer, and the frontend.
library SluiceHooks {
    uint8 internal constant FUND_STREAM = 0; // payload: (employer, recipient, durationSeconds, taxBps, taxVault)
    uint8 internal constant BUY_STREAM = 1; // payload: (buyer, streamId)
    uint8 internal constant REMOTE_DEPOSIT = 2; // treasury -> remote yield vault
    uint8 internal constant REMOTE_RETURN = 3; // remote yield vault -> treasury
}

/// @title SluiceGate — chain-abstracted entry/exit for Sluice over real CCTP v2
/// @notice Inbound: users burn USDC on any CCTP chain with a hook payload and this
///         gate as mint recipient; the attestation relayer delivers the mint via
///         MessageTransmitterV2.receiveMessage and then calls `onCCTPHook`, which
///         dispatches into Sluice (fund a stream / settle a marketplace buyout).
///         Outbound: `withdrawToChain` burns vested salary to any CCTP domain via
///         TokenMessengerV2 — tax stays on Arc, only the net amount travels.
contract SluiceGate is ICCTPHookReceiver {
    Sluice public immutable sluice;
    ITokenMessengerV2 public immutable tokenMessenger;
    IERC20 public immutable usdc;
    /// @notice Attestation relayer authorized to execute inbound hooks.
    address public immutable relayer;

    event CrossChainStreamFunded(
        uint256 indexed streamId, uint32 indexed sourceDomain, address indexed employer, uint256 amount
    );
    event CrossChainStreamPurchased(
        uint256 indexed streamId, uint32 indexed sourceDomain, address indexed buyer, uint256 price, uint256 refund
    );
    event CrossChainWithdrawal(
        uint256 indexed streamId,
        address indexed owner,
        uint32 indexed destinationDomain,
        address destRecipient,
        uint256 netAmount
    );
    event HookRefunded(uint32 indexed sourceDomain, address indexed to, uint256 amount, string reason);

    constructor(Sluice sluice_, ITokenMessengerV2 tokenMessenger_, address relayer_) {
        require(relayer_ != address(0), "Gate: relayer zero");
        sluice = sluice_;
        tokenMessenger = tokenMessenger_;
        usdc = sluice_.usdc();
        relayer = relayer_;
    }

    /// @notice Executes an inbound hook. `amount` is the USDC actually minted to
    ///         this gate (net of any CCTP fast-transfer fee), taken by the relayer
    ///         from the mint's ERC-20 Transfer log.
    function onCCTPHook(uint32 sourceDomain, uint256 amount, bytes calldata hookData) external {
        require(msg.sender == relayer, "Gate: only relayer");
        require(usdc.balanceOf(address(this)) >= amount, "Gate: funds not arrived");
        (uint8 action, bytes memory payload) = abi.decode(hookData, (uint8, bytes));

        if (action == SluiceHooks.FUND_STREAM) {
            (address employer, address recipient, uint256 durationSeconds, uint256 taxBps, address taxVault) =
                abi.decode(payload, (address, address, uint256, uint256, address));
            usdc.approve(address(sluice), amount);
            uint256 streamId = sluice.createStreamFor(employer, recipient, amount, durationSeconds, taxBps, taxVault);
            emit CrossChainStreamFunded(streamId, sourceDomain, employer, amount);
        } else if (action == SluiceHooks.BUY_STREAM) {
            (address buyer, uint256 streamId) = abi.decode(payload, (address, uint256));
            uint256 price = sluice.salePriceOf(streamId);
            if (price == 0 || price > amount) {
                // Listing vanished or underpaid — refund the buyer on this chain
                // rather than reverting the delivery.
                require(usdc.transfer(buyer, amount), "Gate: refund failed");
                emit HookRefunded(sourceDomain, buyer, amount, price == 0 ? "not listed" : "insufficient payment");
                return;
            }
            usdc.approve(address(sluice), price);
            sluice.buyStreamFor(buyer, streamId);
            uint256 refund = amount - price;
            if (refund > 0) require(usdc.transfer(buyer, refund), "Gate: refund failed");
            emit CrossChainStreamPurchased(streamId, sourceDomain, buyer, price, refund);
        } else {
            revert("Gate: unknown action");
        }
    }

    /// @notice Withdraw vested salary and exit it to another CCTP domain. Uses the
    ///         standard-finality path: Arc finalizes sub-second, so the transfer is
    ///         fee-free and attests in seconds.
    function withdrawToChain(uint256 streamId, uint256 amount, uint32 destinationDomain, address destRecipient)
        external
    {
        require(destRecipient != address(0), "Gate: recipient zero");
        uint256 net = sluice.withdrawFromStreamFor(msg.sender, streamId, amount);
        usdc.approve(address(tokenMessenger), net);
        tokenMessenger.depositForBurn(
            net,
            destinationDomain,
            bytes32(uint256(uint160(destRecipient))),
            address(usdc),
            bytes32(0), // any caller may deliver the mint
            0, // standard finality — no fee
            CCTPFinality.STANDARD
        );
        emit CrossChainWithdrawal(streamId, msg.sender, destinationDomain, destRecipient, net);
    }
}
