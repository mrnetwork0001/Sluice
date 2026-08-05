// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script, console} from "forge-std/Script.sol";
import {Sluice, IERC20} from "../contracts/Sluice.sol";
import {ITokenMessengerV2} from "../contracts/crosschain/CCTPInterfaces.sol";
import {SluiceGate} from "../contracts/crosschain/SluiceGate.sol";
import {SluiceTreasury} from "../contracts/crosschain/SluiceTreasury.sol";
import {ReserveYieldAdapter, IYieldAdapter} from "../contracts/crosschain/YieldAdapters.sol";

/// @notice Phase A on Arc Testnet: deploys the CCTP gate, the treasury, and the
///         on-Arc reserve yield vault against the REAL Circle TokenMessengerV2,
///         then wires them into the live Sluice contract (one-time setters).
///
///         source .env && SLUICE=0x... FROM_BLOCK=... \
///           forge script script/DeployCrossChain.s.sol --rpc-url arc_testnet --broadcast
contract DeployCrossChain is Script {
    address constant TOKEN_MESSENGER_V2 = 0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA;
    uint32 constant ARC_DOMAIN = 26;

    function run() external {
        uint256 key = vm.envUint("PRIVATE_KEY");
        address relayer = vm.addr(key); // deployer doubles as the attestation relayer
        Sluice sluice = Sluice(vm.envAddress("SLUICE"));

        vm.startBroadcast(key);
        SluiceGate gate = new SluiceGate(sluice, ITokenMessengerV2(TOKEN_MESSENGER_V2), relayer);
        SluiceTreasury treasury = new SluiceTreasury(sluice, relayer);
        ReserveYieldAdapter localAdapter =
            new ReserveYieldAdapter(sluice.usdc(), address(treasury), "Arc Reserve Vault", 420, ARC_DOMAIN);

        sluice.setGate(address(gate));
        sluice.setTreasury(address(treasury));
        treasury.addAdapter(IYieldAdapter(address(localAdapter)), 5_000);
        vm.stopBroadcast();

        string memory json = "deployments";
        vm.serializeAddress(json, "sluice", address(sluice));
        vm.serializeUint(json, "fromBlock", vm.envUint("FROM_BLOCK"));
        vm.serializeAddress(json, "gate", address(gate));
        vm.serializeAddress(json, "treasury", address(treasury));
        vm.serializeAddress(json, "relayer", relayer);
        string memory out = vm.serializeAddress(json, "localAdapter", address(localAdapter));
        vm.writeJson(out, "./web/src/lib/deployments.5042002.json");

        console.log("Gate         :", address(gate));
        console.log("Treasury     :", address(treasury));
        console.log("ReserveVault :", address(localAdapter));
    }
}
