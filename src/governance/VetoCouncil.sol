// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IClaimsGovernor} from "../interfaces/IClaimsGovernor.sol";
import {Ownable2Step, Ownable} from "@openzeppelin/contracts/access/Ownable2Step.sol";

/**
 * @title  VetoCouncil
 * @author NexTechArchitect
 * @notice Multisig safety valve for the SentinelShield protocol.
 * @dev    Implements an M-of-N multisignature pattern for trusted guardians.
 * - Allows a designated council to unilaterally cancel malicious, fraudulent, or spam claims.
 * - Vetos can only be executed while a claim is in the PENDING phase within the ClaimsGovernor.
 * - Protects the protocol from governance attacks or highly sophisticated exploits.
 */
contract VetoCouncil is Ownable2Step {

    // -------------------------------------------------------
    //  Immutables
    // -------------------------------------------------------

    /// @notice The central ClaimsGovernor contract where claims are adjudicated.
    IClaimsGovernor public immutable i_claimsGovernor;

    // -------------------------------------------------------
    //  Configuration
    // -------------------------------------------------------

    /// @notice The minimum number of guardian signatures required to successfully execute a veto.
    uint256 public s_threshold;

    // -------------------------------------------------------
    //  State Variables
    // -------------------------------------------------------

    /// @dev Tracks active guardian addresses: guardian address -> isActive.
    mapping(address => bool) private s_isGuardian;

    /// @dev Tracks individual veto signatures: claimId -> guardian -> hasSigned.
    mapping(uint256 => mapping(address => bool)) private s_vetoSigned;

    /// @dev Tracks total veto signatures collected per claim: claimId -> signatureCount.
    mapping(uint256 => uint256) private s_vetoSignatureCount;

    /// @dev Ensures a veto is only executed once per claim.
    mapping(uint256 => bool) private s_vetoExecuted;

    /// @dev Caches the total number of active guardians for threshold validation.
    uint256 private s_guardianCount;

    // -------------------------------------------------------
    //  Errors
    // -------------------------------------------------------

    error VetoCouncil__NotGuardian(address caller);
    error VetoCouncil__AlreadySigned(uint256 claimId, address guardian);
    error VetoCouncil__AlreadyExecuted(uint256 claimId);
    error VetoCouncil__ThresholdNotMet(uint256 claimId, uint256 have, uint256 need);
    error VetoCouncil__InvalidThreshold(uint256 threshold, uint256 guardianCount);
    error VetoCouncil__ZeroAddress();
    error VetoCouncil__AlreadyGuardian(address guardian);
    error VetoCouncil__NotAGuardian(address guardian);
    error VetoCouncil__MinimumOneGuardian();

    // -------------------------------------------------------
    //  Events
    // -------------------------------------------------------

    event GuardianAdded(address indexed guardian);
    event GuardianRemoved(address indexed guardian);
    event ThresholdUpdated(uint256 newThreshold);
    event VetoSigned(uint256 indexed claimId, address indexed guardian, uint256 sigCount);
    event VetoExecuted(uint256 indexed claimId, string reason);

    // -------------------------------------------------------
    //  Modifiers
    // -------------------------------------------------------

    modifier onlyGuardian() {
        if (!s_isGuardian[msg.sender]) revert VetoCouncil__NotGuardian(msg.sender);
        _;
    }

    // -------------------------------------------------------
    //  Constructor
    // -------------------------------------------------------

    /**
     * @notice Initializes the VetoCouncil with a base set of guardians and a threshold.
     * @param claimsGovernor Address of the ClaimsGovernor contract.
     * @param guardians      Array of initial trusted guardian addresses.
     * @param threshold      Minimum signatures required to execute a veto.
     */
    constructor(
        address claimsGovernor,
        address[] memory guardians,
        uint256 threshold
    ) Ownable(msg.sender) {
        if (claimsGovernor == address(0)) revert VetoCouncil__ZeroAddress();
        if (guardians.length == 0)         revert VetoCouncil__MinimumOneGuardian();
        if (threshold == 0 || threshold > guardians.length) {
            revert VetoCouncil__InvalidThreshold(threshold, guardians.length);
        }

        i_claimsGovernor = IClaimsGovernor(claimsGovernor);

        for (uint256 i = 0; i < guardians.length; ) {
            if (guardians[i] == address(0)) revert VetoCouncil__ZeroAddress();
            s_isGuardian[guardians[i]] = true;
            emit GuardianAdded(guardians[i]);
            unchecked { ++i; }
        }

        s_guardianCount = guardians.length;
        s_threshold     = threshold;
    }

    // -------------------------------------------------------
    //  External — Guardian Actions
    // -------------------------------------------------------

    /**
     * @notice Allows an active guardian to sign a veto proposal for a pending claim.
     * @dev    Automatically executes the veto via the ClaimsGovernor once the threshold is met.
     * @param  claimId Unique identifier of the claim to veto.
     * @param  reason  Human-readable justification for the veto.
     */
    function signVeto(uint256 claimId, string calldata reason)
        external
        onlyGuardian
    {
        if (s_vetoExecuted[claimId]) revert VetoCouncil__AlreadyExecuted(claimId);
        if (s_vetoSigned[claimId][msg.sender]) {
            revert VetoCouncil__AlreadySigned(claimId, msg.sender);
        }

        s_vetoSigned[claimId][msg.sender]  = true;
        s_vetoSignatureCount[claimId]      += 1;

        uint256 count = s_vetoSignatureCount[claimId];

        emit VetoSigned(claimId, msg.sender, count);

        if (count >= s_threshold) {
            s_vetoExecuted[claimId] = true;

            // Fix: Emit event BEFORE external call (CEI Pattern)
            emit VetoExecuted(claimId, reason);

            i_claimsGovernor.vetoClaim(claimId, reason);
        }
    }

    // -------------------------------------------------------
    //  Owner — Council Management
    // ------------------------------------------------------- 

    /**
     * @notice Adds a new guardian to the council.
     * @param  guardian Address of the new guardian.
     */
    function addGuardian(address guardian) external onlyOwner {
        if (guardian == address(0))   revert VetoCouncil__ZeroAddress();
        if (s_isGuardian[guardian])   revert VetoCouncil__AlreadyGuardian(guardian);

        s_isGuardian[guardian] = true;
        unchecked { ++s_guardianCount; }

        emit GuardianAdded(guardian);
    }

    /**
     * @notice Removes an existing guardian from the council.
     * @dev    Reverts if the removal would make the current threshold mathematically unreachable.
     * @param  guardian Address of the guardian to remove.
     */
    function removeGuardian(address guardian) external onlyOwner {
        if (!s_isGuardian[guardian]) revert VetoCouncil__NotAGuardian(guardian);

        if (s_guardianCount - 1 < s_threshold) {
            revert VetoCouncil__InvalidThreshold(s_threshold, s_guardianCount - 1);
        }

        s_isGuardian[guardian] = false;
        unchecked { --s_guardianCount; }

        emit GuardianRemoved(guardian);
    }

    /**
     * @notice Updates the required signature threshold for executing a veto.
     * @param  newThreshold The new signature requirement.
     */
    function setThreshold(uint256 newThreshold) external onlyOwner {
        if (newThreshold == 0 || newThreshold > s_guardianCount) {
            revert VetoCouncil__InvalidThreshold(newThreshold, s_guardianCount);
        }
        s_threshold = newThreshold;
        emit ThresholdUpdated(newThreshold);
    }

    // -------------------------------------------------------
    //  View Functions
    // -------------------------------------------------------

    function isGuardian(address addr) external view returns (bool) {
        return s_isGuardian[addr];
    }

    function vetoSignatureCount(uint256 claimId) external view returns (uint256) {
        return s_vetoSignatureCount[claimId];
    }

    function hasSignedVeto(uint256 claimId, address guardian)
        external
        view
        returns (bool)
    {
        return s_vetoSigned[claimId][guardian];
    }

    function isVetoExecuted(uint256 claimId) external view returns (bool) {
        return s_vetoExecuted[claimId];
    }

    function guardianCount() external view returns (uint256) {
        return s_guardianCount;
    }
}