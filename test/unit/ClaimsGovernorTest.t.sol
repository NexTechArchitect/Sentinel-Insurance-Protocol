// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/*
 * @title ClaimsGovernor Unit Tests
 * @dev Rigorous "Hacker Mindset" testing focusing on:
 * 1. Governance Snapshots (ERC20Votes past blocks)
 * 2. Strict Time-Locks (Voting Periods)
 * 3. Quorum and Majority Math validation
 * 4. Failsafes (Veto Council & Pausability)
 */

import {Test} from "forge-std/Test.sol";
import {ClaimsGovernor} from "../../src/core/ClaimsGovernor.sol"; 
import {IClaimsGovernor} from "../../src/interfaces/IClaimsGovernor.sol";
import {IPolicyEngine} from "../../src/interfaces/IPolicyEngine.sol";
import {ICoveragePool} from "../../src/interfaces/ICoveragePool.sol"; 
import {ShieldToken} from "../../src/governance/ShieldToken.sol";
import {ClaimValidator} from "../../src/libraries/ClaimValidator.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";

contract ClaimsGovernorTest is Test {
    ClaimsGovernor public governor;
    ShieldToken public shield;

    // Fake dependency addresses for mockCalls
    address public mockPolicyEngine = address(0x111);
    address public mockPool = address(0x222);
    
    address public owner = address(this);
    address public vetoCouncil = address(0x333);
    address public payoutExecutor = address(0x444);
    address public policyHolder = address(0x555);
    address public whaleVoter = address(0x666);
    address public smallVoter = address(0x777);
    address public hacker = address(0x999);

    uint256 public constant MIN_VOTING_PERIOD = 3 days;
    uint256 public constant STANDARD_VOTING_PERIOD = 7 days;

    string public validEvidence = "ipfs://QmValidHashOfEvidenceData";

    function setUp() public {
        // 1. Deploy Real Shield Token (needed for accurate snapshot math)
        shield = new ShieldToken();
        
        // 2. Deploy Governor
        governor = new ClaimsGovernor(
            address(shield),
            mockPolicyEngine,
            mockPool,
            STANDARD_VOTING_PERIOD
        );

        // 3. Configure Roles
        governor.setVetoCouncil(vetoCouncil);
        governor.setPayoutExecutor(payoutExecutor);

        // 4. Setup Voting Power
        shield.mint(whaleVoter, 60_000e18); // 60% of current supply
        shield.mint(smallVoter, 40_000e18); // 40% of current supply
        
        vm.prank(whaleVoter);
        shield.delegate(whaleVoter);
        
        vm.prank(smallVoter);
        shield.delegate(smallVoter);

        // Advance blocks to ensure getPastVotes snapshot is valid and established
        vm.roll(block.number + 10);
        // Advance time to ensure we're past any potential timelocks or initial periods
        vm.warp(365 days);

        // 5. Setup PolicyEngine Mock (Happy Path Baseline)
        _mockPolicy(1, policyHolder, IPolicyEngine.PolicyStatus.ACTIVE, block.timestamp + 30 days);
    }

    // --------------------------------------------------------
    //  Initialization & Access Control
    // --------------------------------------------------------

    function test_RevertIf_ZeroAddressesInConstructor() public {
        vm.expectRevert(ClaimsGovernor.ClaimsGovernor__ZeroAddress.selector);
        new ClaimsGovernor(address(0), mockPolicyEngine, mockPool, STANDARD_VOTING_PERIOD);
    }

    function test_RevertIf_InvalidVotingPeriod() public {
        vm.expectRevert(ClaimsGovernor.ClaimsGovernor__VotingPeriodInvalid.selector);
        new ClaimsGovernor(address(shield), mockPolicyEngine, mockPool, 1 days); // Below minimum
    }

    function test_RevertIf_SetRolesTwice() public {
        vm.expectRevert(ClaimsGovernor.ClaimsGovernor__VetoCouncilAlreadySet.selector);
        governor.setVetoCouncil(address(0xABC));

        vm.expectRevert(ClaimsGovernor.ClaimsGovernor__ExecutorAlreadySet.selector);
        governor.setPayoutExecutor(address(0xDEF));
    }

    function test_RevertIf_UnauthorizedExecutors() public {
        _fileStandardClaim(); 

        vm.startPrank(hacker);
        
        vm.expectRevert(abi.encodeWithSelector(IClaimsGovernor.IClaimsGovernor__NotVetoCouncil.selector, hacker));
        governor.vetoClaim(1, "Fake Veto");

        vm.expectRevert(abi.encodeWithSelector(ClaimsGovernor.ClaimsGovernor__OnlyPayoutExecutor.selector, hacker));
        governor.markExecuted(1);
        
        vm.stopPrank();
    }

    // --------------------------------------------------------
    //  File Claim Validations
    // --------------------------------------------------------

    function test_RevertIf_EvidenceTooShort() public {
        vm.prank(policyHolder);
        vm.expectRevert(abi.encodeWithSelector(ClaimValidator.ClaimValidator__EvidenceTooShort.selector, 3, 10));
        governor.fileClaim(1, "abc"); // Too short
    }

    function test_RevertIf_NotPolicyHolderFiles() public {
        vm.prank(hacker);
        vm.expectRevert(abi.encodeWithSelector(ClaimValidator.ClaimValidator__ClaimantNotHolder.selector, hacker, policyHolder));
        governor.fileClaim(1, validEvidence);
    }

    function test_RevertIf_PolicyExpiredOrInactive() public {
        // Mock an expired policy
        _mockPolicy(2, policyHolder, IPolicyEngine.PolicyStatus.ACTIVE, block.timestamp - 1 days);
        
        vm.prank(policyHolder);
        vm.expectRevert(ClaimValidator.ClaimValidator__PolicyExpired.selector);
        governor.fileClaim(2, validEvidence);

        // Mock a cancelled policy
        _mockPolicy(3, policyHolder, IPolicyEngine.PolicyStatus.CANCELLED, block.timestamp + 10 days);
        
        vm.prank(policyHolder);
        vm.expectRevert(ClaimValidator.ClaimValidator__PolicyNotActive.selector);
        governor.fileClaim(3, validEvidence);
    }

    function test_FileClaim_SuccessAndStateUpdates() public {
        vm.prank(policyHolder);
        uint256 claimId = governor.fileClaim(1, validEvidence);

        assertEq(claimId, 1);
        assertEq(governor.totalClaims(), 1);
        assertEq(governor.claimForPolicy(1), 1);

        IClaimsGovernor.Claim memory c = governor.getClaim(1);
        assertEq(c.claimant, policyHolder);
        assertEq(c.policyId, 1);
        assertEq(c.snapshotBlock, block.number - 1);
        assertEq(uint(c.status), uint(IClaimsGovernor.ClaimStatus.PENDING));
        assertEq(c.votingEndsAt, block.timestamp + STANDARD_VOTING_PERIOD);

        // Cannot file twice
        vm.prank(policyHolder);
        vm.expectRevert(abi.encodeWithSelector(IClaimsGovernor.IClaimsGovernor__ClaimAlreadyExists.selector, 1));
        governor.fileClaim(1, validEvidence);
    }

    // --------------------------------------------------------
    //  Voting Mechanics (The Heart of Governance)
    // --------------------------------------------------------

    function test_RevertIf_VoteWithNoPower() public {
        _fileStandardClaim();

        vm.prank(hacker);
        vm.expectRevert(abi.encodeWithSelector(IClaimsGovernor.IClaimsGovernor__NoVotingPower.selector, hacker));
        governor.castVote(1, true);
    }

    function test_RevertIf_VoteAfterDeadline() public {
        _fileStandardClaim();
        
        vm.warp(block.timestamp + STANDARD_VOTING_PERIOD + 1);

        vm.prank(whaleVoter);
        vm.expectRevert(abi.encodeWithSelector(IClaimsGovernor.IClaimsGovernor__VotingWindowClosed.selector, 1));
        governor.castVote(1, true);
    }

    function test_CastVote_DoubleVoteBlocked() public {
        _fileStandardClaim();

        vm.startPrank(whaleVoter);
        governor.castVote(1, true); 
        
        assertTrue(governor.hasVoted(1, whaleVoter));

        vm.expectRevert(abi.encodeWithSelector(IClaimsGovernor.IClaimsGovernor__AlreadyVoted.selector, 1, whaleVoter));
        governor.castVote(1, true); 
        vm.stopPrank();
    }

    // --------------------------------------------------------
    //  Claim Finalization (Quorum & Math)
    // --------------------------------------------------------

    function test_RevertIf_FinalizeBeforeDeadline() public {
        _fileStandardClaim();

        vm.expectRevert(abi.encodeWithSelector(IClaimsGovernor.IClaimsGovernor__CannotFinalize.selector, 1));
        governor.finalizeClaim(1);
    }

    function test_FinalizeClaim_ApprovedMajority() public {
        _fileStandardClaim();

        vm.prank(whaleVoter);
        governor.castVote(1, true);

        vm.prank(smallVoter);
        governor.castVote(1, false);

        vm.warp(block.timestamp + STANDARD_VOTING_PERIOD + 1);

        vm.mockCall(mockPolicyEngine, abi.encodeWithSelector(IPolicyEngine.markClaimed.selector, 1), abi.encode());

        governor.finalizeClaim(1);

        IClaimsGovernor.Claim memory c = governor.getClaim(1);
        assertEq(uint(c.status), uint(IClaimsGovernor.ClaimStatus.APPROVED));
    }

    function test_FinalizeClaim_RejectedDueToNoVotes() public {
        _fileStandardClaim();

        // Whale votes NO (60%)
        vm.prank(whaleVoter);
        governor.castVote(1, false);

        vm.warp(block.timestamp + STANDARD_VOTING_PERIOD + 1);

        vm.mockCall(mockPool, abi.encodeWithSelector(ICoveragePool.releaseCoverage.selector, 1), abi.encode());

        governor.finalizeClaim(1);

        IClaimsGovernor.Claim memory c = governor.getClaim(1);
        assertEq(uint(c.status), uint(IClaimsGovernor.ClaimStatus.REJECTED));
    }

    function test_FinalizeClaim_RejectedDueToLowQuorum() public {
        _fileStandardClaim();

        // NO ONE VOTES (0 yes, 0 no). Should fail Quorum check.
        vm.warp(block.timestamp + STANDARD_VOTING_PERIOD + 1);
        
        vm.mockCall(mockPool, abi.encodeWithSelector(ICoveragePool.releaseCoverage.selector, 1), abi.encode());
        governor.finalizeClaim(1);

        IClaimsGovernor.Claim memory c = governor.getClaim(1);
        assertEq(uint(c.status), uint(IClaimsGovernor.ClaimStatus.REJECTED));
    }

    // --------------------------------------------------------
    //  Emergency Controls & Failsafes (Extra Coverage)
    // --------------------------------------------------------

    function test_VetoClaim_Success() public {
        _fileStandardClaim();

        // Veto Council steps in before voting ends
        vm.mockCall(mockPool, abi.encodeWithSelector(ICoveragePool.releaseCoverage.selector, 1), abi.encode());
        
        vm.prank(vetoCouncil);
        governor.vetoClaim(1, "Spam Claim Detected");

        IClaimsGovernor.Claim memory c = governor.getClaim(1);
        assertEq(uint(c.status), uint(IClaimsGovernor.ClaimStatus.VETOED));

        // Now finalize should revert because it's no longer PENDING
        vm.warp(block.timestamp + STANDARD_VOTING_PERIOD + 1);
        vm.expectRevert(abi.encodeWithSelector(IClaimsGovernor.IClaimsGovernor__CannotFinalize.selector, 1));
        governor.finalizeClaim(1);
    }

    function test_RevertIf_VetoNonPendingClaim() public {
        _fileStandardClaim();
        
        // Fast forward and reject it legitimately first
        vm.warp(block.timestamp + STANDARD_VOTING_PERIOD + 1);
        vm.mockCall(mockPool, abi.encodeWithSelector(ICoveragePool.releaseCoverage.selector, 1), abi.encode());
        governor.finalizeClaim(1);

        // Council tries to veto an already processed claim
        vm.prank(vetoCouncil);
        vm.expectRevert(abi.encodeWithSelector(IClaimsGovernor.IClaimsGovernor__CannotVeto.selector, 1));
        governor.vetoClaim(1, "Too late");
    }

    function test_PauseBlocksCriticalFunctions() public {
        governor.pause();

        vm.prank(policyHolder);
        vm.expectRevert(Pausable.EnforcedPause.selector);
        governor.fileClaim(1, validEvidence);

        governor.unpause(); // Admin resumes
        
        vm.prank(policyHolder);
        governor.fileClaim(1, validEvidence); // Succeeds
    }

    function test_MarkExecuted_SuccessAndReverts() public {
        _fileStandardClaim();
        
        // Try executing before it's approved
        vm.prank(payoutExecutor);
        vm.expectRevert(abi.encodeWithSelector(IClaimsGovernor.IClaimsGovernor__CannotFinalize.selector, 1));
        governor.markExecuted(1);

        // Force Approve the claim
        vm.prank(whaleVoter);
        governor.castVote(1, true);
        vm.warp(block.timestamp + STANDARD_VOTING_PERIOD + 1);
        vm.mockCall(mockPolicyEngine, abi.encodeWithSelector(IPolicyEngine.markClaimed.selector, 1), abi.encode());
        governor.finalizeClaim(1);

        // Executor marks it Executed
        vm.prank(payoutExecutor);
        governor.markExecuted(1);

        assertEq(uint(governor.getClaim(1).status), uint(IClaimsGovernor.ClaimStatus.EXECUTED));
    }

    function test_SetVotingPeriod_SuccessAndReverts() public {
        vm.expectRevert(ClaimsGovernor.ClaimsGovernor__VotingPeriodInvalid.selector);
        governor.setVotingPeriod(2 days); // Below minimum

        vm.expectRevert(ClaimsGovernor.ClaimsGovernor__VotingPeriodInvalid.selector);
        governor.setVotingPeriod(20 days); // Above max

        governor.setVotingPeriod(10 days);
        assertEq(governor.s_votingPeriod(), 10 days);
    }

    // --------------------------------------------------------
    //  Internal Helpers
    // --------------------------------------------------------

    function _fileStandardClaim() internal {
        vm.roll(block.number + 5);
        
        vm.prank(policyHolder);
        governor.fileClaim(1, validEvidence);
    }

    function _mockPolicy(uint256 id, address holder, IPolicyEngine.PolicyStatus status, uint256 expiresAt) internal {
        IPolicyEngine.Policy memory p = IPolicyEngine.Policy({
            holder: holder,
            protocol: address(0xABCD),
            coverageAmount: 1000e6,
            premium: 10e6,
            issuedAt: block.timestamp,
            expiresAt: expiresAt,
            status: status
        });

        vm.mockCall(
            mockPolicyEngine,
            abi.encodeWithSelector(IPolicyEngine.getPolicy.selector, id),
            abi.encode(p)
        );
    }
}