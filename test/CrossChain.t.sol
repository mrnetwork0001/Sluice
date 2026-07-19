// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test, Vm} from "forge-std/Test.sol";
import {Sluice} from "../contracts/Sluice.sol";
import {MockUSDC} from "../contracts/mocks/MockUSDC.sol";
import {MockCCTPMessenger} from "../contracts/crosschain/MockCCTPMessenger.sol";
import {SluiceGate, SluiceHooks} from "../contracts/crosschain/SluiceGate.sol";
import {SluiceTreasury} from "../contracts/crosschain/SluiceTreasury.sol";
import {MockYieldAdapter, CCTPRemoteAdapter, IYieldAdapter} from "../contracts/crosschain/YieldAdapters.sol";
import {RemoteYieldVault} from "../contracts/crosschain/RemoteYieldVault.sol";

/// @notice Exercises the full cross-chain stack on a single EVM: two messengers
///         (domains 26 = Arc, 6 = Base) with the test itself playing the relayer.
contract CrossChainTest is Test {
    uint32 constant ARC = 26;
    uint32 constant BASE = 6;

    // "Arc" side
    MockUSDC usdcA;
    Sluice sluice;
    MockCCTPMessenger messengerA;
    SluiceGate gate;
    SluiceTreasury treasury;
    MockYieldAdapter localAdapter;
    CCTPRemoteAdapter remoteAdapter;

    // "Base" side
    MockUSDC usdcB;
    MockCCTPMessenger messengerB;
    RemoteYieldVault vault;

    address employer = makeAddr("employer");
    address employee = makeAddr("employee");
    address lp = makeAddr("lp");
    address taxVault = makeAddr("taxVault");

    function setUp() public {
        usdcA = new MockUSDC();
        sluice = new Sluice(address(usdcA));
        messengerA = new MockCCTPMessenger(usdcA, ARC);
        gate = new SluiceGate(sluice, messengerA);
        treasury = new SluiceTreasury(sluice, messengerA);

        usdcB = new MockUSDC();
        messengerB = new MockCCTPMessenger(usdcB, BASE);
        vault = new RemoteYieldVault(usdcB, messengerB, address(treasury), ARC, 860);

        localAdapter = new MockYieldAdapter(usdcA, address(treasury), "Arc Money Market", 420, ARC);
        remoteAdapter =
            new CCTPRemoteAdapter(usdcA, messengerA, address(treasury), address(vault), BASE, "Base Vault", 860);

        sluice.setGate(address(gate));
        sluice.setTreasury(address(treasury));
        treasury.addAdapter(IYieldAdapter(address(localAdapter)), 5_000);
        treasury.addAdapter(IYieldAdapter(address(remoteAdapter)), 5_000);

        usdcA.mint(employer, 1_000_000e6);
        usdcB.mint(employer, 1_000_000e6);
        usdcB.mint(lp, 1_000_000e6);
        vm.prank(employer);
        usdcA.approve(address(sluice), type(uint256).max);
        vm.prank(employer);
        usdcB.approve(address(messengerB), type(uint256).max);
        vm.prank(lp);
        usdcB.approve(address(messengerB), type(uint256).max);
    }

    /// @dev Plays the attestation relayer: delivers a burn from `src` to `dst`.
    function _relay(MockCCTPMessenger src, MockCCTPMessenger dst) internal {
        // Read the last DepositForBurn via recorded logs.
        Vm.Log[] memory logs = vm.getRecordedLogs();
        for (uint256 i = 0; i < logs.length; i++) {
            if (logs[i].topics[0] == keccak256("DepositForBurn(uint64,uint32,address,address,uint256,bytes)")) {
                if (logs[i].emitter != address(src)) continue;
                uint64 nonce = uint64(uint256(logs[i].topics[1]));
                address burnSender = address(uint160(uint256(logs[i].topics[3])));
                (address mintRecipient, uint256 amount, bytes memory hookData) =
                    abi.decode(logs[i].data, (address, uint256, bytes));
                dst.receiveMessage(src.localDomain(), nonce, burnSender, mintRecipient, amount, hookData);
            }
        }
    }

    // --------------------------------------------------- F1: hooked funding

    function test_FundStreamFromBase() public {
        bytes memory hook = abi.encode(
            SluiceHooks.FUND_STREAM, abi.encode(employer, employee, uint256(1_000), uint256(1_000), taxVault)
        );
        vm.recordLogs();
        vm.prank(employer);
        messengerB.depositForBurnWithHook(1_000e6, ARC, address(gate), hook);
        _relay(messengerB, messengerA);

        assertEq(sluice.ownerOf(1), employee);
        assertEq(sluice.balanceOf(1), 1_000e6);
        (address streamEmployer,,,,,,,,,,,,) = sluice.streams(1);
        assertEq(streamEmployer, employer); // cancel rights stay with the real employer

        // Vesting works normally afterwards.
        vm.warp(block.timestamp + 500);
        assertEq(sluice.availableToWithdraw(1), 500e6);
    }

    // --------------------------------------------------- F1: withdraw exit

    function test_WithdrawToChainBurnsNetAmount() public {
        vm.prank(employer);
        sluice.createStream(employee, 1_000e6, 1_000, 1_000, taxVault); // 10% tax
        vm.warp(block.timestamp + 500);

        vm.recordLogs();
        vm.prank(employee);
        gate.withdrawToChain(1, 100e6, BASE, employee);
        _relay(messengerA, messengerB);

        assertEq(usdcB.balanceOf(employee), 90e6); // net of 10% tax, minted on Base
        assertEq(usdcA.balanceOf(taxVault), 10e6); // tax stayed on Arc
        assertEq(sluice.balanceOf(1), 900e6);
    }

    function test_RevertWhen_WithdrawToChainByNonOwner() public {
        vm.prank(employer);
        sluice.createStream(employee, 1_000e6, 1_000, 0, address(0));
        vm.warp(block.timestamp + 500);
        vm.prank(lp);
        vm.expectRevert("Sluice: not owner");
        gate.withdrawToChain(1, 100e6, BASE, lp);
    }

    // --------------------------------------------------- F4: cross-chain buyout

    function test_BuyStreamFromBase() public {
        vm.prank(employer);
        sluice.createStream(employee, 1_000e6, 1_000, 0, address(0));
        vm.prank(employee);
        sluice.listStreamForSale(1, 900e6);

        bytes memory hook = abi.encode(SluiceHooks.BUY_STREAM, abi.encode(lp, uint256(1)));
        vm.recordLogs();
        vm.prank(lp);
        messengerB.depositForBurnWithHook(950e6, ARC, address(gate), hook); // overpay 50
        _relay(messengerB, messengerA);

        assertEq(sluice.ownerOf(1), lp); // SFT transferred to the remote buyer
        assertEq(usdcA.balanceOf(employee), 900e6); // seller paid on Arc
        assertEq(usdcA.balanceOf(lp), 50e6); // excess refunded on Arc
    }

    function test_BuyStreamFromBase_RefundsWhenDelisted() public {
        vm.prank(employer);
        sluice.createStream(employee, 1_000e6, 1_000, 0, address(0));

        bytes memory hook = abi.encode(SluiceHooks.BUY_STREAM, abi.encode(lp, uint256(1)));
        vm.recordLogs();
        vm.prank(lp);
        messengerB.depositForBurnWithHook(900e6, ARC, address(gate), hook); // never listed
        _relay(messengerB, messengerA);

        assertEq(sluice.ownerOf(1), employee); // unchanged
        assertEq(usdcA.balanceOf(lp), 900e6); // full refund on Arc
    }

    // --------------------------------------------------- F3: treasury routing

    function test_SweepRespectsBuffer() public {
        vm.prank(employer);
        sluice.createStream(employee, 10_000e6, 30 days, 0, address(0));

        assertEq(sluice.sweepableAmount(), 6_000e6); // 40% buffer stays
        sluice.sweepIdle();
        assertEq(usdcA.balanceOf(address(treasury)), 6_000e6);
        assertEq(treasury.principal(), 6_000e6);
        assertEq(sluice.sweepableAmount(), 0); // nothing further to sweep
    }

    function test_RebalanceSplitsAcrossLocalAndRemote() public {
        vm.prank(employer);
        sluice.createStream(employee, 10_000e6, 30 days, 0, address(0));
        sluice.sweepIdle();

        vm.recordLogs();
        treasury.rebalance();
        _relay(messengerA, messengerB); // deliver the remote deposit to the Base vault

        assertEq(localAdapter.principal(), 3_000e6);
        assertEq(vault.principal(), 3_000e6); // arrived on Base
        assertEq(treasury.idle(), 0);
        // NAV holds steady through the split (remote marked at principal).
        assertEq(treasury.totalAssets(), 6_000e6);

        // Yield accrues on both venues over a year: 4.2% local, 8.6% remote.
        vm.warp(block.timestamp + 365 days);
        assertApproxEqAbs(treasury.totalAssets(), 6_000e6 + 126e6 + 258e6, 1e6);
    }

    function test_WithdrawAutoRecallsFromTreasury() public {
        vm.prank(employer);
        sluice.createStream(employee, 10_000e6, 10_000, 0, address(0));
        sluice.sweepIdle(); // only 4,000 left in Sluice
        vm.recordLogs();
        treasury.rebalance(); // 3,000 local adapter, 3,000 remote vault
        _relay(messengerA, messengerB);

        vm.warp(block.timestamp + 10_000); // fully vested
        vm.prank(employee);
        sluice.withdrawFromStream(1, 6_500e6); // more than Sluice holds locally

        assertEq(usdcA.balanceOf(employee), 6_500e6); // 2,500 auto-recalled from local venue
        assertLt(localAdapter.principal(), 3_000e6);

        // Draining the remainder needs the remote position home first — that's the
        // relayer-driven async path, so the instant path correctly refuses.
        vm.prank(employee);
        vm.expectRevert("Treasury: illiquid");
        sluice.withdrawFromStream(1, 3_500e6);
    }

    function test_RemoteReturnBringsYieldHome() public {
        vm.prank(employer);
        sluice.createStream(employee, 10_000e6, 30 days, 0, address(0));
        sluice.sweepIdle();
        vm.recordLogs();
        treasury.rebalance();
        _relay(messengerA, messengerB);

        vm.warp(block.timestamp + 365 days);
        treasury.requestRemoteReturn(1);

        vm.recordLogs();
        vault.exitToArc(); // relayer acts on the request
        _relay(messengerB, messengerA);

        assertEq(vault.principal(), 0);
        assertEq(remoteAdapter.principalSent(), 0);
        // 3,000 principal + ~258 yield came home as idle treasury USDC.
        assertApproxEqAbs(treasury.idle(), 3_258e6, 1e6);
    }

    function test_RevertWhen_NonGateCallsPrivilegedFunctions() public {
        vm.prank(employer);
        sluice.createStream(employee, 1_000e6, 1_000, 0, address(0));

        vm.expectRevert("Sluice: only gate");
        sluice.createStreamFor(employer, employee, 1e6, 100, 0, address(0));
        vm.expectRevert("Sluice: only gate");
        sluice.withdrawFromStreamFor(employee, 1, 1e6);
        vm.expectRevert("Sluice: only gate");
        sluice.buyStreamFor(lp, 1);
    }
}

