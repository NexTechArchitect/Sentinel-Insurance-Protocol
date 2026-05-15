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


contract AuditEdgeCasesTest is Test {
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
    address public USER_ALICE = address(0x21); 
    address public HACKER_BOB = address(0x22); 
    address public DAO_VOTER_1 = address(0x31);
    address public DAO_VOTER_2 = address(0x32);
    address public GUARDIAN_1 = address(0x41);
    address public TARGET_PROTOCOL = address(0x999);

    uint256 constant INITIAL_LP_FUNDS = 500_000e6;

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

        address[] memory guardians = new address[](1);
        guardians[0] = GUARDIAN_1;
        vetoCouncil = new VetoCouncil(address(governor), guardians, 1);

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
        usdc.mint(USER_ALICE, 1_000_000e6);
        usdc.mint(HACKER_BOB, 1_000_000e6);
        
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

    function test_Security_BlacklistLogicAndLegacyClaims() public {
        _setupBasicLiquidityAndPolicy(USER_ALICE, 100_000e6);
        uint256 policyId = 0;

        vm.prank(USER_ALICE);
        uint256 claimId = governor.fileClaim(policyId, "ipfs://legacy-hack");
        assertEq(claimId, 1);

        address UNREGISTERED_PROTOCOL = address(0xDeadBeef);

        vm.startPrank(HACKER_BOB);
        usdc.approve(address(engine), type(uint256).max);
        
        vm.expectRevert(); 
        engine.buyPolicy(UNREGISTERED_PROTOCOL, 50_000e6, 30 days);
        vm.stopPrank();
    }

    function test_Security_FinalizeClaimIdempotency() public {
        _setupBasicLiquidityAndPolicy(USER_ALICE, 100_000e6);
        uint256 policyId = 0;
        
        vm.prank(USER_ALICE);
        uint256 claimId = governor.fileClaim(policyId, "ipfs://evidence");
        
        vm.prank(DAO_VOTER_2); 
        governor.castVote(claimId, false);
        
        vm.warp(block.timestamp + 8 days);
        governor.finalizeClaim(claimId); 
        
        vm.expectRevert(abi.encodeWithSelector(IClaimsGovernor.IClaimsGovernor__CannotFinalize.selector, claimId));
        governor.finalizeClaim(claimId);
    }

    function test_State_NFTMetadataSync() public {
        _setupBasicLiquidityAndPolicy(USER_ALICE, 100_000e6);
        
        string memory initialURI = nft.tokenURI(0);
        
        vm.warp(block.timestamp + 31 days);
        engine.expirePolicy(0);
        
        string memory expiredURI = nft.tokenURI(0);
        
        assertTrue(keccak256(abi.encodePacked(initialURI)) != keccak256(abi.encodePacked(expiredURI)));
    }
}