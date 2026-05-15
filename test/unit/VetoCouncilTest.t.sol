// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/*
 * @title VetoCouncil Unit Tests
 * @dev Rigorous "Red Team" testing focusing on:
 * 1. Multisig Threshold Validation (M-of-N mechanics).
 * 2. Guardian Management Bounds (Preventing unreachable thresholds).
 * 3. Double-Sign and Access Control exploits.
 */

import {Test} from "forge-std/Test.sol";
import {VetoCouncil} from "../../src/governance/VetoCouncil.sol"; // Update path if needed
import {IClaimsGovernor} from "../../src/interfaces/IClaimsGovernor.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

contract VetoCouncilTest is Test {
    VetoCouncil public council;

    address public mockGovernor = address(0x111);
    address public owner = address(this);
    
    address public g1 = address(0xA1);
    address public g2 = address(0xA2);
    address public g3 = address(0xA3);
    address public g4 = address(0xA4);
    address public hacker = address(0x999);

    address[] public initialGuardians;

    function setUp() public {
        initialGuardians.push(g1);
        initialGuardians.push(g2);
        initialGuardians.push(g3);

        // Deploy a 2-of-3 Veto Council
        council = new VetoCouncil(mockGovernor, initialGuardians, 2);
    }

    // --------------------------------------------------------
    //  Initialization & Constructor Tests
    // --------------------------------------------------------

    function test_RevertIf_ZeroAddressGovernor() public {
        vm.expectRevert(VetoCouncil.VetoCouncil__ZeroAddress.selector);
        new VetoCouncil(address(0), initialGuardians, 2);
    }

    function test_RevertIf_EmptyGuardiansArray() public {
        address[] memory emptyArr = new address[](0);
        vm.expectRevert(VetoCouncil.VetoCouncil__MinimumOneGuardian.selector);
        new VetoCouncil(mockGovernor, emptyArr, 1);
    }

    function test_RevertIf_InvalidThresholdOnDeploy() public {
        // Threshold 0
        vm.expectRevert(abi.encodeWithSelector(VetoCouncil.VetoCouncil__InvalidThreshold.selector, 0, 3));
        new VetoCouncil(mockGovernor, initialGuardians, 0);

        // Threshold > Guardians (4 > 3)
        vm.expectRevert(abi.encodeWithSelector(VetoCouncil.VetoCouncil__InvalidThreshold.selector, 4, 3));
        new VetoCouncil(mockGovernor, initialGuardians, 4);
    }

    function test_RevertIf_ZeroAddressInGuardians() public {
        address[] memory badArr = new address[](2);
        badArr[0] = g1;
        badArr[1] = address(0); // Zero address trap

        vm.expectRevert(VetoCouncil.VetoCouncil__ZeroAddress.selector);
        new VetoCouncil(mockGovernor, badArr, 2);
    }

    function test_Constructor_SuccessAndState() public view {
        assertEq(council.s_threshold(), 2);
        assertEq(council.guardianCount(), 3);
        assertTrue(council.isGuardian(g1));
        assertTrue(council.isGuardian(g2));
        assertTrue(council.isGuardian(g3));
        assertFalse(council.isGuardian(hacker));
    }

    // --------------------------------------------------------
    //  Signing Mechanics & Execution
    // --------------------------------------------------------

    function test_RevertIf_NonGuardianSigns() public {
        vm.prank(hacker);
        vm.expectRevert(abi.encodeWithSelector(VetoCouncil.VetoCouncil__NotGuardian.selector, hacker));
        council.signVeto(1, "Spam");
    }

    function test_RevertIf_GuardianSignsTwice() public {
        vm.startPrank(g1);
        council.signVeto(1, "Spam"); // 1st sign works

        vm.expectRevert(abi.encodeWithSelector(VetoCouncil.VetoCouncil__AlreadySigned.selector, 1, g1));
        council.signVeto(1, "Spam"); // 2nd sign reverts
        vm.stopPrank();
    }

    function test_SignVeto_ExecutesWhenThresholdMet() public {
        uint256 claimId = 1;
        string memory reason = "Malicious Exploit";

        // MOCK: Governor expecting the veto call
        vm.mockCall(
            mockGovernor,
            abi.encodeWithSelector(IClaimsGovernor.vetoClaim.selector, claimId, reason),
            abi.encode()
        );

        // Guardian 1 signs -> Count = 1 (Threshold is 2)
        vm.prank(g1);
        council.signVeto(claimId, reason);
        
        assertEq(council.vetoSignatureCount(claimId), 1);
        assertTrue(council.hasSignedVeto(claimId, g1));
        assertFalse(council.isVetoExecuted(claimId)); // Not executed yet

        // Guardian 2 signs -> Count = 2 -> Should Execute!
        vm.prank(g2);
        council.signVeto(claimId, reason);

        assertEq(council.vetoSignatureCount(claimId), 2);
        assertTrue(council.hasSignedVeto(claimId, g2));
        assertTrue(council.isVetoExecuted(claimId)); // Execution triggered
    }

    function test_RevertIf_SignAfterExecution() public {
        uint256 claimId = 1;
        string memory reason = "Spam";

        vm.mockCall(mockGovernor, abi.encodeWithSelector(IClaimsGovernor.vetoClaim.selector, claimId, reason), abi.encode());

        vm.prank(g1);
        council.signVeto(claimId, reason);

        vm.prank(g2);
        council.signVeto(claimId, reason); // Executed here

        // Guardian 3 tries to be smart and sign an already executed veto
        vm.prank(g3);
        vm.expectRevert(abi.encodeWithSelector(VetoCouncil.VetoCouncil__AlreadyExecuted.selector, claimId));
        council.signVeto(claimId, reason);
    }

    // --------------------------------------------------------
    //  Council Management (Owner Only)
    // --------------------------------------------------------

    function test_AddGuardian_Success() public {
        council.addGuardian(g4);
        
        assertTrue(council.isGuardian(g4));
        assertEq(council.guardianCount(), 4);
    }

    function test_RevertIf_AddInvalidGuardian() public {
        vm.expectRevert(VetoCouncil.VetoCouncil__ZeroAddress.selector);
        council.addGuardian(address(0));

        vm.expectRevert(abi.encodeWithSelector(VetoCouncil.VetoCouncil__AlreadyGuardian.selector, g1));
        council.addGuardian(g1);
    }

    function test_RemoveGuardian_Success() public {
        council.removeGuardian(g3);
        
        assertFalse(council.isGuardian(g3));
        assertEq(council.guardianCount(), 2);
    }

    function test_RevertIf_RemoveInvalidGuardian() public {
        vm.expectRevert(abi.encodeWithSelector(VetoCouncil.VetoCouncil__NotAGuardian.selector, hacker));
        council.removeGuardian(hacker);
    }

    function test_RevertIf_RemoveBreaksThreshold() public {
        // Threshold is 2, Current Guardians = 3. 
        // Removing 1 leaves 2 (Threshold met).
        // Removing another leaves 1. But threshold is 2! Contract must block this.
        
        council.removeGuardian(g3); // Works. Guardians = 2.

        vm.expectRevert(abi.encodeWithSelector(VetoCouncil.VetoCouncil__InvalidThreshold.selector, 2, 1));
        council.removeGuardian(g2); // Reverts! Math protects the multisig.
    }

    function test_SetThreshold_SuccessAndReverts() public {
        council.setThreshold(3);
        assertEq(council.s_threshold(), 3);

        vm.expectRevert(abi.encodeWithSelector(VetoCouncil.VetoCouncil__InvalidThreshold.selector, 0, 3));
        council.setThreshold(0);

        vm.expectRevert(abi.encodeWithSelector(VetoCouncil.VetoCouncil__InvalidThreshold.selector, 4, 3));
        council.setThreshold(4);
    }

    function test_OnlyOwner_Modifiers() public {
        vm.startPrank(hacker);
        
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, hacker));
        council.addGuardian(g4);

        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, hacker));
        council.removeGuardian(g1);

        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, hacker));
        council.setThreshold(1);

        vm.stopPrank();
    }
}