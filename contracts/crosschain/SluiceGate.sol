// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Sluice, IERC20} from "../Sluice.sol";
import {MockCCTPMessenger, ICCTPHookReceiver} from "./MockCCTPMessenger.sol";

/// @notice Hook action ids shared by contracts, the relayer, and the frontend.
library SluiceHooks {
    uint8 internal constant FUND_STREAM = 0; // payload: (employer, recipient, durationSeconds, taxBps, taxVault)
    uint8 internal constant BUY_STREAM = 1; // payload: (buyer, streamId)
    uint8 internal constant REMOTE_DEPOSIT = 2; // treasury -> remote yield vault
    uint8 internal constant REMOTE_RETURN = 3; // remote yield vault -> treasury
}

/// @title SluiceGate — chain-abstracted entry/exit for Sluice
/// @notice Receives CCTP mints carrying hook payloads and dispatches them into the
///         Sluice payroll contract, so employers can fund streams and LPs can buy
///         listed streams from any chain in a single burn transaction. Employees use
///         `withdrawToChain` to exit vested salary to the chain they spend on.
contract SluiceGate is ICCTPHookReceiver {
    Sluice public immutable sluice;
    MockCCTPMessenger public immutable messenger;
    IERC20 public immutable usdc;

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

    constructor(Sluice sluice_, MockCCTPMessenger messenger_) {
        sluice = sluice_;
        messenger = messenger_;
        usdc = sluice_.usdc();
    }

    /// @notice CCTP mint handler — `amount` USDC has just been minted to this gate.
    function onCCTPHook(uint32 sourceDomain, address, uint256 amount, bytes calldata hookData) external {
        require(msg.sender == address(messenger), "Gate: only messenger");
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
                // rather than reverting the mint.
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

    /// @notice Withdraw vested salary and exit it to another chain via CCTP burn.
    ///         Tax is split on Arc as usual; only the net amount travels.
    function withdrawToChain(uint256 streamId, uint256 amount, uint32 destinationDomain, address destRecipient)
        external
    {
        require(destRecipient != address(0), "Gate: recipient zero");
        uint256 net = sluice.withdrawFromStreamFor(msg.sender, streamId, amount);
        usdc.approve(address(messenger), net);
        messenger.depositForBurn(net, destinationDomain, destRecipient);
        emit CrossChainWithdrawal(streamId, msg.sender, destinationDomain, destRecipient, net);
    }
}
