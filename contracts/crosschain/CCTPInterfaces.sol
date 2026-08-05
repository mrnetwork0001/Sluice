// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @notice Circle CCTP v2 TokenMessenger — signatures taken from the verified
///         implementation behind the canonical proxy
///         0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA (Arc testnet + Base Sepolia).
interface ITokenMessengerV2 {
    function depositForBurn(
        uint256 amount,
        uint32 destinationDomain,
        bytes32 mintRecipient,
        address burnToken,
        bytes32 destinationCaller,
        uint256 maxFee,
        uint32 minFinalityThreshold
    ) external;

    function depositForBurnWithHook(
        uint256 amount,
        uint32 destinationDomain,
        bytes32 mintRecipient,
        address burnToken,
        bytes32 destinationCaller,
        uint256 maxFee,
        uint32 minFinalityThreshold,
        bytes calldata hookData
    ) external;
}

/// @notice CCTP v2 mints do not execute hooks on their own — an attestation
///         relayer calls MessageTransmitterV2.receiveMessage (minting USDC to the
///         recipient contract) and then invokes this entrypoint with the hook
///         payload. Implementations gate it to the trusted relayer.
interface ICCTPHookReceiver {
    function onCCTPHook(uint32 sourceDomain, uint256 amount, bytes calldata hookData) external;
}

/// @notice CCTP v2 finality thresholds.
library CCTPFinality {
    /// Fast transfer — attested at soft finality; Circle deducts a fee ≤ maxFee.
    uint32 internal constant FAST = 1000;
    /// Standard transfer — attested at hard finality; zero fee. Arc finalizes
    /// sub-second, so burns leaving Arc use this for free, near-instant exits.
    uint32 internal constant STANDARD = 2000;
}
