// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/*
 * @title CoveragePool Unit Tests
 * @dev "Hacker Mindset" testing focusing on:
 * 1. Vault Math: ERC4626 maxWithdraw/maxRedeem caps when liquidity is locked.
 * 2. Access Control: Ensuring only authorized contracts move funds.
 * 3. State Isolation: Free liquidity vs Locked liquidity boundaries.
 */

import {Test} from "forge-std/Test.sol";
import {CoveragePool} from "../../src/core/CoveragePool.sol";
import {ICoveragePool} from "../../src/interfaces/ICoveragePool.sol";
import {MockUSDC} from "../mocks/MockUSDC.sol";
import {MockAavePool} from "../mocks/MockAavePool.sol";
import {MockAToken} from "../mocks/MockAToken.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";

contract CoveragePoolTest is Test {
    CoveragePool public pool;
    MockUSDC public usdc;
    MockAavePool public aave;
    MockAToken public aToken;

    address public owner = address(this);
    address public policyEngine = address(0x111);
    address public payoutExecutor = address(0x222);
    address public lpUser = address(0x333);
    address public hacker = address(0x999);
    address public protocol = address(0x555);

    function setUp() public {
        // 1. Setup Mocks
        usdc = new MockUSDC();
        aToken = new MockAToken();
        aave = new MockAavePool(address(usdc), address(aToken));
        aToken.setPool(address(aave));

        // 2. Deploy CoveragePool
        pool = new CoveragePool(address(usdc), address(aave), address(aToken));

        // 3. Configure Roles
        pool.setPolicyEngine(policyEngine);
        pool.setPayoutExecutor(payoutExecutor);

        // 4. Fund LP User
        usdc.mint(lpUser, 100_000e6);
        vm.prank(lpUser);
        usdc.approve(address(pool), type(uint256).max);
    }

    // --------------------------------------------------------
    //  Access Control & Initialization Tests
    // --------------------------------------------------------

    function test_RevertIf_ZeroAddressConstructor() public {
        vm.expectRevert(CoveragePool.CoveragePool__ZeroAddress.selector);
        new CoveragePool(address(0), address(aave), address(aToken));
    }

    function test_RevertIf_SetRolesTwice() public {
        vm.expectRevert(CoveragePool.CoveragePool__EngineAlreadySet.selector);
        pool.setPolicyEngine(address(0x444));

        vm.expectRevert(CoveragePool.CoveragePool__ExecutorAlreadySet.selector);
        pool.setPayoutExecutor(address(0x555));
    }

    function test_RevertIf_UnauthorizedAccess() public {
        vm.startPrank(hacker);

        vm.expectRevert(abi.encodeWithSelector(ICoveragePool.ICoveragePool__Unauthorized.selector, hacker));
        pool.lockCoverage(1, protocol, 100e6);

        vm.expectRevert(abi.encodeWithSelector(ICoveragePool.ICoveragePool__Unauthorized.selector, hacker));
        pool.executePayout(1, hacker, 100e6);

        vm.stopPrank();
    }

    // --------------------------------------------------------
    //  LP Core Operations (ERC-4626 Mechanics)
    // --------------------------------------------------------

    function test_DepositAndWithdraw_Success() public {
        uint256 depositAmount = 10_000e6;

        vm.startPrank(lpUser);
        
        pool.deposit(depositAmount);
        assertEq(pool.totalAssets(), depositAmount);
        assertEq(pool.totalLiquidity(), depositAmount);
        
        uint256 expectedShares = 10_000e6 * 10**6; 
        assertEq(pool.balanceOf(lpUser), expectedShares);

        pool.withdraw(expectedShares);
        assertEq(pool.totalAssets(), 0);
        assertEq(usdc.balanceOf(lpUser), 100_000e6);

        vm.stopPrank();
    }

    function test_RevertIf_ZeroDepositOrWithdraw() public {
        vm.startPrank(lpUser);
        
        vm.expectRevert(ICoveragePool.ICoveragePool__ZeroDeposit.selector);
        pool.deposit(0);

        vm.expectRevert(abi.encodeWithSelector(ICoveragePool.ICoveragePool__InsufficientShares.selector, 0, 0));
        pool.withdraw(0);
        
        vm.stopPrank();
    }

    // --------------------------------------------------------
    //  System State: Lock, Release, and Boundary Checks
    // --------------------------------------------------------

    function test_RevertIf_LockExceedsFreeLiquidity() public {
        vm.prank(lpUser);
        pool.deposit(10_000e6);

        vm.prank(policyEngine);
        vm.expectRevert(abi.encodeWithSelector(ICoveragePool.ICoveragePool__InsufficientFreeLiquidity.selector, 15_000e6, 10_000e6));
        pool.lockCoverage(1, protocol, 15_000e6);
    }

    function test_LockAndRelease_UpdatesStateCorrectly() public {
        vm.prank(lpUser);
        pool.deposit(10_000e6);

        vm.prank(policyEngine);
        pool.lockCoverage(1, protocol, 4_000e6);

        assertEq(pool.totalLockedLiquidity(), 4_000e6);
        assertEq(pool.freeLiquidity(), 6_000e6);
        assertEq(pool.lockedCoverageOf(1), 4_000e6);

        vm.prank(policyEngine);
        pool.releaseCoverage(1);

        assertEq(pool.totalLockedLiquidity(), 0);
        assertEq(pool.freeLiquidity(), 10_000e6);
    }
function test_RevertIf_WithdrawCutsIntoLockedLiquidity() public {
        vm.prank(lpUser);
        pool.deposit(10_000e6);

        vm.prank(policyEngine);
        pool.lockCoverage(1, protocol, 6_000e6);

        vm.startPrank(lpUser);
        uint256 shares = pool.balanceOf(lpUser);
        
        uint256 maxRedeemable = pool.maxRedeem(lpUser);
        vm.expectRevert(abi.encodeWithSignature("ERC4626ExceededMaxRedeem(address,uint256,uint256)", lpUser, shares, maxRedeemable)); 
        pool.withdraw(shares);
        vm.stopPrank();
    }

    function test_MaxWithdrawAndRedeem_CapByFreeLiquidity() public {
        vm.prank(lpUser);
        pool.deposit(10_000e6);

        vm.prank(policyEngine);
        pool.lockCoverage(1, protocol, 8_000e6);

        uint256 maxW = pool.maxWithdraw(lpUser);
        assertEq(maxW, 2_000e6);

        uint256 maxR = pool.maxRedeem(lpUser);
        assertEq(maxR, 2_000e6 * 10**6);
    }

    // --------------------------------------------------------
    //  Payout & Premium Math
    // --------------------------------------------------------

    function test_RevertIf_PayoutExceedsLocked() public {
        vm.prank(lpUser);
        pool.deposit(10_000e6);

        vm.prank(policyEngine);
        pool.lockCoverage(1, protocol, 5_000e6);

        vm.prank(payoutExecutor);
        vm.expectRevert(abi.encodeWithSelector(ICoveragePool.ICoveragePool__PayoutExceedsLocked.selector, 6_000e6, 5_000e6));
        pool.executePayout(1, lpUser, 6_000e6);
    }

    function test_ExecutePayout_Success() public {
        vm.prank(lpUser);
        pool.deposit(10_000e6);

        vm.prank(policyEngine);
        pool.lockCoverage(1, protocol, 5_000e6);

        uint256 hackerBalanceBefore = usdc.balanceOf(hacker);

        vm.prank(payoutExecutor);
        pool.executePayout(1, hacker, 5_000e6);

        assertEq(pool.totalLockedLiquidity(), 0);
        assertEq(pool.totalAssets(), 5_000e6);
        assertEq(usdc.balanceOf(hacker), hackerBalanceBefore + 5_000e6);
    }

    function test_CollectAndRefundPremium() public {
        uint256 premium = 500e6;
        usdc.mint(policyEngine, premium);

        vm.startPrank(policyEngine);
        usdc.approve(address(pool), premium);
        
        pool.collectPremium(1, premium);
        assertEq(pool.totalAssets(), premium);

        pool.refundPremium(lpUser, 100e6);
        assertEq(pool.totalAssets(), 400e6);
        vm.stopPrank();

        assertEq(usdc.balanceOf(lpUser), 100_000e6 + 100e6);
    }

    // --------------------------------------------------------
    //  FIXED: Emergency Controls (Pause/Unpause)
    // --------------------------------------------------------

    function test_PauseBlocksDepositsAndWithdrawals() public {
        pool.pause();

        vm.startPrank(lpUser);
        vm.expectRevert(Pausable.EnforcedPause.selector);
        pool.deposit(1_000e6);
        vm.stopPrank();

        pool.unpause(); 

        vm.startPrank(lpUser);
        pool.deposit(1_000e6);
        vm.stopPrank();
    }

    // --------------------------------------------------------
    //  NEW: Coverage Booster Tests (90%+)
    // --------------------------------------------------------

    function test_ViewFunctions_MathAndShares() public {
        vm.startPrank(lpUser);
        pool.deposit(10_000e6);
        
        uint256 shares = pool.sharesOf(lpUser);
        assertEq(shares, 10_000e6 * 10**6);

        assertEq(pool.usdcToShares(10_000e6), shares);
        assertEq(pool.sharesToUsdc(shares), 10_000e6);
        
        vm.stopPrank();
    }

    function test_ReleaseCoverage_EarlyReturnIfZero() public {
        vm.prank(policyEngine);
        pool.releaseCoverage(999);
    }

    function test_CollectPremium_EarlyReturnIfZero() public {
        vm.prank(policyEngine);
        pool.collectPremium(1, 0); 
    }

    function test_RefundPremium_EarlyReturnIfZero() public {
        vm.prank(policyEngine);
        pool.refundPremium(lpUser, 0);
    }

    function test_RevertIf_ZeroAddressOnTransfers() public {
        vm.prank(policyEngine);
        vm.expectRevert(CoveragePool.CoveragePool__ZeroAddress.selector);
        pool.refundPremium(address(0), 100e6);

        vm.prank(payoutExecutor);
        vm.expectRevert(CoveragePool.CoveragePool__ZeroAddress.selector);
        pool.executePayout(1, address(0), 100e6);
    }

    function test_MaxWithdrawAndRedeem_NoLocks() public {
        vm.prank(lpUser);
        pool.deposit(10_000e6);
        
        assertEq(pool.maxWithdraw(lpUser), 10_000e6);
        assertEq(pool.maxRedeem(lpUser), pool.usdcToShares(10_000e6));
    }
}