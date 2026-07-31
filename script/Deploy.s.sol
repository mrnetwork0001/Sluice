// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script, console} from "forge-std/Script.sol";
import {Sluice} from "../contracts/Sluice.sol";

/// @notice Deploys the core Sluice contract to Arc Testnet against native USDC
///         (the gas token, 0x3600...0000). Reads PRIVATE_KEY from the environment
///         (.env) and records the address for the frontend.
///
///         source .env && forge script script/Deploy.s.sol --rpc-url arc_testnet --broadcast
contract Deploy is Script {
    function run() external {
        uint256 key = vm.envUint("PRIVATE_KEY");
        vm.startBroadcast(key);
        Sluice sluice = new Sluice(address(0)); // address(0) -> native Arc testnet USDC
        vm.stopBroadcast();

        string memory json = "deployments";
        string memory out = vm.serializeAddress(json, "sluice", address(sluice));
        vm.writeJson(out, "./web/src/lib/deployments.5042002.json");

        console.log("Sluice deployed :", address(sluice));
        console.log("USDC (native)   :", address(sluice.usdc()));
        console.log("Explorer        : https://testnet.arcscan.app/address/%s", address(sluice));
    }
}
