// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/*
 * @title Protocol Invariants (Stateful Fuzzing)
 * @dev The Ultimate Stress Test for SentinelShield.
 * This contract ensures that no matter what combination of deposits,
 * policy purchases, cancellations, and time-warps occur, the core
 * mathematical truths of the protocol NEVER break.
 */

import {Test, console}   from "forge-std/Test.sol";
import {ProtocolHandler} from "./handlers/ProtocolHandler.t.sol";
import {CoveragePool}    from "../../src/core/CoveragePool.sol";
import {PolicyEngine}    from "../../src/core/PolicyEngine.sol";
import {RiskRegistry}    from "../../src/registry/RiskRegistry.sol";
import {ClaimsGovernor}  from "../../src/core/ClaimsGovernor.sol";
import {PayoutExecutor}  from "../../src/core/PayoutExecutor.sol";
import {ShieldToken}     from "../../src/governance/ShieldToken.sol";
import {PolicyNFT}       from "../../src/token/PolicyNFT.sol";
import {MockUSDC}        from "../mocks/MockUSDC.sol";
import {MockAavePool}    from "../mocks/MockAavePool.sol";
import {MockAToken}      from "../mocks/MockAToken.sol";

// FIX 1: Missing Interfaces Imported Here
import {IClaimsGovernor} from "../../src/interfaces/IClaimsGovernor.sol";
import {IPolicyEngine}   from "../../src/interfaces/IPolicyEngine.sol";

contract InvariantsTest is Test {

    CoveragePool   public pool;
    PolicyEngine   public engine;
    RiskRegistry   public registry;
    ClaimsGovernor public governor;
    PayoutExecutor public executor;
    ShieldToken    public shield;
    PolicyNFT      public nft;

    MockUSDC     public usdc;
    MockAavePool public aave;
    MockAToken   public aToken;

    ProtocolHandler public handler;

    function setUp() public {
        // 1. Mocks
        usdc   = new MockUSDC();
        aToken = new MockAToken();
        aave   = new MockAavePool(address(usdc), address(aToken));
        aToken.setPool(address(aave));

        // 2. Core contracts
        registry = new RiskRegistry();
        shield   = new ShieldToken();
        nft      = new PolicyNFT();
        pool     = new CoveragePool(address(usdc), address(aave), address(aToken));
        engine   = new PolicyEngine(address(usdc), address(registry), address(pool), address(nft));
        governor = new ClaimsGovernor(address(shield), address(engine), address(pool), 7 days);
        executor = new PayoutExecutor(address(governor), address(engine), address(pool));

        // 3. Wire
        nft.setPolicyEngine(address(engine));
        pool.setPolicyEngine(address(engine));
        pool.setPayoutExecutor(address(executor));
        engine.setClaimsGovernor(address(governor));
        governor.setVetoCouncil(makeAddr("vetoCouncil"));
        governor.setPayoutExecutor(address(executor));

        // 4. Register test protocol
        registry.registerProtocol(
            address(0xAAAA),
            "Sentinel Mock Protocol",
            50,
            true,
            type(uint256).max
        );

        // 5. Handler
        handler = new ProtocolHandler(
            pool, engine, registry, governor, executor, shield, usdc
        );

        // FIX: Hand over Shield Token ownership to Handler so it can mint votes during tests
        shield.transferOwnership(address(handler));

        targetContract(address(handler));

        bytes4[] memory selectors = new bytes4[](8);
        selectors[0] = handler.depositLiquidity.selector;
        selectors[1] = handler.withdrawLiquidity.selector;
        selectors[2] = handler.buyInsurancePolicy.selector;
        selectors[3] = handler.warpTime.selector;
        selectors[4] = handler.expireRandomPolicy.selector;
        selectors[5] = handler.cancelRandomPolicy.selector;
        selectors[6] = handler.fileAndVoteOnClaim.selector;
        selectors[7] = handler.executeApprovedPayout.selector;

        targetSelector(FuzzSelector({addr: address(handler), selectors: selectors}));
    }

    // =======================================================
    // INVARIANT 1 - SOLVENCY: locked <= totalAssets always
    // =======================================================
    function invariant_poolMustRemainSolvent() public view {
        assertLe(
            pool.totalLockedLiquidity(),
            pool.totalAssets(),
            "CRITICAL: Protocol Insolvent - locked > assets"
        );
    }

    // =======================================================
    // INVARIANT 2 - GHOST ACCOUNTING: pool locked == handler ghost
    // =======================================================
    function invariant_ghostLockedCoverageMatchesReality() public view {
        assertEq(
            pool.totalLockedLiquidity(),
            handler.ghost_totalLockedCoverage(),
            "ACCOUNTING BUG: Pool locked != ghost tracked locked"
        );
    }

    // =======================================================
    // 🛡️ INVARIANT 3 - ENGINE EXPOSURE + PENDING PAYOUTS == POOL LOCKED
    // =======================================================
    function invariant_engineExposureMatchesPoolLocked() public view {
        address target = handler.protocolTarget();
        uint256 engineExposure = engine.getProtocolExposure(target);
        uint256 poolLocked = pool.totalLockedLiquidity();
        
        uint256 pendingPayouts = 0;
        uint256 i = 0;

        // FIX 2: Dynamic array parsing without crashing the compiler
        while (true) {
            try handler.approvedClaimIds(i) returns (uint256 claimId) {
                IClaimsGovernor.Claim memory c = governor.getClaim(claimId);
                if (c.status == IClaimsGovernor.ClaimStatus.APPROVED) {
                    IPolicyEngine.Policy memory p = engine.getPolicy(c.policyId);
                    pendingPayouts += p.coverageAmount;
                }
                i++;
            } catch {
                break; // Reached the end of the array, exit loop cleanly
            }
        }

        assertEq(
            engineExposure + pendingPayouts, 
            poolLocked, 
            "STATE DESYNC: (Engine exposure + Pending Payouts) != pool locked"
        );
    }

    // =======================================================
    // INVARIANT 4 - FREE LIQUIDITY MATH
    // =======================================================
    function invariant_freeLiquidityCalculationIsCorrect() public view {
        assertEq(
            pool.freeLiquidity(),
            pool.totalAssets() - pool.totalLockedLiquidity(),
            "MATH BUG: freeLiquidity() calculation wrong"
        );
    }

    // =======================================================
    // INVARIANT 5 - ZERO ASSETS = ZERO LOCKS
    // =======================================================
    function invariant_zeroAssetsMeansZeroLocks() public view {
        if (pool.totalAssets() == 0) {
            assertEq(
                pool.totalLockedLiquidity(),
                0,
                "PHANTOM LOCK: Locked exists with zero assets"
            );
        }
    }

    // =======================================================
    // INVARIANT 6 - WITHDRAW REVERTS ARE EXPECTED
    // =======================================================
    function invariant_withdrawRevertsAreDocumented() public view {
        uint256 totalExpectedReverts =
            handler.ghost_withdrawRevertedDueToLock() +
            handler.ghost_withdrawRevertedDueToNoShares();

        console.log("Expected withdraw reverts:", totalExpectedReverts);
        console.log("  Due to lock:", handler.ghost_withdrawRevertedDueToLock());
        console.log("  Due to no shares:", handler.ghost_withdrawRevertedDueToNoShares());
    }

    // =======================================================
    // INVARIANT 7 - COVERAGE NEVER EXCEEDS CAP
    // =======================================================
    function invariant_exposureNeverExceedsCap() public view {
        uint256 cap      = registry.getCoverageCap(handler.protocolTarget());
        uint256 exposure = engine.getProtocolExposure(handler.protocolTarget());

        assertLe(
            exposure,
            cap,
            "CAP VIOLATION: Protocol exposure exceeded coverage cap"
        );
    }

    // =======================================================
    // INVARIANT 8 - PAYOUT TOTAL <= TOTAL PREMIUMS PAID
    // =======================================================
    function invariant_payoutsTrackedCorrectly() public view {
        assertLe(
            handler.ghost_totalPayoutsExecuted(),
            handler.ghost_totalLiquidityDeposited() + handler.ghost_totalPremiumsPaid(),
            "PAYOUT BUG: Total payouts exceed total capital + premiums"
        );
    }
}