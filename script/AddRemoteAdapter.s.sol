// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script, console} from "forge-std/Script.sol";
import {Sluice} from "../contracts/Sluice.sol";
import {ITokenMessengerV2} from "../contracts/crosschain/CCTPInterfaces.sol";
import {SluiceTreasury} from "../contracts/crosschain/SluiceTreasury.sol";
import {CCTPRemoteAdapter, IYieldAdapter} from "../contracts/crosschain/YieldAdapters.sol";

/// @notice Phase C on Arc Testnet: once the Base Sepolia vault exists, deploy the
///         CCTP remote adapter pointing at it and register it with the treasury.
///
///         source .env && SLUICE=0x... TREASURY=0x... REMOTE_VAULT=0x... \
///           GATE=0x... LOCAL_ADAPTER=0x... FROM_BLOCK=... \
///           forge script script/AddRemoteAdapter.s.sol --rpc-url arc_testnet --broadcast
contract AddRemoteAdapter is Script {
    address constant TOKEN_MESSENGER_V2 = 0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA;
    uint32 constant BASE_SEPOLIA_DOMAIN = 6;

    function run() external {
        uint256 key = vm.envUint("PRIVATE_KEY");
        Sluice sluice = Sluice(vm.envAddress("SLUICE"));
        SluiceTreasury treasury = SluiceTreasury(vm.envAddress("TREASURY"));
        address remoteVault = vm.envAddress("REMOTE_VAULT");

        vm.startBroadcast(key);
        CCTPRemoteAdapter remoteAdapter = new CCTPRemoteAdapter(
            sluice.usdc(),
            ITokenMessengerV2(TOKEN_MESSENGER_V2),
            address(treasury),
            remoteVault,
            BASE_SEPOLIA_DOMAIN,
            "Base Sepolia Vault",
            860,
            vm.addr(key)
        );
        treasury.addAdapter(IYieldAdapter(address(remoteAdapter)), 5_000);
        vm.stopBroadcast();

        string memory json = "deployments";
        vm.serializeAddress(json, "sluice", address(sluice));
        vm.serializeUint(json, "fromBlock", vm.envUint("FROM_BLOCK"));
        vm.serializeAddress(json, "gate", vm.envAddress("GATE"));
        vm.serializeAddress(json, "treasury", address(treasury));
        vm.serializeAddress(json, "localAdapter", vm.envAddress("LOCAL_ADAPTER"));
        vm.serializeAddress(json, "relayer", vm.addr(key));
        string memory out = vm.serializeAddress(json, "remoteAdapter", address(remoteAdapter));
        vm.writeJson(out, "./web/src/lib/deployments.5042002.json");

        console.log("CCTPRemoteAdapter:", address(remoteAdapter));
    }
}
