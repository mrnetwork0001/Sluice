// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script, console} from "forge-std/Script.sol";
import {Sluice} from "../contracts/Sluice.sol";

/// @notice Seeds the Arc Testnet deployment with small demo streams so judges see
///         live content. Faucet USDC is scarce (and it is also the gas token), so
///         amounts are deliberately tiny and tunable via env.
///
///         source .env && SLUICE=0x... forge script script/SeedArc.s.sol --rpc-url arc_testnet --broadcast
contract SeedArc is Script {
    function run() external {
        uint256 key = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(key);
        Sluice sluice = Sluice(vm.envAddress("SLUICE"));
        // Demo recipient: a second wallet you control (defaults to the deployer's
        // own address so seeding works with a single funded key).
        address recipient = vm.envOr("RECIPIENT", deployer);
        address taxVault = vm.envOr("TAX_VAULT", address(0x000000000000000000000000000000000000dEaD));

        uint256 salary = vm.envOr("SALARY", uint256(3e6)); // 3 USDC over 30 days
        uint256 bonus = vm.envOr("BONUS", uint256(1e6)); // 1 USDC over 3 days
        uint256 stake = vm.envOr("STAKE", uint256(1e6)); // 1 USDC insurance stake

        vm.startBroadcast(key);
        sluice.usdc().approve(address(sluice), type(uint256).max);
        uint256 s1 = sluice.createStream(recipient, salary, 30 days, 800, taxVault); // 8% tax
        uint256 s2 = sluice.createStream(recipient, bonus, 3 days, 0, address(0));
        sluice.stakeInsurancePool(stake);
        vm.stopBroadcast();

        console.log("Seeded streams:", s1, s2);
        console.log("Insurance pool staked:", stake);
    }
}
