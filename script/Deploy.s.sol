// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script, console} from "forge-std/Script.sol";
import {Sluice} from "../contracts/Sluice.sol";

/// @notice Deploys Sluice to Arc Testnet using the native USDC gas token address.
///         forge script script/Deploy.s.sol --rpc-url arc_testnet --broadcast --private-key $PRIVATE_KEY
contract Deploy is Script {
    function run() external {
        vm.startBroadcast();
        Sluice sluice = new Sluice(address(0)); // address(0) -> Arc testnet USDC
        vm.stopBroadcast();
        console.log("Sluice deployed at", address(sluice));
        console.log("USDC", address(sluice.usdc()));
    }
}
