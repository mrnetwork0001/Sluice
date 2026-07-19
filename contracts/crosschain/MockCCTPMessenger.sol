// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {MockUSDC} from "../mocks/MockUSDC.sol";

/// @notice Contracts that want to act on an incoming CCTP mint implement this.
interface ICCTPHookReceiver {
    function onCCTPHook(uint32 sourceDomain, address sourceSender, uint256 amount, bytes calldata hookData) external;
}

/// @title MockCCTPMessenger — local stand-in for Circle's CCTP v2 TokenMessenger
/// @notice Mirrors the burn-and-mint + hook shape of CCTP v2 fast transfers:
///         `depositForBurnWithHook` burns USDC on the source chain and emits a
///         message; an off-chain relayer (scripts/relayer.mjs, playing the role of
///         Circle's attestation service) delivers it to the destination messenger's
///         `receiveMessage`, which mints USDC to the recipient and invokes its hook.
///         On real testnets the same flows run through Circle's Bridge Kit SDK.
contract MockCCTPMessenger {
    MockUSDC public immutable usdc;
    uint32 public immutable localDomain;
    uint64 public nextNonce = 1;
    mapping(bytes32 => bool) public processed;

    event DepositForBurn(
        uint64 indexed nonce,
        uint32 indexed destinationDomain,
        address indexed burnSender,
        address mintRecipient,
        uint256 amount,
        bytes hookData
    );
    event MessageReceived(uint32 indexed sourceDomain, uint64 indexed nonce, address indexed recipient, uint256 amount);

    constructor(MockUSDC usdc_, uint32 localDomain_) {
        usdc = usdc_;
        localDomain = localDomain_;
    }

    function depositForBurn(uint256 amount, uint32 destinationDomain, address mintRecipient) external returns (uint64) {
        return _burn(amount, destinationDomain, mintRecipient, "");
    }

    function depositForBurnWithHook(
        uint256 amount,
        uint32 destinationDomain,
        address mintRecipient,
        bytes calldata hookData
    ) external returns (uint64) {
        return _burn(amount, destinationDomain, mintRecipient, hookData);
    }

    function _burn(uint256 amount, uint32 destinationDomain, address mintRecipient, bytes memory hookData)
        internal
        returns (uint64 nonce)
    {
        require(amount > 0, "CCTP: amount zero");
        require(usdc.transferFrom(msg.sender, address(this), amount), "CCTP: pull failed");
        usdc.burn(address(this), amount);
        nonce = nextNonce++;
        emit DepositForBurn(nonce, destinationDomain, msg.sender, mintRecipient, amount, hookData);
    }

    /// @notice Relayer-delivered mint on the destination chain. Open for the local
    ///         demo (the real messenger verifies Circle's attestation signature).
    function receiveMessage(
        uint32 sourceDomain,
        uint64 nonce,
        address sourceSender,
        address recipient,
        uint256 amount,
        bytes calldata hookData
    ) external {
        bytes32 key = keccak256(abi.encode(sourceDomain, nonce));
        require(!processed[key], "CCTP: already processed");
        processed[key] = true;

        usdc.mint(recipient, amount);
        emit MessageReceived(sourceDomain, nonce, recipient, amount);

        if (hookData.length > 0 && recipient.code.length > 0) {
            ICCTPHookReceiver(recipient).onCCTPHook(sourceDomain, sourceSender, amount, hookData);
        }
    }
}
