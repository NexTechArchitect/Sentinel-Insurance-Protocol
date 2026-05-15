// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {CoveragePool} from "../../src/core/CoveragePool.sol";
import {PolicyEngine} from "../../src/core/PolicyEngine.sol";
import {RiskRegistry} from "../../src/registry/RiskRegistry.sol";
import {ClaimsGovernor} from "../../src/core/ClaimsGovernor.sol";
import {PayoutExecutor} from "../../src/core/PayoutExecutor.sol";
import {ShieldToken} from "../../src/governance/ShieldToken.sol";
import {PolicyNFT} from "../../src/token/PolicyNFT.sol";
import {VetoCouncil} from "../../src/governance/VetoCouncil.sol";

import {MockUSDC} from "../mocks/MockUSDC.sol";
import {MockAavePool} from "../mocks/MockAavePool.sol";
import {MockAToken} from "../mocks/MockAToken.sol";

import {IClaimsGovernor} from "../../src/interfaces/IClaimsGovernor.sol";
import {IPolicyEngine} from "../../src/interfaces/IPolicyEngine.sol";

contract FullProtocolFlowTest is Test {
    CoveragePool public pool;
    PolicyEngine public engine;
    RiskRegistry public registry;
    ClaimsGovernor public governor;
    PayoutExecutor public executor;
    ShieldToken public shield;
    PolicyNFT public nft;
    VetoCouncil public vetoCouncil;

    MockUSDC public usdc;
    MockAavePool public aave;
    MockAToken public aToken;

    address public DEPLOYER = address(0x10);
    address public LP_WHALE_1 = address(0x11);
    address public LP_WHALE_2 = address(0x12);
    address public USER_ALICE = address(0x21); 
    address public HACKER_BOB = address(0x22); 
    address public DUST_ATTACKER = address(0x23);
    address public DAO_VOTER_1 = address(0x31);
    address public DAO_VOTER_2 = address(0x32);
    address public LATE_VOTER = address(0x33); 
    address public GUARDIAN_1 = address(0x41);
    address public GUARDIAN_2 = address(0x42);
    address public GUARDIAN_3 = address(0x43);
    address public TARGET_PROTOCOL = address(0x999);

    uint256 constant INITIAL_LP_FUNDS = 500_000e6;
    uint256 constant USER_FUNDS = 1_000_000e6;

    function setUp() public {
        vm.startPrank(DEPLOYER);

        usdc = new MockUSDC();
        aToken = new MockAToken();
        aave = new MockAavePool(address(usdc), address(aToken));
        aToken.setPool(address(aave));

        registry = new RiskRegistry();
        shield = new ShieldToken();
        nft = new PolicyNFT();
        pool = new CoveragePool(address(usdc), address(aave), address(aToken));
        engine = new PolicyEngine(address(usdc), address(registry), address(pool), address(nft));
        governor = new ClaimsGovernor(address(shield), address(engine), address(pool), 7 days);
        executor = new PayoutExecutor(address(governor), address(engine), address(pool));

        address[] memory guardians = new address[](3);
        guardians[0] = GUARDIAN_1;
        guardians[1] = GUARDIAN_2;
        guardians[2] = GUARDIAN_3;
        vetoCouncil = new VetoCouncil(address(governor), guardians, 2);

        nft.setPolicyEngine(address(engine));
        pool.setPolicyEngine(address(engine));
        pool.setPayoutExecutor(address(executor));
        engine.setClaimsGovernor(address(governor));
        governor.setVetoCouncil(address(vetoCouncil)); 
        governor.setPayoutExecutor(address(executor));

        registry.registerProtocol(TARGET_PROTOCOL, "DeFi Protocol X", 50, true, 10_000_000e6);
        shield.mint(DAO_VOTER_1, 6_000_000e18); 
        shield.mint(DAO_VOTER_2, 4_000_000e18); 
        vm.stopPrank();

        usdc.mint(LP_WHALE_1, INITIAL_LP_FUNDS * 10);
        usdc.mint(LP_WHALE_2, INITIAL_LP_FUNDS * 10);
        usdc.mint(USER_ALICE, USER_FUNDS);
        usdc.mint(HACKER_BOB, USER_FUNDS);
        usdc.mint(DUST_ATTACKER, USER_FUNDS);
        
        vm.prank(DAO_VOTER_1);
        shield.delegate(DAO_VOTER_1);
        vm.prank(DAO_VOTER_2);
        shield.delegate(DAO_VOTER_2);
        
        vm.roll(block.number + 10);
        vm.warp(block.timestamp + 100);
    }

    function _setupBasicLiquidityAndPolicy(address user, uint256 coverage) internal {
        vm.startPrank(LP_WHALE_1);
        usdc.approve(address(pool), INITIAL_LP_FUNDS);
        pool.deposit(INITIAL_LP_FUNDS);
        vm.stopPrank();

        uint256 premium = engine.quotePremium(TARGET_PROTOCOL, coverage, 30 days);
        
        vm.startPrank(user);
        usdc.approve(address(engine), premium);
        engine.buyPolicy(TARGET_PROTOCOL, coverage, 30 days);
        vm.stopPrank();
    }

    // --- PHASE 1 TESTS ---

    function test_Chaos_LiquidityCrunch_And_BankRun() public {
        vm.startPrank(LP_WHALE_1);
        usdc.approve(address(pool), INITIAL_LP_FUNDS);
        pool.deposit(INITIAL_LP_FUNDS);
        vm.stopPrank();

        vm.startPrank(LP_WHALE_2);
        usdc.approve(address(pool), INITIAL_LP_FUNDS);
        pool.deposit(INITIAL_LP_FUNDS);
        vm.stopPrank();

        uint256 massiveCoverage = 1_000_000e6;
        uint256 duration = 90 days;
        uint256 premium = engine.quotePremium(TARGET_PROTOCOL, massiveCoverage, duration);
        
        vm.startPrank(USER_ALICE);
        usdc.mint(USER_ALICE, premium); 
        usdc.approve(address(engine), premium);
        engine.buyPolicy(TARGET_PROTOCOL, massiveCoverage, duration);
        vm.stopPrank();

        vm.startPrank(LP_WHALE_1);
        uint256 whale1Shares = pool.balanceOf(LP_WHALE_1);
        vm.expectRevert(); 
        pool.withdraw(whale1Shares);

        uint256 sharesToRedeem = pool.maxRedeem(LP_WHALE_1);
        pool.withdraw(sharesToRedeem);
        vm.stopPrank();

        assertEq(pool.totalLockedLiquidity(), massiveCoverage);
    }

    function test_Chaos_VetoCrisis_ReleasesLocks() public {
        _setupBasicLiquidityAndPolicy(USER_ALICE, 500_000e6); 
        uint256 policyId = 0; 

        vm.roll(block.number + 10);
        vm.prank(USER_ALICE);
        uint256 claimId = governor.fileClaim(policyId, "ipfs://fake-hack");

        vm.prank(DAO_VOTER_1);
        governor.castVote(claimId, true);

        vm.prank(GUARDIAN_1);
        vetoCouncil.signVeto(claimId, "Fraudulent evidence detected.");

        vm.prank(GUARDIAN_2);
        vetoCouncil.signVeto(claimId, "Confirmed fraud.");

        IClaimsGovernor.Claim memory c = governor.getClaim(claimId);
        assertTrue(c.status == IClaimsGovernor.ClaimStatus.VETOED);

        vm.warp(block.timestamp + 35 days);
        engine.expirePolicy(policyId);

        assertEq(pool.totalLockedLiquidity(), 0);
    }

    function test_Security_GovernanceFlashloanAttack() public {
        _setupBasicLiquidityAndPolicy(USER_ALICE, 100_000e6);
        uint256 policyId = 0;
        vm.roll(block.number + 50); 

        vm.prank(USER_ALICE);
        uint256 claimId = governor.fileClaim(policyId, "ipfs://hack");

        vm.startPrank(DEPLOYER);
        shield.mint(LATE_VOTER, 50_000_000e18); 
        vm.stopPrank();

        vm.prank(LATE_VOTER);
        shield.delegate(LATE_VOTER);
        
        vm.roll(block.number + 1); 

        vm.startPrank(LATE_VOTER);
        vm.expectRevert(); 
        governor.castVote(claimId, true);
        vm.stopPrank();
    }

    function test_Chaos_MultiPolicy_And_ExploitPrevention() public {
        vm.prank(LP_WHALE_1);
        usdc.approve(address(pool), INITIAL_LP_FUNDS);
        vm.prank(LP_WHALE_1);
        pool.deposit(INITIAL_LP_FUNDS);

        vm.startPrank(USER_ALICE);
        usdc.approve(address(engine), type(uint256).max);
        uint256 p1 = engine.buyPolicy(TARGET_PROTOCOL, 50_000e6, 30 days);
        vm.stopPrank();

        vm.startPrank(HACKER_BOB);
        usdc.approve(address(engine), type(uint256).max);
        uint256 p2 = engine.buyPolicy(TARGET_PROTOCOL, 150_000e6, 60 days);
        vm.stopPrank();

        vm.warp(block.timestamp + 35 days);
        vm.roll(block.number + 100);

        engine.expirePolicy(p1); 

        vm.prank(HACKER_BOB);
        uint256 claimId = governor.fileClaim(p2, "ipfs://bob-hack");

        vm.startPrank(HACKER_BOB);
        vm.expectRevert(abi.encodeWithSelector(IPolicyEngine.IPolicyEngine__ActiveClaimExists.selector, p2, claimId));
        engine.cancelPolicy(p2); 
        vm.stopPrank();

        vm.prank(DAO_VOTER_1); governor.castVote(claimId, true);
        vm.warp(block.timestamp + 8 days);
        governor.finalizeClaim(claimId);
        executor.executePayout(claimId);

        assertEq(pool.totalLockedLiquidity(), 0);
    }

    function test_Security_CircuitBreakers() public {
        _setupBasicLiquidityAndPolicy(USER_ALICE, 100_000e6);

        vm.startPrank(DEPLOYER);
        engine.pause();
        pool.pause();
        governor.pause();
        registry.pause();
        vm.stopPrank();

        vm.startPrank(USER_ALICE);
        vm.expectRevert(); 
        engine.cancelPolicy(0);
        vm.expectRevert();
        pool.withdraw(100e18);
        vm.stopPrank();
    }

    // --- PHASE 2 & 3 TESTS (DEEP EVM) ---

    function test_Security_SameBlockFlashMintAndClaim() public {
        _setupBasicLiquidityAndPolicy(HACKER_BOB, 100_000e6);
        uint256 policyId = 0;

        vm.startPrank(DEPLOYER);
        shield.mint(HACKER_BOB, 10_000_000e18); 
        vm.stopPrank();

        vm.startPrank(HACKER_BOB);
        shield.delegate(HACKER_BOB); 
        uint256 claimId = governor.fileClaim(policyId, "ipfs://flashloan-attack"); 
        vm.expectRevert();
        governor.castVote(claimId, true);
        vm.stopPrank();
    }

    function test_Chaos_AaveYieldAccrualAndDustMath() public {
        _setupBasicLiquidityAndPolicy(USER_ALICE, 200_000e6);
        uint256 lpShares = pool.balanceOf(LP_WHALE_1);
        
        vm.warp(block.timestamp + 31 days);
        uint256 simulatedYield = 50_000e6;
        
        vm.prank(address(aave));
        aToken.mint(address(pool), simulatedYield); 
        usdc.mint(address(aave), simulatedYield); 

        engine.expirePolicy(0); 

        vm.startPrank(LP_WHALE_1);
        uint256 balanceBefore = usdc.balanceOf(LP_WHALE_1);
        pool.withdraw(lpShares);
        uint256 balanceAfter = usdc.balanceOf(LP_WHALE_1);
        vm.stopPrank();

        uint256 totalPulled = balanceAfter - balanceBefore;
        assertTrue(totalPulled > INITIAL_LP_FUNDS + simulatedYield);
    }

    function test_Security_SybilDustPolicyAttack() public {
        vm.startPrank(LP_WHALE_1);
        usdc.approve(address(pool), INITIAL_LP_FUNDS);
        pool.deposit(INITIAL_LP_FUNDS);
        vm.stopPrank();

        uint256 dustCoverage = 1e6;
        uint256 duration = 30 days;
        
        vm.startPrank(DUST_ATTACKER);
        vm.expectRevert(abi.encodeWithSelector(PolicyEngine.PolicyEngine__CoverageBelowMinimum.selector, dustCoverage, 100e6));
        engine.buyPolicy(TARGET_PROTOCOL, dustCoverage, duration);
        vm.stopPrank();

        uint256 premium = engine.quotePremium(TARGET_PROTOCOL, 100e6, duration);
        assertEq(premium, 1e6);
    }

    function test_Security_CoverageCapEnforcement() public {
        uint256 massiveLiq = 15_000_000e6; 
        usdc.mint(LP_WHALE_1, massiveLiq);
        vm.startPrank(LP_WHALE_1);
        usdc.approve(address(pool), massiveLiq);
        pool.deposit(massiveLiq);
        vm.stopPrank();

        uint256 maxPolicyCap = 1_000_000e6;
        uint256 premium = engine.quotePremium(TARGET_PROTOCOL, maxPolicyCap, 30 days);
        
        vm.startPrank(USER_ALICE);
        usdc.mint(USER_ALICE, premium * 10);
        usdc.approve(address(engine), premium * 10);
        
        for (uint i = 0; i < 10; i++) {
            engine.buyPolicy(TARGET_PROTOCOL, maxPolicyCap, 30 days);
        }
        vm.stopPrank();

        uint256 tinyExtraCoverage = 100e6;
        uint256 extraPremium = engine.quotePremium(TARGET_PROTOCOL, tinyExtraCoverage, 30 days);
        
        vm.startPrank(HACKER_BOB);
        usdc.mint(HACKER_BOB, extraPremium);
        usdc.approve(address(engine), extraPremium);
        
        vm.expectRevert(abi.encodeWithSelector(IPolicyEngine.IPolicyEngine__ProtocolCapExceeded.selector, TARGET_PROTOCOL));
        engine.buyPolicy(TARGET_PROTOCOL, tinyExtraCoverage, 30 days);
        vm.stopPrank();
    }

    function test_Security_ERC4626InflationAttack() public {
        vm.startPrank(HACKER_BOB);
        usdc.approve(address(pool), 1e6);
        pool.deposit(1e6);
        vm.stopPrank();

        vm.prank(address(aave));
        aToken.mint(address(pool), 1_000_000e6);
        usdc.mint(address(aave), 1_000_000e6);

        usdc.mint(USER_ALICE, 2_000_000e6);
        vm.startPrank(USER_ALICE);
        usdc.approve(address(pool), 2_000_000e6);
        pool.deposit(2_000_000e6);
        vm.stopPrank();

        vm.startPrank(USER_ALICE);
        uint256 aliceShares = pool.balanceOf(USER_ALICE);
        pool.withdraw(aliceShares);
        uint256 aliceFinalBalance = usdc.balanceOf(USER_ALICE);
        vm.stopPrank();

        assertTrue(aliceFinalBalance > 1_999_999e6);
    }

    function test_Security_SoulboundTransferBypass() public {
        _setupBasicLiquidityAndPolicy(HACKER_BOB, 50_000e6);
        uint256 policyId = 0;

        vm.startPrank(HACKER_BOB);
        nft.approve(DUST_ATTACKER, policyId);
        vm.stopPrank();

        vm.startPrank(DUST_ATTACKER);
        vm.expectRevert(abi.encodeWithSelector(PolicyNFT.PolicyNFT__Soulbound.selector));
        nft.transferFrom(HACKER_BOB, DUST_ATTACKER, policyId);
        vm.stopPrank();
    }

    function test_Chaos_AaveNegativeYieldDoS() public {
        _setupBasicLiquidityAndPolicy(USER_ALICE, 500_000e6);

        vm.prank(address(aave));
        aToken.burn(address(pool), 100_000e6);

        vm.startPrank(HACKER_BOB);
        usdc.approve(address(engine), type(uint256).max);
        vm.expectRevert(); 
        engine.buyPolicy(TARGET_PROTOCOL, 10_000e6, 30 days);
        vm.stopPrank();
    }

    function test_Security_FrontrunPremiumSlippage() public {
        vm.prank(LP_WHALE_1);
        usdc.approve(address(pool), INITIAL_LP_FUNDS);
        vm.prank(LP_WHALE_1);
        pool.deposit(INITIAL_LP_FUNDS);

        uint256 quotedPremium = engine.quotePremium(TARGET_PROTOCOL, 100_000e6, 30 days);

        vm.startPrank(USER_ALICE);
        usdc.approve(address(engine), type(uint256).max);
        vm.stopPrank();

        vm.startPrank(DEPLOYER);
        registry.updateRiskScore(TARGET_PROTOCOL, 100);
        vm.stopPrank();

        vm.startPrank(USER_ALICE);
        uint256 balBefore = usdc.balanceOf(USER_ALICE);
        engine.buyPolicy(TARGET_PROTOCOL, 100_000e6, 30 days);
        uint256 balAfter = usdc.balanceOf(USER_ALICE);
        vm.stopPrank();

        uint256 actualPaid = balBefore - balAfter;
        assertTrue(actualPaid > quotedPremium);
    }
}