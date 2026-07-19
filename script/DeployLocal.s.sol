// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script, console} from "forge-std/Script.sol";
import {Sluice} from "../contracts/Sluice.sol";
import {MockUSDC} from "../contracts/mocks/MockUSDC.sol";

/// @notice Deploys MockUSDC + Sluice to a local anvil node and seeds demo data:
///         three salary streams, one insured, one listed for sale, and a funded
///         insurance pool. Uses the standard anvil dev accounts.
///
///         anvil                       # terminal 1
///         forge script script/DeployLocal.s.sol --rpc-url http://127.0.0.1:8545 --broadcast
contract DeployLocal is Script {
    // Standard anvil dev keys (publicly known — local use only).
    uint256 constant EMPLOYER_KEY = 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80;
    uint256 constant EMPLOYEE_KEY = 0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d;
    uint256 constant LP_KEY = 0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a;

    address constant TAX_VAULT = 0x000000000000000000000000000000000000dEaD;

    function run() external {
        address employer = vm.addr(EMPLOYER_KEY);
        address employee = vm.addr(EMPLOYEE_KEY);
        address lp = vm.addr(LP_KEY);

        // --- employer deploys everything and opens three salary streams
        vm.startBroadcast(EMPLOYER_KEY);
        MockUSDC usdc = new MockUSDC();
        Sluice sluice = new Sluice(address(usdc));

        usdc.mint(employer, 1_000_000e6);
        usdc.mint(employee, 25_000e6);
        usdc.mint(lp, 500_000e6);
        usdc.approve(address(sluice), type(uint256).max);

        uint256 s1 = sluice.createStream(employee, 5_000e6, 30 days, 800, TAX_VAULT); // monthly salary, 8% tax
        uint256 s2 = sluice.createStream(employee, 1_200e6, 7 days, 500, TAX_VAULT); // weekly bonus, 5% tax
        uint256 s3 = sluice.createStream(lp, 800e6, 1 days, 0, address(0)); // contractor day rate
        vm.stopBroadcast();

        // --- employee insures the salary stream and lists the bonus at a discount
        vm.startBroadcast(EMPLOYEE_KEY);
        usdc.approve(address(sluice), type(uint256).max);
        sluice.insureStream(s1);
        sluice.listStreamForSale(s2, 1_080e6); // 10% discount
        vm.stopBroadcast();

        // --- LP stakes into the credit-default insurance pool
        vm.startBroadcast(LP_KEY);
        usdc.approve(address(sluice), type(uint256).max);
        sluice.stakeInsurancePool(50_000e6);
        vm.stopBroadcast();

        console.log("MockUSDC :", address(usdc));
        console.log("Sluice   :", address(sluice));
        console.log("streams  :", s1, s2, s3);
    }
}
