// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/*
 * @title PayoutExecutor Unit Tests
 * @dev Rigorous testing focusing on:
 * 1. Keeper Pattern Security (Anyone can call, but state must be perfectly aligned)
 * 2. Status Enforcement (Only APPROVED claims can be processed)
 * 3. Collateral Math (Cannot payout more than what is strictly locked)
 */

import {Test} from "forge-std/Test.sol";
import {PayoutExecutor} from "../../src/core/PayoutExecutor.sol";
import {IPayoutExecutor} from "../../src/interfaces/IPayoutExecutor.sol";
import {IClaimsGovernor} from "../../src/interfaces/IClaimsGovernor.sol";
import {IPolicyEngine} from "../../src/interfaces/IPolicyEngine.sol";
import {ICoveragePool} from "../../src/interfaces/ICoveragePool.sol";

contract PayoutExecutorTest is Test {
    PayoutExecutor public executor;

    // Fake dependency addresses for mockCalls
    address public mockGovernor = address(0x111);
    address public mockPolicyEngine = address(0x222);
    address public mockPool = address(0x333);
    
    address public owner = address(this);
    address public policyHolder = address(0x555);
    address public randomKeeper = address(0x999);

    event PayoutExecuted(
        uint256 indexed claimId,
        uint256 indexed policyId,
        address indexed recipient,
        uint256 amount,
        uint256 executedAt
    );

    function setUp() public {
        // Deploy Executor with Mock Dependencies
        executor = new PayoutExecutor(
            mockGovernor,
            mockPolicyEngine,
            mockPool
        );
    }

    // --------------------------------------------------------
    //  Initialization Tests
    // --------------------------------------------------------

    function test_RevertIf_ZeroAddressesInConstructor() public {
        vm.expectRevert(PayoutExecutor.PayoutExecutor__ZeroAddress.selector);
        new PayoutExecutor(address(0), mockPolicyEngine, mockPool);

        vm.expectRevert(PayoutExecutor.PayoutExecutor__ZeroAddress.selector);
        new PayoutExecutor(mockGovernor, address(0), mockPool);

        vm.expectRevert(PayoutExecutor.PayoutExecutor__ZeroAddress.selector);
        new PayoutExecutor(mockGovernor, mockPolicyEngine, address(0));
    }

    // --------------------------------------------------------
    //  Execution Security & Reverts
    // --------------------------------------------------------

    function test_RevertIf_ClaimNotApproved() public {
        // Mock a PENDING claim (Status 0)
        _mockClaim(1, 100, IClaimsGovernor.ClaimStatus.PENDING);

        vm.prank(randomKeeper);
        vm.expectRevert(abi.encodeWithSelector(IPayoutExecutor.IPayoutExecutor__ClaimNotApproved.selector, 1));
        executor.executePayout(1);

        // Mock an EXECUTED claim (Status 4) -> Double spend attempt
        _mockClaim(2, 101, IClaimsGovernor.ClaimStatus.EXECUTED);

        vm.prank(randomKeeper);
        vm.expectRevert(abi.encodeWithSelector(IPayoutExecutor.IPayoutExecutor__ClaimNotApproved.selector, 2));
        executor.executePayout(2);
    }

    function test_RevertIf_RecipientIsZeroAddress() public {
        // Mock an APPROVED claim
        _mockClaim(1, 100, IClaimsGovernor.ClaimStatus.APPROVED);
        
        // Mock a policy where the holder somehow became address(0)
        _mockPolicy(100, address(0), 10_000e6);

        vm.prank(randomKeeper);
        vm.expectRevert(PayoutExecutor.PayoutExecutor__ZeroAddress.selector);
        executor.executePayout(1);
    }

    function test_RevertIf_AmountExceedsLockedCoverage() public {
        // Mock an APPROVED claim
        _mockClaim(1, 100, IClaimsGovernor.ClaimStatus.APPROVED);
        
        // Policy says coverage is 10,000 USDC
        _mockPolicy(100, policyHolder, 10_000e6);

        // But CoveragePool says only 5,000 USDC is locked! (Severe math mismatch)
        _mockLockedCoverage(100, 5_000e6);

        vm.prank(randomKeeper);
        // Expect revert with (claimId, policyId)
        vm.expectRevert(abi.encodeWithSelector(IPayoutExecutor.IPayoutExecutor__PolicyMismatch.selector, 1, 100));
        executor.executePayout(1);
    }

    // --------------------------------------------------------
    //  Happy Path (Successful Execution)
    // --------------------------------------------------------

    function test_ExecutePayout_Success() public {
        uint256 claimId = 1;
        uint256 policyId = 100;
        uint256 amount = 10_000e6;

        // 1. Setup Mocks
        _mockClaim(claimId, policyId, IClaimsGovernor.ClaimStatus.APPROVED);
        _mockPolicy(policyId, policyHolder, amount);
        _mockLockedCoverage(policyId, amount); // Locked exactly matches policy

        // 2. Setup Expected Mock Interactions
        // Executor should tell Governor to mark it EXECUTED
        vm.mockCall(
            mockGovernor,
            abi.encodeWithSelector(IClaimsGovernor.markExecuted.selector, claimId),
            abi.encode()
        );

        // Executor should tell Pool to send the money
        vm.mockCall(
            mockPool,
            abi.encodeWithSelector(ICoveragePool.executePayout.selector, policyId, policyHolder, amount),
            abi.encode()
        );

        // 3. Execution (by anyone)
        vm.expectEmit(true, true, true, true);
        emit PayoutExecuted(claimId, policyId, policyHolder, amount, block.timestamp);

        vm.prank(randomKeeper);
        executor.executePayout(claimId);
    }

    // --------------------------------------------------------
    //  View Functions Coverage
    // --------------------------------------------------------

    function test_IsPayoutComplete() public {
        // Test EXECUTED state
        _mockClaim(1, 100, IClaimsGovernor.ClaimStatus.EXECUTED);
        assertTrue(executor.isPayoutComplete(1));

        // Test non-EXECUTED state
        _mockClaim(2, 101, IClaimsGovernor.ClaimStatus.APPROVED);
        assertFalse(executor.isPayoutComplete(2));
    }

    function test_PreviewPayout() public {
        uint256 claimId = 1;
        uint256 policyId = 100;
        uint256 amount = 15_000e6;

        _mockClaim(claimId, policyId, IClaimsGovernor.ClaimStatus.APPROVED);
        _mockPolicy(policyId, policyHolder, amount);

        (address recipient, uint256 expectedAmount) = executor.previewPayout(claimId);

        assertEq(recipient, policyHolder);
        assertEq(expectedAmount, amount);
    }

    // --------------------------------------------------------
    //  Internal Helpers
    // --------------------------------------------------------

    function _mockClaim(uint256 claimId, uint256 policyId, IClaimsGovernor.ClaimStatus status) internal {
        IClaimsGovernor.Claim memory c;
        c.policyId = policyId;
        c.status = status;

        vm.mockCall(
            mockGovernor,
            abi.encodeWithSelector(IClaimsGovernor.getClaim.selector, claimId),
            abi.encode(c)
        );
    }

    function _mockPolicy(uint256 policyId, address holder, uint256 amount) internal {
        IPolicyEngine.Policy memory p;
        p.holder = holder;
        p.coverageAmount = amount;

        vm.mockCall(
            mockPolicyEngine,
            abi.encodeWithSelector(IPolicyEngine.getPolicy.selector, policyId),
            abi.encode(p)
        );
    }

    function _mockLockedCoverage(uint256 policyId, uint256 lockedAmount) internal {
        vm.mockCall(
            mockPool,
            abi.encodeWithSelector(ICoveragePool.lockedCoverageOf.selector, policyId),
            abi.encode(lockedAmount)
        );
    }
}