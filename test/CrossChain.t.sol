// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {Sluice, IERC20} from "../contracts/Sluice.sol";
import {MockUSDC} from "../contracts/mocks/MockUSDC.sol";
import {ITokenMessengerV2, CCTPFinality} from "../contracts/crosschain/CCTPInterfaces.sol";
import {SluiceGate, SluiceHooks} from "../contracts/crosschain/SluiceGate.sol";
import {SluiceTreasury} from "../contracts/crosschain/SluiceTreasury.sol";
import {ReserveYieldAdapter, CCTPRemoteAdapter, IYieldAdapter} from "../contracts/crosschain/YieldAdapters.sol";
import {RemoteYieldVault} from "../contracts/crosschain/RemoteYieldVault.sol";

/// @dev Test double for Circle's TokenMessengerV2: records burn calls and burns
///      the caller's USDC. The test itself plays the attestation relayer, minting
///      on the "destination" and invoking hooks — mirroring exactly what the real
///      relayer does with MessageTransmitterV2.receiveMessage + onCCTPHook.
contract StubTokenMessenger is ITokenMessengerV2 {
    MockUSDC public immutable usdc;

    struct Burn {
        uint256 amount;
        uint32 destinationDomain;
        bytes32 mintRecipient;
        bytes32 destinationCaller;
        uint256 maxFee;
        uint32 minFinalityThreshold;
        bytes hookData;
    }

    Burn[] public burns;

    constructor(MockUSDC usdc_) {
        usdc = usdc_;
    }

    function burnCount() external view returns (uint256) {
        return burns.length;
    }

    function lastBurn() external view returns (Burn memory) {
        return burns[burns.length - 1];
    }

    function depositForBurn(
        uint256 amount,
        uint32 destinationDomain,
        bytes32 mintRecipient,
        address burnToken,
        bytes32 destinationCaller,
        uint256 maxFee,
        uint32 minFinalityThreshold
    ) external {
        _burn(amount, destinationDomain, mintRecipient, burnToken, destinationCaller, maxFee, minFinalityThreshold, "");
    }

    function depositForBurnWithHook(
        uint256 amount,
        uint32 destinationDomain,
        bytes32 mintRecipient,
        address burnToken,
        bytes32 destinationCaller,
        uint256 maxFee,
        uint32 minFinalityThreshold,
        bytes calldata hookData
    ) external {
        _burn(
            amount,
            destinationDomain,
            mintRecipient,
            burnToken,
            destinationCaller,
            maxFee,
            minFinalityThreshold,
            hookData
        );
    }

    function _burn(
        uint256 amount,
        uint32 destinationDomain,
        bytes32 mintRecipient,
        address burnToken,
        bytes32 destinationCaller,
        uint256 maxFee,
        uint32 minFinalityThreshold,
        bytes memory hookData
    ) internal {
        require(burnToken == address(usdc), "Stub: wrong token");
        require(usdc.transferFrom(msg.sender, address(this), amount), "Stub: pull failed");
        usdc.burn(address(this), amount);
        burns.push(
            Burn(amount, destinationDomain, mintRecipient, destinationCaller, maxFee, minFinalityThreshold, hookData)
        );
    }
}

contract CrossChainTest is Test {
    uint32 constant ARC = 26;
    uint32 constant BASE = 6;

    // "Arc" side
    MockUSDC usdcA;
    Sluice sluice;
    StubTokenMessenger messengerA;
    SluiceGate gate;
    SluiceTreasury treasury;
    ReserveYieldAdapter localAdapter;
    CCTPRemoteAdapter remoteAdapter;

    // "Base Sepolia" side
    MockUSDC usdcB;
    StubTokenMessenger messengerB;
    RemoteYieldVault vault;

    address employer = makeAddr("employer");
    address employee = makeAddr("employee");
    address lp = makeAddr("lp");
    address taxVault = makeAddr("taxVault");
    address relayer = makeAddr("relayer");

    function setUp() public {
        usdcA = new MockUSDC();
        sluice = new Sluice(address(usdcA));
        messengerA = new StubTokenMessenger(usdcA);
        gate = new SluiceGate(sluice, ITokenMessengerV2(address(messengerA)), relayer);
        treasury = new SluiceTreasury(sluice, relayer);

        usdcB = new MockUSDC();
        messengerB = new StubTokenMessenger(usdcB);
        vault = new RemoteYieldVault(
            IERC20(address(usdcB)), ITokenMessengerV2(address(messengerB)), address(treasury), ARC, 860, relayer
        );

        localAdapter = new ReserveYieldAdapter(IERC20(address(usdcA)), address(treasury), "Arc Reserve Vault", 420, ARC);
        remoteAdapter = new CCTPRemoteAdapter(
            IERC20(address(usdcA)),
            ITokenMessengerV2(address(messengerA)),
            address(treasury),
            address(vault),
            BASE,
            "Base Sepolia Vault",
            860,
            relayer
        );

        sluice.setGate(address(gate));
        sluice.setTreasury(address(treasury));
        treasury.addAdapter(IYieldAdapter(address(localAdapter)), 5_000);
        treasury.addAdapter(IYieldAdapter(address(remoteAdapter)), 5_000);

        usdcA.mint(employer, 1_000_000e6);
        usdcA.mint(address(this), 100_000e6);
        usdcB.mint(address(this), 100_000e6);
        vm.prank(employer);
        usdcA.approve(address(sluice), type(uint256).max);

        // Fund yield reserves with (test) USDC — mirrors the real deployments,
        // where reserves hold faucet USDC.
        usdcA.approve(address(localAdapter), type(uint256).max);
        localAdapter.fundReserve(10_000e6);
        usdcB.approve(address(vault), type(uint256).max);
        vault.fundReserve(10_000e6);
    }

    /// @dev Plays the attestation relayer for a hooked delivery: mints the burned
    ///      amount on the destination (what receiveMessage does) and executes the
    ///      hook as the relayer.
    function _deliverHook(StubTokenMessenger src, MockUSDC destUsdc, address recipient, uint32 sourceDomain) internal {
        StubTokenMessenger.Burn memory burn = src.lastBurn();
        destUsdc.mint(recipient, burn.amount);
        vm.prank(relayer);
        (bool ok,) = recipient.call(
            abi.encodeWithSignature("onCCTPHook(uint32,uint256,bytes)", sourceDomain, burn.amount, burn.hookData)
        );
        require(ok, "hook delivery failed");
    }

    // --------------------------------------------------- gate: hooked funding

    function test_FundStreamFromBase() public {
        bytes memory hook = abi.encode(
            SluiceHooks.FUND_STREAM, abi.encode(employer, employee, uint256(1_000), uint256(1_000), taxVault)
        );
        // LP burns on Base Sepolia targeting the Arc gate (recorded by the stub).
        usdcB.approve(address(messengerB), 1_000e6);
        messengerB.depositForBurnWithHook(
            1_000e6, ARC, bytes32(uint256(uint160(address(gate)))), address(usdcB), bytes32(0), 1e6, 1000, hook
        );
        _deliverHook(messengerB, usdcA, address(gate), BASE);

        assertEq(sluice.ownerOf(1), employee);
        assertEq(sluice.balanceOf(1), 1_000e6);
        (address streamEmployer,,,,,,,,,,,,) = sluice.streams(1);
        assertEq(streamEmployer, employer);
        vm.warp(block.timestamp + 500);
        assertEq(sluice.availableToWithdraw(1), 500e6);
    }

    function test_RevertWhen_HookCallerNotRelayer() public {
        bytes memory hook = abi.encode(SluiceHooks.BUY_STREAM, abi.encode(lp, uint256(1)));
        vm.expectRevert("Gate: only relayer");
        gate.onCCTPHook(BASE, 1e6, hook);
    }

    // --------------------------------------------------- gate: withdraw exit

    function test_WithdrawToChainBurnsNetAmount() public {
        vm.prank(employer);
        sluice.createStream(employee, 1_000e6, 1_000, 1_000, taxVault); // 10% tax
        vm.warp(block.timestamp + 500);

        vm.prank(employee);
        gate.withdrawToChain(1, 100e6, BASE, employee);

        StubTokenMessenger.Burn memory burn = messengerA.lastBurn();
        assertEq(burn.amount, 90e6); // net of 10% tax
        assertEq(burn.destinationDomain, BASE);
        assertEq(burn.mintRecipient, bytes32(uint256(uint160(employee))));
        assertEq(burn.maxFee, 0); // standard finality leaving Arc — fee-free
        assertEq(burn.minFinalityThreshold, CCTPFinality.STANDARD);
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

    // --------------------------------------------------- gate: cross-chain buyout

    function test_BuyStreamFromBase() public {
        vm.prank(employer);
        sluice.createStream(employee, 1_000e6, 1_000, 0, address(0));
        vm.prank(employee);
        sluice.listStreamForSale(1, 900e6);

        bytes memory hook = abi.encode(SluiceHooks.BUY_STREAM, abi.encode(lp, uint256(1)));
        usdcB.approve(address(messengerB), 950e6);
        messengerB.depositForBurnWithHook(
            950e6, ARC, bytes32(uint256(uint160(address(gate)))), address(usdcB), bytes32(0), 1e6, 1000, hook
        );
        _deliverHook(messengerB, usdcA, address(gate), BASE);

        assertEq(sluice.ownerOf(1), lp);
        assertEq(usdcA.balanceOf(employee), 900e6);
        assertEq(usdcA.balanceOf(lp), 50e6); // excess refunded on Arc
    }

    function test_BuyStreamFromBase_RefundsWhenDelisted() public {
        vm.prank(employer);
        sluice.createStream(employee, 1_000e6, 1_000, 0, address(0));

        bytes memory hook = abi.encode(SluiceHooks.BUY_STREAM, abi.encode(lp, uint256(1)));
        usdcB.approve(address(messengerB), 900e6);
        messengerB.depositForBurnWithHook(
            900e6, ARC, bytes32(uint256(uint160(address(gate)))), address(usdcB), bytes32(0), 1e6, 1000, hook
        );
        _deliverHook(messengerB, usdcA, address(gate), BASE);

        assertEq(sluice.ownerOf(1), employee);
        assertEq(usdcA.balanceOf(lp), 900e6); // full refund on Arc
    }

    // --------------------------------------------------- treasury routing

    function test_SweepRespectsBuffer() public {
        vm.prank(employer);
        sluice.createStream(employee, 10_000e6, 30 days, 0, address(0));

        assertEq(sluice.sweepableAmount(), 6_000e6); // 40% buffer stays
        sluice.sweepIdle();
        assertEq(usdcA.balanceOf(address(treasury)), 6_000e6);
        assertEq(treasury.principal(), 6_000e6);
        assertEq(sluice.sweepableAmount(), 0);
    }

    function test_RebalanceSplitsAcrossLocalAndRemote() public {
        vm.prank(employer);
        sluice.createStream(employee, 10_000e6, 30 days, 0, address(0));
        sluice.sweepIdle();

        treasury.rebalance();
        _deliverHook(messengerA, usdcB, address(vault), ARC); // deposit lands on Base

        assertEq(localAdapter.principal(), 3_000e6);
        assertEq(vault.principal(), 3_000e6);
        assertEq(treasury.idle(), 0);
        assertEq(treasury.totalAssets(), 6_000e6);

        // Yield accrues on both venues over a year: 4.2% local, 8.6% remote —
        // paid from real reserves, not minted.
        vm.warp(block.timestamp + 365 days);
        assertApproxEqAbs(treasury.totalAssets(), 6_000e6 + 126e6 + 258e6, 1e6);
    }

    function test_ReserveCapsAccrual() public {
        ReserveYieldAdapter tight = new ReserveYieldAdapter(IERC20(address(usdcA)), address(this), "Tight", 10_000, ARC); // 100% APY
        usdcA.approve(address(tight), type(uint256).max);
        tight.fundReserve(5e6);
        usdcA.transfer(address(tight), 100e6);
        tight.deposit(100e6);

        vm.warp(block.timestamp + 365 days); // uncapped would owe 100 USDC
        assertEq(tight.totalAssets(), 105e6); // interest bounded by the 5 USDC reserve

        uint256 paid = tight.withdraw(type(uint256).max);
        assertEq(paid, 105e6); // fully backed by real balance
    }

    function test_WithdrawAutoRecallsFromTreasury() public {
        vm.prank(employer);
        sluice.createStream(employee, 10_000e6, 10_000, 0, address(0));
        sluice.sweepIdle(); // only 4,000 left in Sluice
        treasury.rebalance(); // 3,000 local, 3,000 burned to Base
        _deliverHook(messengerA, usdcB, address(vault), ARC);

        vm.warp(block.timestamp + 10_000); // fully vested
        vm.prank(employee);
        sluice.withdrawFromStream(1, 6_500e6); // needs 2,500 recalled from local venue
        assertEq(usdcA.balanceOf(employee), 6_500e6);
        assertLt(localAdapter.principal(), 3_000e6);

        // Draining the remainder needs the remote position home first.
        vm.prank(employee);
        vm.expectRevert("Treasury: illiquid");
        sluice.withdrawFromStream(1, 3_500e6);
    }

    function test_RemoteReturnBringsYieldHome() public {
        vm.prank(employer);
        sluice.createStream(employee, 10_000e6, 30 days, 0, address(0));
        sluice.sweepIdle();
        treasury.rebalance();
        _deliverHook(messengerA, usdcB, address(vault), ARC);

        vm.warp(block.timestamp + 365 days);
        treasury.requestRemoteReturn(1);

        vm.prank(relayer);
        vault.exitToArc();
        StubTokenMessenger.Burn memory burn = messengerB.lastBurn();
        assertEq(burn.minFinalityThreshold, CCTPFinality.FAST); // fast path home
        assertEq(burn.maxFee, burn.amount / 1_000); // 0.1% cap
        _deliverHook(messengerB, usdcA, address(treasury), BASE);

        assertEq(vault.principal(), 0);
        assertEq(remoteAdapter.principalSent(), 0);
        assertApproxEqAbs(treasury.idle(), 3_258e6, 1e6); // principal + 8.6% yield
    }

    function test_RevertWhen_VaultExitByNonRelayer() public {
        vm.expectRevert("Vault: only relayer");
        vault.exitToArc();
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
