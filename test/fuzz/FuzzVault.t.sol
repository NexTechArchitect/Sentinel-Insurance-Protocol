// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {CoveragePool} from "../../src/core/CoveragePool.sol";
import {ICoveragePool} from "../../src/interfaces/ICoveragePool.sol";
import {MockUSDC} from "../mocks/MockUSDC.sol";
import {MockAavePool} from "../mocks/MockAavePool.sol";
import {MockAToken} from "../mocks/MockAToken.sol";

contract FuzzVaultTest is Test {
    CoveragePool public pool;
    MockUSDC public usdc;
    MockAavePool public aave;
    MockAToken public aToken;

    address public policyEngine = address(0x111);
    address public lpUser = address(0x333);
    address public protocol = address(0x555);

    function setUp() public {
        usdc = new MockUSDC();
        aToken = new MockAToken();
        aave = new MockAavePool(address(usdc), address(aToken));
        aToken.setPool(address(aave));

        pool = new CoveragePool(address(usdc), address(aave), address(aToken));
        pool.setPolicyEngine(policyEngine);

        usdc.mint(lpUser, type(uint256).max / 2);
        vm.prank(lpUser);
        usdc.approve(address(pool), type(uint256).max);
    }

    // FUZZ 1: Deposit and Share Math. Ensures precision loss doesn't lock funds.
    function testFuzz_DepositWithdrawMathPrecision(uint256 depositAmount) public {
        // Bound to realistic USDC amounts: $1 to $100 Million
        depositAmount = bound(depositAmount, 1e6, 100_000_000e6);

        vm.startPrank(lpUser);
        uint256 balanceBefore = usdc.balanceOf(lpUser);
        
        pool.deposit(depositAmount);
        uint256 shares = pool.balanceOf(lpUser);
        
        assertTrue(shares > 0, "Bug: Shares minted is zero");
        assertEq(pool.totalLiquidity(), depositAmount, "Bug: Vault assets mismatch");

        // Immediately withdraw all shares
        pool.withdraw(shares);
        
        // Due to precision math, user should get exact amount back (no dust left behind)
        assertEq(usdc.balanceOf(lpUser), balanceBefore, "Bug: Precision loss stole user funds");
        vm.stopPrank();
    }

    // FUZZ 2: Liquidity Lock Exploit check. Try to lock more than free liquidity.
    function testFuzz_RevertIf_LockExceedsFreeLiquidity(uint256 depositAmount, uint256 lockAmount) public {
        depositAmount = bound(depositAmount, 1e6, 1_000_000e6); // Max 1M deposit
        lockAmount = bound(lockAmount, depositAmount + 1, type(uint256).max); // Lock ALWAYS greater than deposit

        vm.prank(lpUser);
        pool.deposit(depositAmount);

        // PolicyEngine tries to lock an amount strictly greater than what's available
        vm.prank(policyEngine);
        
        // Protocol MUST revert with this exact error.
        vm.expectRevert(abi.encodeWithSelector(ICoveragePool.ICoveragePool__InsufficientFreeLiquidity.selector, lockAmount, depositAmount));
        pool.lockCoverage(1, protocol, lockAmount);
    }
}