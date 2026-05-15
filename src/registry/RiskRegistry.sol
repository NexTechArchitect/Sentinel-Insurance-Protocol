// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IRiskRegistry} from "../interfaces/IRiskRegistry.sol";
import {Ownable2Step, Ownable} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";

/**
 * @title  RiskRegistry
 * @author Amit (SentinelShield)
 * @notice Source of truth for every protocol SentinelShield can insure.
 * @dev    Implements Ownable2Step for secure ownership and Pausable for emergency circuit breaking.
 *         The registry dictates the economic parameters used by the PolicyEngine.
 */
contract RiskRegistry is IRiskRegistry, Ownable2Step, Pausable {
    // -------------------------------------------------------
    //  Storage
    // -------------------------------------------------------

    /**
     * @dev Internal mapping of protocol addresses to their respective metadata and risk parameters.
     */
    mapping(address => ProtocolInfo) private s_protocols;

    // -------------------------------------------------------
    //  Constructor
    // -------------------------------------------------------

    constructor() Ownable(msg.sender) {}

    // -------------------------------------------------------
    //  Internal
    // -------------------------------------------------------

    /**
     * @dev Checks if a protocol has been initialized by verifying the registeredAt timestamp.
     * @param protocol The address of the DeFi protocol to verify.
     * @return bool True if the protocol exists in the registry.
     */
    function _isRegistered(address protocol) internal view returns (bool) {
        return s_protocols[protocol].registeredAt != 0;
    }

    // -------------------------------------------------------
    //  External — Management
    // -------------------------------------------------------

    /**
     * @notice Registers a new protocol into the SentinelShield ecosystem.
     * @dev Initial registration sets the active flag to true.
     * @param protocol On-chain address of the protocol vault or core contract.
     * @param name Human-readable name (emitted via event for off-chain indexing).
     * @param riskScore Integer between 0-100 representing the risk weight.
     * @param audited Boolean indicating if the protocol has a passing security audit.
     * @param coverageCap Maximum aggregate USDC coverage allowed for this protocol.
     */
    function registerProtocol(
        address protocol,
        string calldata name,
        uint8 riskScore,
        bool audited,
        uint256 coverageCap
    ) external onlyOwner whenNotPaused {
        if (protocol == address(0)) revert IRiskRegistry__ZeroAddress();
        if (_isRegistered(protocol)) revert IRiskRegistry__AlreadyRegistered(protocol);
        if (riskScore > 100) revert IRiskRegistry__InvalidRiskScore(riskScore);

        s_protocols[protocol] = ProtocolInfo({
            riskScore:    riskScore,
            audited:      audited,
            active:       true,
            coverageCap:  coverageCap,
            registeredAt: block.timestamp
        });

        emit ProtocolRegistered(protocol, name, riskScore, audited);
    }

    /**
     * @notice Updates the risk weight of a protocol.
     * @dev Directly impacts premium calculation in the PolicyEngine.
     * @param protocol Address of the registered protocol.
     * @param newScore Updated score (0-100).
     */
    function updateRiskScore(
        address protocol,
        uint8 newScore
    ) external onlyOwner whenNotPaused {
        if (!_isRegistered(protocol)) revert IRiskRegistry__NotRegistered(protocol);
        if (newScore > 100) revert IRiskRegistry__InvalidRiskScore(newScore);

        uint8 oldScore = s_protocols[protocol].riskScore;
        s_protocols[protocol].riskScore = newScore;

        emit RiskScoreUpdated(protocol, oldScore, newScore);
    }

    /**
     * @notice Toggles the audit verification status.
     * @param protocol Address of the registered protocol.
     * @param audited New audit status.
     */
    function setAuditStatus(
        address protocol,
        bool audited
    ) external onlyOwner whenNotPaused {
        if (!_isRegistered(protocol)) revert IRiskRegistry__NotRegistered(protocol);

        s_protocols[protocol].audited = audited;

        emit AuditStatusUpdated(protocol, audited);
    }

    /**
     * @notice Prevents new policies from being issued for a protocol.
     * @dev Existing policies remain valid for claims. This function ignores the pause state.
     * @param protocol Address of the protocol to blacklist.
     */
    function blacklistProtocol(address protocol) external onlyOwner {
        if (!_isRegistered(protocol)) revert IRiskRegistry__NotRegistered(protocol);
        if (!s_protocols[protocol].active) return;

        s_protocols[protocol].active = false;

        emit ProtocolBlacklisted(protocol);
    }

    /**
     * @notice Re-enables policy issuance for a previously blacklisted protocol.
     * @param protocol Address of the protocol to reactivate.
     */
    function unblacklistProtocol(address protocol) external onlyOwner whenNotPaused {
        if (!_isRegistered(protocol)) revert IRiskRegistry__NotRegistered(protocol);
        if (s_protocols[protocol].active) return;

        s_protocols[protocol].active = true;

        emit ProtocolReactivated(protocol);
    }

    // -------------------------------------------------------
    //  External — View Functions
    // -------------------------------------------------------

    /**
     * @notice Retrieves full protocol metadata.
     * @param protocol Protocol address.
     * @return ProtocolInfo struct containing all risk parameters.
     */
    function getProtocolInfo(
        address protocol
    ) external view returns (ProtocolInfo memory) {
        if (!_isRegistered(protocol)) revert IRiskRegistry__NotRegistered(protocol);
        return s_protocols[protocol];
    }

    /**
     * @notice Simple eligibility check for the PolicyEngine.
     * @param protocol Protocol address.
     * @return bool True if registered and active.
     */
    function isEligibleForCoverage(address protocol) external view returns (bool) {
        if (!_isRegistered(protocol)) return false;
        return s_protocols[protocol].active;
    }

    /**
     * @notice Fetches risk weight for premium math.
     * @param protocol Protocol address.
     * @return score The 0-100 risk score.
     */
    function getRiskScore(address protocol) external view returns (uint8 score) {
        if (!_isRegistered(protocol)) revert IRiskRegistry__NotRegistered(protocol);
        return s_protocols[protocol].riskScore;
    }

    /**
     * @notice Fetches the maximum aggregate coverage limit.
     * @param protocol Protocol address.
     * @return cap Max USDC coverage amount.
     */
    function getCoverageCap(address protocol) external view returns (uint256 cap) {
        if (!_isRegistered(protocol)) revert IRiskRegistry__NotRegistered(protocol);
        return s_protocols[protocol].coverageCap;
    }

    // -------------------------------------------------------
    //  Owner Utilities (Circuit Breakers)
    // -------------------------------------------------------

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }
}