// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script, console} from "forge-std/Script.sol";
import {SluiceTreasury} from "../contracts/crosschain/SluiceTreasury.sol";
import {ERC4626Adapter, IERC4626} from "../contracts/crosschain/ERC4626Adapter.sol";
import {IYieldAdapter} from "../contracts/crosschain/YieldAdapters.sol";

/// @notice Registers a REAL yield venue with the treasury: the Morpho USDC vault
///         that Circle's Earn Kit lists for Arc Testnet. Replaces reserve-funded
///         yield with whatever the vault actually earns.
///
///         source .env && TREASURY=0x... VAULT=0x... \
///           forge script script/AddEarnAdapter.s.sol --rpc-url arc_testnet --broadcast
contract AddEarnAdapter is Script {
    uint32 constant ARC_DOMAIN = 26;

    function run() external {
        uint256 key = vm.envUint("PRIVATE_KEY");
        SluiceTreasury treasury = SluiceTreasury(vm.envAddress("TREASURY"));
        // Circle Earn Kit vault listing for Arc Testnet (protocol: Morpho).
        IERC4626 vault = IERC4626(vm.envAddress("VAULT"));
        uint256 apyBps = vm.envOr("APY_BPS", uint256(350)); // 3.5% at listing time

        vm.startBroadcast(key);
        ERC4626Adapter adapter =
            new ERC4626Adapter(vault, address(treasury), "Morpho USDC Vault (Circle Earn)", apyBps, ARC_DOMAIN);
        treasury.addAdapter(IYieldAdapter(address(adapter)), vm.envOr("TARGET_BPS", uint256(5_000)));
        vm.stopBroadcast();

        console.log("ERC4626Adapter:", address(adapter));
        console.log("  vault       :", address(vault));
    }
}
