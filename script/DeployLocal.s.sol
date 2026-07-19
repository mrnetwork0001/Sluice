// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script, console} from "forge-std/Script.sol";
import {Sluice} from "../contracts/Sluice.sol";
import {MockUSDC} from "../contracts/mocks/MockUSDC.sol";
import {MockCCTPMessenger} from "../contracts/crosschain/MockCCTPMessenger.sol";
import {SluiceGate} from "../contracts/crosschain/SluiceGate.sol";
import {SluiceTreasury} from "../contracts/crosschain/SluiceTreasury.sol";
import {MockYieldAdapter, CCTPRemoteAdapter, IYieldAdapter} from "../contracts/crosschain/YieldAdapters.sol";

/// @notice Deploys the "Arc (local)" side of the twin-chain demo and seeds it:
///         Sluice + CCTP messenger (domain 26) + gate + treasury with a local
///         money-market adapter and a CCTP remote adapter pointing at the Base
///         vault, then three salary streams (one insured, two listed) and a
///         funded insurance pool. Run DeployLocalB against chain B first.
///
///         anvil                                        # terminal 1 (8545)
///         anvil --port 8546 --chain-id 31338           # terminal 2
///         forge script script/DeployLocalB.s.sol --rpc-url http://127.0.0.1:8546 --broadcast
///         forge script script/DeployLocal.s.sol  --rpc-url http://127.0.0.1:8545 --broadcast
contract DeployLocal is Script {
    // Standard anvil dev keys (publicly known — local use only).
    uint256 constant EMPLOYER_KEY = 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80;
    uint256 constant EMPLOYEE_KEY = 0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d;
    uint256 constant LP_KEY = 0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a;

    address constant TAX_VAULT = 0x000000000000000000000000000000000000dEaD;
    uint32 constant ARC_DOMAIN = 26;
    uint32 constant BASE_DOMAIN = 6;

    function run() external {
        address employer = vm.addr(EMPLOYER_KEY);
        address employee = vm.addr(EMPLOYEE_KEY);
        address lp = vm.addr(LP_KEY);
        // Base-side vault address: employer nonce 2 on a fresh chain B.
        address remoteVault = vm.envOr("REMOTE_VAULT", 0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0);

        // --- contract creations first, so addresses stay deterministic
        vm.startBroadcast(EMPLOYER_KEY);
        MockUSDC usdc = new MockUSDC(); // nonce 0
        Sluice sluice = new Sluice(address(usdc)); // nonce 1
        MockCCTPMessenger messenger = new MockCCTPMessenger(usdc, ARC_DOMAIN); // nonce 2
        SluiceGate gate = new SluiceGate(sluice, messenger); // nonce 3
        SluiceTreasury treasury = new SluiceTreasury(sluice, messenger); // nonce 4
        MockYieldAdapter localAdapter =
            new MockYieldAdapter(usdc, address(treasury), "Arc Money Market", 420, ARC_DOMAIN);
        CCTPRemoteAdapter remoteAdapter = new CCTPRemoteAdapter(
            usdc, messenger, address(treasury), remoteVault, BASE_DOMAIN, "Base High-Yield Vault", 860
        );

        // --- wiring
        sluice.setGate(address(gate));
        sluice.setTreasury(address(treasury));
        treasury.addAdapter(IYieldAdapter(address(localAdapter)), 5_000);
        treasury.addAdapter(IYieldAdapter(address(remoteAdapter)), 5_000);

        // --- seed: mints, approvals, three salary streams
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

        // --- LP stakes the insurance pool and lists the contractor stream
        vm.startBroadcast(LP_KEY);
        usdc.approve(address(sluice), type(uint256).max);
        sluice.stakeInsurancePool(50_000e6);
        sluice.listStreamForSale(s3, 750e6); // ~6% discount — cross-chain buyout demo target
        vm.stopBroadcast();

        // --- addresses for the frontend + relayer
        string memory json = "deployments";
        vm.serializeAddress(json, "usdc", address(usdc));
        vm.serializeAddress(json, "sluice", address(sluice));
        vm.serializeAddress(json, "messenger", address(messenger));
        vm.serializeAddress(json, "gate", address(gate));
        vm.serializeAddress(json, "treasury", address(treasury));
        vm.serializeAddress(json, "localAdapter", address(localAdapter));
        string memory out = vm.serializeAddress(json, "remoteAdapter", address(remoteAdapter));
        vm.writeJson(out, "./web/src/lib/deployments.31337.json");

        console.log("Sluice   :", address(sluice));
        console.log("Gate     :", address(gate));
        console.log("Treasury :", address(treasury));
        console.log("streams  :", s1, s2, s3);
    }
}
