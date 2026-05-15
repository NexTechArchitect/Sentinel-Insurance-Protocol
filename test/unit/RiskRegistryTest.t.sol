// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/*
 * @title RiskRegistry Unit Tests
 * @dev Rigorous testing focusing on access controls, boundary limits (risk scores), 
 * state isolation (registered vs unregistered), and emergency pausable behaviors.
 */

import {Test} from "forge-std/Test.sol";
import {RiskRegistry} from "../../src/registry/RiskRegistry.sol";
import {IRiskRegistry} from "../../src/interfaces/IRiskRegistry.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";

contract RiskRegistryTest is Test {
    RiskRegistry public registry;

    address public owner = address(this);
    address public hacker = address(0xBADD00D);
    address public mockProtocol = address(0x1234);
    address public mockProtocol2 = address(0x5678);

    event ProtocolRegistered(address indexed protocol, string name, uint8 riskScore, bool audited);
    event RiskScoreUpdated(address indexed protocol, uint8 oldScore, uint8 newScore);
    event AuditStatusUpdated(address indexed protocol, bool audited);
    event ProtocolBlacklisted(address indexed protocol);
    event ProtocolReactivated(address indexed protocol);

    function setUp() public {
        registry = new RiskRegistry();
    }

    // --------------------------------------------------------
    //  Access Control & Pausable Tests
    // --------------------------------------------------------

    function test_RevertIf_NonOwnerTriesToWrite() public {
        vm.startPrank(hacker);
        
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, hacker));
        registry.registerProtocol(mockProtocol, "Hack", 50, true, 1000e6);

        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, hacker));
        registry.updateRiskScore(mockProtocol, 20);

        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, hacker));
        registry.setAuditStatus(mockProtocol, false);

        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, hacker));
        registry.blacklistProtocol(mockProtocol);

        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, hacker));
        registry.pause();

        vm.stopPrank();
    }

    function test_RevertIf_PausedOperations() public {
        registry.pause();

        vm.expectRevert(Pausable.EnforcedPause.selector);
        registry.registerProtocol(mockProtocol, "Test", 50, true, 1000e6);

        vm.expectRevert(Pausable.EnforcedPause.selector);
        registry.updateRiskScore(mockProtocol, 60);

        vm.expectRevert(Pausable.EnforcedPause.selector);
        registry.unblacklistProtocol(mockProtocol);
    }

    function test_BlacklistWorksEvenWhenPaused() public {
        // Setup: Register first, then pause
        registry.registerProtocol(mockProtocol, "Aave", 10, true, 10000e6);
        registry.pause();

        // Action: Blacklist should still work as an emergency escape hatch
        registry.blacklistProtocol(mockProtocol);

        // Assert
        assertFalse(registry.isEligibleForCoverage(mockProtocol));
    }

    // --------------------------------------------------------
    //  Registration Edge Cases
    // --------------------------------------------------------

    function test_RevertIf_RegisterZeroAddress() public {
        vm.expectRevert(IRiskRegistry.IRiskRegistry__ZeroAddress.selector);
        registry.registerProtocol(address(0), "Zero", 10, true, 1000);
    }

    function test_RevertIf_RiskScoreOutOfBounds() public {
        // Score 101 should revert
        vm.expectRevert(abi.encodeWithSelector(IRiskRegistry.IRiskRegistry__InvalidRiskScore.selector, 101));
        registry.registerProtocol(mockProtocol, "HighRisk", 101, true, 1000);
        
        // Update score 101 should revert
        registry.registerProtocol(mockProtocol, "HighRisk", 50, true, 1000);
        vm.expectRevert(abi.encodeWithSelector(IRiskRegistry.IRiskRegistry__InvalidRiskScore.selector, 101));
        registry.updateRiskScore(mockProtocol, 101);
    }

    function test_ScoreExactly100IsValid() public {
        // Boundary check: 100 is the max valid score
        registry.registerProtocol(mockProtocol, "MaxRisk", 100, false, 500e6);
        assertEq(registry.getRiskScore(mockProtocol), 100);
    }

    function test_RevertIf_AlreadyRegistered() public {
        registry.registerProtocol(mockProtocol, "Aave", 10, true, 10000e6);
        
        vm.expectRevert(abi.encodeWithSelector(IRiskRegistry.IRiskRegistry__AlreadyRegistered.selector, mockProtocol));
        registry.registerProtocol(mockProtocol, "Aave2", 20, false, 5000e6);
    }

    function test_RegisterProtocolSuccessAndState() public {
        vm.expectEmit(true, false, false, true);
        emit ProtocolRegistered(mockProtocol, "Aave", 15, true);

        registry.registerProtocol(mockProtocol, "Aave", 15, true, 50000e6);

        IRiskRegistry.ProtocolInfo memory info = registry.getProtocolInfo(mockProtocol);
        
        assertEq(info.riskScore, 15);
        assertTrue(info.audited);
        assertTrue(info.active);
        assertEq(info.coverageCap, 50000e6);
        assertGt(info.registeredAt, 0);
        assertTrue(registry.isEligibleForCoverage(mockProtocol));
    }

    // --------------------------------------------------------
    //  Updates & View Validations
    // --------------------------------------------------------

    function test_RevertIf_InteractingWithUnregistered() public {
        vm.expectRevert(abi.encodeWithSelector(IRiskRegistry.IRiskRegistry__NotRegistered.selector, mockProtocol2));
        registry.updateRiskScore(mockProtocol2, 50);

        vm.expectRevert(abi.encodeWithSelector(IRiskRegistry.IRiskRegistry__NotRegistered.selector, mockProtocol2));
        registry.setAuditStatus(mockProtocol2, true);

        vm.expectRevert(abi.encodeWithSelector(IRiskRegistry.IRiskRegistry__NotRegistered.selector, mockProtocol2));
        registry.blacklistProtocol(mockProtocol2);

        vm.expectRevert(abi.encodeWithSelector(IRiskRegistry.IRiskRegistry__NotRegistered.selector, mockProtocol2));
        registry.getProtocolInfo(mockProtocol2);

        vm.expectRevert(abi.encodeWithSelector(IRiskRegistry.IRiskRegistry__NotRegistered.selector, mockProtocol2));
        registry.getRiskScore(mockProtocol2);

        vm.expectRevert(abi.encodeWithSelector(IRiskRegistry.IRiskRegistry__NotRegistered.selector, mockProtocol2));
        registry.getCoverageCap(mockProtocol2);

        // isEligibleForCoverage should return false, not revert
        assertFalse(registry.isEligibleForCoverage(mockProtocol2));
    }

    function test_UpdateRiskScoreSuccess() public {
        registry.registerProtocol(mockProtocol, "Aave", 10, true, 1000e6);
        
        vm.expectEmit(true, false, false, true);
        emit RiskScoreUpdated(mockProtocol, 10, 25);
        
        registry.updateRiskScore(mockProtocol, 25);
        assertEq(registry.getRiskScore(mockProtocol), 25);
    }

    function test_SetAuditStatusSuccess() public {
        registry.registerProtocol(mockProtocol, "Aave", 10, false, 1000e6);
        
        vm.expectEmit(true, false, false, true);
        emit AuditStatusUpdated(mockProtocol, true);
        
        registry.setAuditStatus(mockProtocol, true);
        assertTrue(registry.getProtocolInfo(mockProtocol).audited);
    }

    function test_BlacklistStateTransitions() public {
        registry.registerProtocol(mockProtocol, "Aave", 10, true, 1000e6);
        assertTrue(registry.isEligibleForCoverage(mockProtocol));

        // Blacklist
        vm.expectEmit(true, false, false, false);
        emit ProtocolBlacklisted(mockProtocol);
        registry.blacklistProtocol(mockProtocol);
        
        assertFalse(registry.isEligibleForCoverage(mockProtocol));
        assertFalse(registry.getProtocolInfo(mockProtocol).active);

        // Double blacklist shouldn't emit or fail, just return
        registry.blacklistProtocol(mockProtocol);

        // Unblacklist
        vm.expectEmit(true, false, false, false);
        emit ProtocolReactivated(mockProtocol);
        registry.unblacklistProtocol(mockProtocol);
        
        assertTrue(registry.isEligibleForCoverage(mockProtocol));
    }
}