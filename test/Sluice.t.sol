// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {Sluice} from "../contracts/Sluice.sol";
import {MockUSDC} from "../contracts/mocks/MockUSDC.sol";

contract SluiceTest is Test {
    Sluice internal sluice;
    MockUSDC internal usdc;

    address internal employer = makeAddr("employer");
    address internal employee = makeAddr("employee");
    address internal carol = makeAddr("carol");
    address internal lp = makeAddr("lp");
    address internal staker = makeAddr("staker");
    address internal taxVault = makeAddr("taxVault");

    uint256 internal constant SALARY = 1_000e6; // 1,000 USDC, 6 decimals
    uint256 internal constant DURATION = 1_000; // seconds
    uint256 internal constant TAX_BPS = 1_000; // 10%

    function setUp() public {
        usdc = new MockUSDC();
        sluice = new Sluice(address(usdc));

        usdc.mint(employer, 1_000_000e6);
        usdc.mint(lp, 1_000_000e6);
        usdc.mint(staker, 1_000_000e6);
        usdc.mint(employee, 1_000e6);

        vm.prank(employer);
        usdc.approve(address(sluice), type(uint256).max);
        vm.prank(lp);
        usdc.approve(address(sluice), type(uint256).max);
        vm.prank(staker);
        usdc.approve(address(sluice), type(uint256).max);
        vm.prank(employee);
        usdc.approve(address(sluice), type(uint256).max);
    }

    function _createStream() internal returns (uint256 streamId) {
        vm.prank(employer);
        streamId = sluice.createStream(employee, SALARY, DURATION, TAX_BPS, taxVault);
    }

    // -------------------------------------------- block-by-block rate math

    function test_RatePerSecondSixDecimals() public {
        uint256 id = _createStream();
        // 1,000e6 over 1,000s -> exactly 1e6 (1 USDC) per second
        (,,,, uint256 rate,,,,,,,,) = sluice.streams(id);
        assertEq(rate, 1e6);

        vm.warp(block.timestamp + 100);
        assertEq(sluice.vestedAmount(id), 100e6);
        assertEq(sluice.availableToWithdraw(id), 100e6);
    }

    function test_VestingCapsAtDeposit() public {
        vm.prank(employer);
        uint256 id = sluice.createStream(employee, 1_234_567, 1_000, 0, address(0));
        vm.warp(block.timestamp + 5_000); // way past the end
        assertEq(sluice.vestedAmount(id), 1_234_567);
    }

    function test_WithdrawAppliesTaxSplit() public {
        uint256 id = _createStream();
        vm.warp(block.timestamp + 100);

        uint256 before = usdc.balanceOf(employee);
        vm.prank(employee);
        sluice.withdrawFromStream(id, 100e6);

        assertEq(usdc.balanceOf(employee) - before, 90e6); // 10% tax withheld
        assertEq(usdc.balanceOf(taxVault), 10e6);
        assertEq(sluice.balanceOf(id), SALARY - 100e6); // SFT value tracks remainder
        assertEq(sluice.availableToWithdraw(id), 0);
    }

    function test_RevertWhen_WithdrawExceedsVested() public {
        uint256 id = _createStream();
        vm.warp(block.timestamp + 100);
        vm.prank(employee);
        vm.expectRevert("Sluice: exceeds available");
        sluice.withdrawFromStream(id, 100e6 + 1);
    }

    // ------------------------------------------------ ERC-3525 value splits

    function test_SplitStreamToAnotherAddress() public {
        uint256 id = _createStream();

        vm.prank(employee);
        uint256 childId = sluice.transferFrom(id, carol, 400e6);

        assertEq(sluice.ownerOf(childId), carol);
        assertEq(sluice.balanceOf(childId), 400e6);
        assertEq(sluice.balanceOf(id), 600e6);
        assertEq(sluice.remainingValue(id), 600e6);
        assertEq(sluice.remainingValue(childId), 400e6);

        // Vesting stays pro-rata: at t+500, 60%/40% of the 500 USDC vested so far.
        vm.warp(block.timestamp + 500);
        assertEq(sluice.availableToWithdraw(id), 300e6);
        assertEq(sluice.availableToWithdraw(childId), 200e6);

        // Both parties can withdraw their full share at the end.
        vm.warp(block.timestamp + 1_000);
        vm.prank(employee);
        sluice.withdrawFromStream(id, 600e6);
        vm.prank(carol);
        sluice.withdrawFromStream(childId, 400e6);
        assertEq(usdc.balanceOf(taxVault), 100e6); // 10% of the full 1,000
        assertEq(sluice.balanceOf(id), 0);
        assertEq(sluice.balanceOf(childId), 0);
    }

    function test_MergeStreamsSameSchedule() public {
        uint256 id = _createStream();
        vm.prank(employee);
        uint256 childId = sluice.transferFrom(id, carol, 400e6);

        // Carol merges part of her stream back into the parent token.
        vm.prank(carol);
        sluice.transferFrom(childId, id, 100e6);
        assertEq(sluice.balanceOf(id), 700e6);
        assertEq(sluice.balanceOf(childId), 300e6);
        assertEq(sluice.remainingValue(id), 700e6);
    }

    function test_RevertWhen_SplitByNonOwner() public {
        uint256 id = _createStream();
        vm.prank(carol);
        vm.expectRevert("ERC3525: insufficient value allowance");
        sluice.transferFrom(id, carol, 100e6);
    }

    // -------------------------------------------- P2P discount marketplace

    function test_ListAndBuyStreamAtDiscount() public {
        uint256 id = _createStream();

        vm.prank(employee);
        sluice.listStreamForSale(id, 950e6);

        uint256 employeeBefore = usdc.balanceOf(employee);
        vm.prank(lp);
        sluice.buyStream(id);

        assertEq(sluice.ownerOf(id), lp);
        assertEq(usdc.balanceOf(employee) - employeeBefore, 950e6);

        // Buyer now collects the vested salary.
        vm.warp(block.timestamp + DURATION);
        vm.prank(lp);
        sluice.withdrawFromStream(id, SALARY);
        assertEq(usdc.balanceOf(lp), 1_000_000e6 - 950e6 + 900e6); // paid 950, earned 900 net of tax
    }

    function test_RevertWhen_BuyingUnlistedStream() public {
        uint256 id = _createStream();
        vm.prank(lp);
        vm.expectRevert("Sluice: not listed");
        sluice.buyStream(id);
    }

    function test_RevertWhen_ListingByNonOwner() public {
        uint256 id = _createStream();
        vm.prank(lp);
        vm.expectRevert("Sluice: only owner");
        sluice.listStreamForSale(id, 950e6);
    }

    function test_ListingClearedAfterPurchase() public {
        uint256 id = _createStream();
        vm.prank(employee);
        sluice.listStreamForSale(id, 950e6);
        vm.prank(lp);
        sluice.buyStream(id);

        vm.prank(carol);
        vm.expectRevert("Sluice: not listed");
        sluice.buyStream(id);
    }

    // ----------------------------------------------------- salary advance

    function test_AdvanceCappedAtFiftyPercent() public {
        uint256 id = _createStream();

        vm.prank(employee);
        vm.expectRevert("Sluice: advance > 50%");
        sluice.borrowSalaryAdvance(id, 500e6 + 1);

        vm.prank(employee);
        sluice.borrowSalaryAdvance(id, 500e6);
        assertEq(sluice.balanceOf(id), 500e6);

        vm.prank(employee);
        vm.expectRevert("Sluice: advance > 50%");
        sluice.borrowSalaryAdvance(id, 1);

        // Advance repays from vesting: at t+600, 600 vested - 500 advanced = 100 free.
        vm.warp(block.timestamp + 600);
        assertEq(sluice.availableToWithdraw(id), 100e6);
    }

    // ------------------------------------------------- insurance pool

    function test_InsuranceCoversEmployerDefault() public {
        vm.prank(staker);
        sluice.stakeInsurancePool(10_000e6);

        uint256 id = _createStream();
        vm.prank(employee);
        sluice.insureStream(id); // 0.5% of 1,000 = 5 USDC premium
        assertEq(sluice.poolBalance(), 10_005e6);

        // Employer defaults halfway: 500 vested is paid out, 500 unvested is lost.
        vm.warp(block.timestamp + 500);
        vm.prank(employer);
        sluice.cancelStream(id);

        (,,,,,,,,,,,, uint256 shortfall) = sluice.streams(id);
        assertEq(shortfall, 500e6);

        uint256 before = usdc.balanceOf(employee);
        vm.prank(employee);
        sluice.claimDefaultCoverage(id);
        assertEq(usdc.balanceOf(employee) - before, 500e6);
        assertEq(sluice.poolBalance(), 10_005e6 - 500e6);
    }

    function test_StakerAccruesPremiumsAndBearsClaims() public {
        vm.prank(staker);
        sluice.stakeInsurancePool(10_000e6);

        uint256 id = _createStream();
        vm.prank(employee);
        sluice.insureStream(id);

        // No default: staker exits with the premium included.
        uint256 shares = sluice.poolShares(staker);
        vm.prank(staker);
        sluice.unstakeInsurancePool(shares);
        assertEq(usdc.balanceOf(staker), 1_000_000e6 + 5e6);
    }

    function test_RevertWhen_ClaimingWithoutDefault() public {
        uint256 id = _createStream();
        vm.prank(employee);
        sluice.insureStream(id);
        vm.prank(employee);
        vm.expectRevert("Sluice: no default");
        sluice.claimDefaultCoverage(id);
    }

    // ------------------------------------------------------- cancellation

    function test_CancelSettlesBothParties() public {
        uint256 id = _createStream();
        vm.warp(block.timestamp + 250);

        uint256 employerBefore = usdc.balanceOf(employer);
        uint256 employeeBefore = usdc.balanceOf(employee);
        vm.prank(employer);
        sluice.cancelStream(id);

        assertEq(usdc.balanceOf(employee) - employeeBefore, 225e6); // 250 vested minus 10% tax
        assertEq(usdc.balanceOf(taxVault), 25e6);
        assertEq(usdc.balanceOf(employer) - employerBefore, 750e6); // unvested refund
        assertEq(sluice.balanceOf(id), 0);
    }
}
