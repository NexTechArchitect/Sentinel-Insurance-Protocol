// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {PolicyEngine} from "../../src/core/PolicyEngine.sol";
import {PolicyNFT} from "../../src/token/PolicyNFT.sol";
import {MockUSDC} from "../mocks/MockUSDC.sol";

contract FuzzEngineTest is Test {
    PolicyEngine public engine;
    PolicyNFT public nft;
    MockUSDC public usdc;

    address public mockRegistry = address(0x111);
    address public mockPool = address(0x222);
    address public targetProtocol = address(0x555);
    address public user = address(0x444);

    function setUp() public {
        usdc = new MockUSDC();
        nft = new PolicyNFT();
        engine = new PolicyEngine(address(usdc), mockRegistry, mockPool, address(nft));
        nft.setPolicyEngine(address(engine));

        // Setup user
        usdc.mint(user, type(uint256).max / 2); // Max possible money
        vm.prank(user);
        usdc.approve(address(engine), type(uint256).max);

        // Standard Mocks
        vm.mockCall(mockRegistry, abi.encodeWithSignature("isEligibleForCoverage(address)", targetProtocol), abi.encode(true));
        vm.mockCall(mockRegistry, abi.encodeWithSignature("getRiskScore(address)", targetProtocol), abi.encode(uint8(50)));
        vm.mockCall(mockRegistry, abi.encodeWithSignature("getProtocolInfo(address)", targetProtocol), abi.encode(50, true, true, 5_000_000e6, block.timestamp));
        vm.mockCall(mockRegistry, abi.encodeWithSignature("getCoverageCap(address)", targetProtocol), abi.encode(type(uint256).max));
        vm.mockCall(mockPool, abi.encodeWithSignature("freeLiquidity()"), abi.encode(type(uint256).max));
        vm.mockCall(mockPool, abi.encodeWithSignature("collectPremium(uint256,uint256)"), abi.encode());
        vm.mockCall(mockPool, abi.encodeWithSignature("lockCoverage(uint256,address,uint256)"), abi.encode());
    }

    function testFuzz_PremiumMathNeverOverflows(uint256 coverageAmount, uint256 duration) public view {
        // Bound inputs to valid protocol limits
        coverageAmount = bound(coverageAmount, 100e6, 1_000_000e6);
        duration = bound(duration, 7 days, 365 days);

        // If math overflows, this line will panic and fail the test
        uint256 premium = engine.quotePremium(targetProtocol, coverageAmount, duration);
        
        // Premium should never be 0 for valid inputs
        assertTrue(premium > 0, "Bug: Premium math returned zero");
    }

    function testFuzz_RevertIf_BuyPolicyInvalidBoundaries(uint256 badCoverage, uint256 badDuration) public {
        // Assume inputs are strictly OUTSIDE valid bounds
        vm.assume(
            badCoverage < 100e6 || 
            badCoverage > 1_000_000e6 || 
            badDuration < 7 days || 
            badDuration > 365 days
        );

        vm.startPrank(user);
        
        // Expect a revert. If it succeeds, the protocol is broken!
        vm.expectRevert(); 
        engine.buyPolicy(targetProtocol, badCoverage, badDuration);
        
        vm.stopPrank();
    }
}
