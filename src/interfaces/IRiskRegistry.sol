// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title  IRiskRegistry
 * @notice Interface for the SentinelShield Risk Registry.
 * @dev    Defines the data structures, events, and methods for managing insurable protocols.
 * Used as the definitive source of truth by the PolicyEngine for eligibility and risk scoring.
 */
interface IRiskRegistry {
    // --------------------------------------------------------
    //  Errors
    // --------------------------------------------------------

    /// @notice Thrown when attempting to register a protocol that is already tracked.
    error IRiskRegistry__AlreadyRegistered(address protocol);

    /// @notice Thrown when attempting to interact with a protocol not present in the registry.
    error IRiskRegistry__NotRegistered(address protocol);

    /// @notice Thrown when an invalid risk score (outside 0-100) is provided.
    error IRiskRegistry__InvalidRiskScore(uint8 score);

    /// @notice Thrown when a zero address is provided for a protocol address.
    error IRiskRegistry__ZeroAddress();

    // --------------------------------------------------------
    //  Events
    // --------------------------------------------------------

    /**
     * @notice Emitted upon successful registration of a new protocol.
     * @param protocol  Address of the protocol.
     * @param name      Human-readable protocol identifier.
     * @param riskScore Initial risk score (0-100).
     * @param audited   Initial audit status.
     */
    event ProtocolRegistered(address indexed protocol, string name, uint8 riskScore, bool audited);

    /**
     * @notice Emitted when a protocol's risk score is modified.
     * @param protocol Address of the protocol.
     * @param oldScore The previous risk score.
     * @param newScore The updated risk score.
     */
    event RiskScoreUpdated(address indexed protocol, uint8 oldScore, uint8 newScore);

    /**
     * @notice Emitted when a protocol's audit status is modified.
     * @param protocol Address of the protocol.
     * @param audited  The updated audit status.
     */
    event AuditStatusUpdated(address indexed protocol, bool audited);

    /**
     * @notice Emitted when a protocol is blacklisted, halting new policy issuance.
     * @param protocol Address of the blacklisted protocol.
     */
    event ProtocolBlacklisted(address indexed protocol);

    /**
     * @notice Emitted when a previously blacklisted protocol is reactivated.
     * @param protocol Address of the reactivated protocol.
     */
    event ProtocolReactivated(address indexed protocol);

    // --------------------------------------------------------
    //  Data Structures
    // --------------------------------------------------------

    /**
     * @notice Comprehensive on-chain record for a covered protocol.
     * @param riskScore    Risk assessment score [0, 100].
     * @param audited      Boolean indicating valid security audit.
     * @param active       Boolean indicating if new policies can be issued.
     * @param coverageCap  Maximum aggregate USDC coverage allowed.
     * @param registeredAt Timestamp of initial registration.
     */
    struct ProtocolInfo {
        uint8   riskScore;
        bool    audited;
        bool    active;
        uint256 coverageCap;
        uint256 registeredAt;
    }

    // --------------------------------------------------------
    //  Write Functions
    // --------------------------------------------------------

    /**
     * @notice Registers a new protocol to enable policy issuance.
     * @param protocol    Address of the protocol.
     * @param name        Human-readable name.
     * @param riskScore   Initial risk score.
     * @param audited     Audit status.
     * @param coverageCap Maximum coverage capacity in USDC (6 decimals).
     */
    function registerProtocol(
        address protocol,
        string calldata name,
        uint8 riskScore,
        bool audited,
        uint256 coverageCap
    ) external;

    /**
     * @notice Updates the risk score for a registered protocol.
     * @param protocol Address of the protocol.
     * @param newScore Updated risk score.
     */
    function updateRiskScore(address protocol, uint8 newScore) external;

    /**
     * @notice Updates the audit verification status for a registered protocol.
     * @param protocol Address of the protocol.
     * @param audited  Updated audit status.
     */
    function setAuditStatus(address protocol, bool audited) external;

    /**
     * @notice Blacklists a protocol, preventing future policy issuance.
     * @param protocol Address of the protocol to blacklist.
     */
    function blacklistProtocol(address protocol) external;

    /**
     * @notice Reactivates a previously blacklisted protocol.
     * @param protocol Address of the protocol to reactivate.
     */
    function unblacklistProtocol(address protocol) external;

    // --------------------------------------------------------
    //  View Functions
    // --------------------------------------------------------

    /**
     * @notice Retrieves the full protocol metadata.
     * @param protocol Address of the protocol.
     * @return ProtocolInfo struct containing risk parameters.
     */
    function getProtocolInfo(address protocol) external view returns (ProtocolInfo memory);

    /**
     * @notice Checks if a protocol is registered and actively eligible for coverage.
     * @param protocol Address of the protocol.
     * @return True if eligible, false otherwise.
     */
    function isEligibleForCoverage(address protocol) external view returns (bool);

    /**
     * @notice Retrieves the risk score for premium calculation.
     * @param protocol Address of the protocol.
     * @return Current risk score.
     */
    function getRiskScore(address protocol) external view returns (uint8);

    /**
     * @notice Retrieves the maximum coverage limit for a protocol.
     * @param protocol Address of the protocol.
     * @return Maximum outstanding USDC coverage allowed (6 decimals).
     */
    function getCoverageCap(address protocol) external view returns (uint256);
}