// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test}       from "forge-std/Test.sol";
import {CoveragePool}        from "../../../src/core/CoveragePool.sol";
import {PolicyEngine}        from "../../../src/core/PolicyEngine.sol";
import {RiskRegistry}        from "../../../src/registry/RiskRegistry.sol";
import {ClaimsGovernor}      from "../../../src/core/ClaimsGovernor.sol";
import {PayoutExecutor}      from "../../../src/core/PayoutExecutor.sol";
import {ShieldToken}         from "../../../src/governance/ShieldToken.sol";
import {IPolicyEngine}       from "../../../src/interfaces/IPolicyEngine.sol";
import {IClaimsGovernor}     from "../../../src/interfaces/IClaimsGovernor.sol";
import {MockUSDC}            from "../../mocks/MockUSDC.sol";

contract ProtocolHandler is Test {

    // -------------------------------------------------------
    //  Protocol Contracts
    // -------------------------------------------------------

    CoveragePool    public pool;
    PolicyEngine    public engine;
    RiskRegistry    public registry;
    ClaimsGovernor  public governor;
    PayoutExecutor  public executor;
    ShieldToken     public shield;
    MockUSDC        public usdc;

    // -------------------------------------------------------
    //  Test Actors
    // -------------------------------------------------------

    address[] public users;
    address   public currentActor;
    address   public protocolTarget = address(0xAAAA);

    // -------------------------------------------------------
    //  Ghost Variables — track expected state
    // -------------------------------------------------------

    uint256 public ghost_totalLockedCoverage;
    uint256 public ghost_totalLiquidityDeposited;
    uint256 public ghost_totalPremiumsPaid;
    uint256 public ghost_activePolicies;
    uint256 public ghost_totalPayoutsExecuted;

    // Track withdraw revert reasons
    uint256 public ghost_withdrawRevertedDueToLock;
    uint256 public ghost_withdrawRevertedDueToNoShares;

    // -------------------------------------------------------
    //  Active Policy Tracking
    // -------------------------------------------------------

    uint256[] public activePolicyIds;
    uint256[] public approvedClaimIds;

    // -------------------------------------------------------
    //  Constructor
    // -------------------------------------------------------

    address public testOwner;

    constructor(
        CoveragePool   _pool,
        PolicyEngine   _engine,
        RiskRegistry   _registry,
        ClaimsGovernor _governor,
        PayoutExecutor _executor,
        ShieldToken    _shield,
        MockUSDC       _usdc
    ) {
        pool      = _pool;
        engine    = _engine;
        registry  = _registry;
        governor  = _governor;
        executor  = _executor;
        shield    = _shield;
        usdc      = _usdc;
        testOwner = msg.sender; 

        users.push(address(0x111));
        users.push(address(0x222));
        users.push(address(0x333));
        users.push(address(0x444));
        users.push(address(0x555));
    }

    // -------------------------------------------------------
    //  Actions
    // -------------------------------------------------------

    function depositLiquidity(uint256 actorIndex, uint256 amount) public {
        currentActor = _getActor(actorIndex);
        amount       = bound(amount, 100e6, 1_000_000e6);

        usdc.mint(currentActor, amount);

        vm.startPrank(currentActor);
        usdc.approve(address(pool), amount);
        pool.deposit(amount);
        vm.stopPrank();

        ghost_totalLiquidityDeposited += amount;
    }

    function withdrawLiquidity(uint256 actorIndex, uint256 shareAmount) public {
        currentActor = _getActor(actorIndex);
        uint256 userShares    = pool.balanceOf(currentActor);
        uint256 maxRedeemable = pool.maxRedeem(currentActor);

        if (userShares == 0) {
            ghost_withdrawRevertedDueToNoShares++;
            return;
        }
        if (maxRedeemable == 0) {
            ghost_withdrawRevertedDueToLock++;
            return;
        }

        // Ensure shareAmount is within valid range
        shareAmount = bound(shareAmount, 1, maxRedeemable);

        // Verify convertToAssets > 0 — avoid dust withdrawal revert
        uint256 assets = pool.convertToAssets(shareAmount);
        if (assets == 0) return;

        vm.prank(currentActor);
        pool.withdraw(shareAmount);
    }

    function buyInsurancePolicy(
        uint256 actorIndex,
        uint256 coverageAmount,
        uint256 duration
    ) public {
        currentActor   = _getActor(actorIndex);
        coverageAmount = bound(coverageAmount, engine.MIN_COVERAGE(), 50_000e6);
        duration       = bound(duration, 7 days, 365 days);

        uint256 freeLiq = pool.freeLiquidity();
        if (coverageAmount > freeLiq) return;

        uint256 cap     = registry.getCoverageCap(protocolTarget);
        uint256 exposure = engine.getProtocolExposure(protocolTarget);
        if (exposure + coverageAmount > cap) return;

        uint256 premium = engine.quotePremium(protocolTarget, coverageAmount, duration);
        usdc.mint(currentActor, premium);

        vm.startPrank(currentActor);
        usdc.approve(address(engine), premium);
        uint256 policyId = engine.buyPolicy(protocolTarget, coverageAmount, duration);
        vm.stopPrank();

        activePolicyIds.push(policyId);
        ghost_totalLockedCoverage += coverageAmount;
        ghost_totalPremiumsPaid   += premium;
        ghost_activePolicies++;
    }

    function warpTime(uint256 secondsToWarp) public {
        secondsToWarp = bound(secondsToWarp, 1 hours, 30 days);
        vm.warp(block.timestamp + secondsToWarp);
    }

    function expireRandomPolicy(uint256 policySeed) public {
        if (activePolicyIds.length == 0) return;

        uint256 index    = policySeed % activePolicyIds.length;
        uint256 policyId = activePolicyIds[index];

        IPolicyEngine.Policy memory p = engine.getPolicy(policyId);
        if (p.status != IPolicyEngine.PolicyStatus.ACTIVE) return;
        if (block.timestamp <= p.expiresAt) return;

        // Check no pending claim — race condition guard
        uint256 claimId = governor.claimForPolicy(policyId);
        if (claimId != 0) {
            IClaimsGovernor.Claim memory c = governor.getClaim(claimId);
            if (c.status == IClaimsGovernor.ClaimStatus.PENDING) return;
        }

        engine.expirePolicy(policyId);

        ghost_totalLockedCoverage -= p.coverageAmount;
        ghost_activePolicies--;
        _removePolicy(index);
    }

    function cancelRandomPolicy(uint256 policySeed) public {
        if (activePolicyIds.length == 0) return;

        uint256 index    = policySeed % activePolicyIds.length;
        uint256 policyId = activePolicyIds[index];

        IPolicyEngine.Policy memory p = engine.getPolicy(policyId);
        if (p.status != IPolicyEngine.PolicyStatus.ACTIVE) return;
        if (block.timestamp > p.expiresAt) return;

        vm.prank(p.holder);
        engine.cancelPolicy(policyId);

        ghost_totalLockedCoverage -= p.coverageAmount;
        ghost_activePolicies--;
        _removePolicy(index);
    }

    function fileAndVoteOnClaim(uint256 policySeed) public {
        if (activePolicyIds.length == 0) return;

        uint256 index    = policySeed % activePolicyIds.length;
        uint256 policyId = activePolicyIds[index];

        IPolicyEngine.Policy memory p = engine.getPolicy(policyId);
        if (p.status != IPolicyEngine.PolicyStatus.ACTIVE) return;
        if (block.timestamp >= p.expiresAt) return;
        if (governor.claimForPolicy(policyId) != 0) return;

        address voter = address(0x999);
        uint256 voteWeight = shield.MAX_SUPPLY() / 10;

        vm.prank(testOwner);
        shield.mint(voter, voteWeight);

        vm.prank(voter);
        shield.delegate(voter);

        // Roll forward so delegation is in past block history
        vm.roll(block.number + 2);

        // NOW file claim — snapshotBlock = block.number - 1
        // voter's tokens exist at that block
        vm.prank(p.holder);
        uint256 claimId = governor.fileClaim(policyId, "ipfs://QmFakeExploitEvidence");

        // Vote YES — getPastVotes(voter, snapshotBlock) will return voteWeight
        vm.prank(voter);
        governor.castVote(claimId, true);

        // Warp past voting period
        vm.warp(block.timestamp + 7 days + 1);

        // Finalize
        governor.finalizeClaim(claimId);

        IClaimsGovernor.Claim memory c = governor.getClaim(claimId);
        if (c.status == IClaimsGovernor.ClaimStatus.APPROVED) {
            approvedClaimIds.push(claimId);
        }
    }

    function executeApprovedPayout(uint256 claimSeed) public {
        if (approvedClaimIds.length == 0) return;

        uint256 index   = claimSeed % approvedClaimIds.length;
        uint256 claimId = approvedClaimIds[index];

        IClaimsGovernor.Claim memory c = governor.getClaim(claimId);
        if (c.status != IClaimsGovernor.ClaimStatus.APPROVED) return;

        IPolicyEngine.Policy memory p = engine.getPolicy(c.policyId);

        executor.executePayout(claimId);

        ghost_totalLockedCoverage   -= p.coverageAmount;
        ghost_totalPayoutsExecuted  += p.coverageAmount;
        ghost_activePolicies--;

        _removeClaimId(index);
    }

    // -------------------------------------------------------
    //  Helpers
    // -------------------------------------------------------

    function _getActor(uint256 actorIndex) internal view returns (address) {
        return users[actorIndex % users.length];
    }

    function _removePolicy(uint256 index) internal {
        activePolicyIds[index] = activePolicyIds[activePolicyIds.length - 1];
        activePolicyIds.pop();
    }

    function _removeClaimId(uint256 index) internal {
        approvedClaimIds[index] = approvedClaimIds[approvedClaimIds.length - 1];
        approvedClaimIds.pop();
    }

    function activePolicyCount() external view returns (uint256) {
        return activePolicyIds.length;
    }
}
