// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script, console} from "forge-std/Script.sol";
import {IERC20} from "../contracts/Sluice.sol";
import {ITokenMessengerV2} from "../contracts/crosschain/CCTPInterfaces.sol";
import {RemoteYieldVault} from "../contracts/crosschain/RemoteYieldVault.sol";

/// @notice Phase B on Base Sepolia: deploys the RemoteYieldVault the Arc treasury
///         routes idle escrow into, against real Base Sepolia USDC + CCTP v2.
///
///         source .env && ARC_TREASURY=0x... \
///           forge script script/DeployBaseVault.s.sol --rpc-url https://sepolia.base.org --broadcast
contract DeployBaseVault is Script {
    address constant TOKEN_MESSENGER_V2 = 0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA;
    address constant BASE_SEPOLIA_USDC = 0x036CbD53842c5426634e7929541eC2318f3dCF7e;
    uint32 constant ARC_DOMAIN = 26;

    function run() external {
        uint256 key = vm.envUint("PRIVATE_KEY");
        address relayer = vm.addr(key);
        address arcTreasury = vm.envAddress("ARC_TREASURY");

        vm.startBroadcast(key);
        RemoteYieldVault vault = new RemoteYieldVault(
            IERC20(BASE_SEPOLIA_USDC), ITokenMessengerV2(TOKEN_MESSENGER_V2), arcTreasury, ARC_DOMAIN, 860, relayer
        );
        vm.stopBroadcast();

        string memory json = "deployments";
        string memory out = vm.serializeAddress(json, "remoteVault", address(vault));
        vm.writeJson(out, "./web/src/lib/deployments.84532.json");

        console.log("RemoteYieldVault (Base Sepolia):", address(vault));
    }
}
