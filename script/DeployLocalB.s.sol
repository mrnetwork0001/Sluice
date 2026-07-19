// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script, console} from "forge-std/Script.sol";
import {MockUSDC} from "../contracts/mocks/MockUSDC.sol";
import {MockCCTPMessenger} from "../contracts/crosschain/MockCCTPMessenger.sol";
import {RemoteYieldVault} from "../contracts/crosschain/RemoteYieldVault.sol";

/// @notice Deploys the "Base (local)" half of the twin-chain demo: USDC, the mock
///         CCTP messenger (domain 6), and the RemoteYieldVault the Arc treasury
///         routes idle escrow into. Run against anvil --port 8546 --chain-id 31338.
contract DeployLocalB is Script {
    uint256 constant EMPLOYER_KEY = 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80;
    uint256 constant EMPLOYEE_KEY = 0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d;
    uint256 constant LP_KEY = 0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a;

    uint32 constant ARC_DOMAIN = 26;
    uint32 constant BASE_DOMAIN = 6;

    function run() external {
        // Arc-side treasury address: employer nonce 4 on a fresh chain A.
        address arcTreasury = vm.envOr("ARC_TREASURY", 0xDc64a140Aa3E981100a9becA4E685f962f0cF6C9);

        vm.startBroadcast(EMPLOYER_KEY);
        MockUSDC usdc = new MockUSDC();
        MockCCTPMessenger messenger = new MockCCTPMessenger(usdc, BASE_DOMAIN);
        RemoteYieldVault vault = new RemoteYieldVault(usdc, messenger, arcTreasury, ARC_DOMAIN, 860); // 8.6% APY

        usdc.mint(vm.addr(EMPLOYER_KEY), 1_000_000e6);
        usdc.mint(vm.addr(EMPLOYEE_KEY), 25_000e6);
        usdc.mint(vm.addr(LP_KEY), 500_000e6);
        vm.stopBroadcast();

        string memory json = "deployments";
        vm.serializeAddress(json, "usdc", address(usdc));
        vm.serializeAddress(json, "messenger", address(messenger));
        string memory out = vm.serializeAddress(json, "remoteVault", address(vault));
        vm.writeJson(out, "./web/src/lib/deployments.31338.json");

        console.log("USDC-B    :", address(usdc));
        console.log("MessengerB:", address(messenger));
        console.log("Vault     :", address(vault));
    }
}
