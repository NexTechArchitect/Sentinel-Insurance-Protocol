// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title  IPolicyEngine
 * @notice Core interface for the SentinelShield policy management system.
 * @dev    Defines the standard functions, structures, and events for policy issuance, 
 * lifecycle management, and premium quoting.
 */
interface IPolicyEngine {
    // --------------------------------------------------------
    //  Custom Errors
    // --------------------------------------------------------

    error IPolicyEngine__ProtocolNotEligible(address protocol);
    error IPolicyEngine__InvalidCoverageAmount(uint256 amount);
    error IPolicyEngine__InvalidDuration(uint256 duration);
    error IPolicyEngine__InsufficientPoolLiquidity(uint256 requested, uint256 available);
    error IPolicyEngine__IncorrectPremiumAmount(uint256 expected, uint256 sent);
    error IPolicyEngine__NotPolicyOwner(uint256 policyId, address caller);
    error IPolicyEngine__PolicyNotActive(uint256 policyId);
    error IPolicyEngine__PolicyNotExpired(uint256 policyId);
    error IPolicyEngine__ActiveClaimExists(uint256 policyId, uint256 claimId);
    error IPolicyEngine__ProtocolCapExceeded(address protocol);

    // --------------------------------------------------------
    //  Events
    // --------------------------------------------------------

    event PolicyIssued(
        uint256 indexed policyId,
        address indexed holder,
        address indexed protocol,
        uint256 coverageAmount,
        uint256 premium,
        uint256 expiresAt
    );

    event PolicyExpired(uint256 indexed policyId, uint256 expiredAt);
    event PolicyCancelled(uint256 indexed policyId, uint256 refundAmount);
    event PolicyMarkedClaimed(uint256 indexed policyId);

    // --------------------------------------------------------
    //  Data Structures
    // --------------------------------------------------------

    enum PolicyStatus {
        ACTIVE,     // Coverage is currently active
        EXPIRED,    // Duration elapsed without a claim
        CLAIMED,    // Valid claim was approved and paid out
        CANCELLED   // Holder cancelled the policy early
    }

    struct Policy {
        address holder;
        address protocol;
        uint256 coverageAmount;
        uint256 premium;
        uint256 issuedAt;
        uint256 expiresAt;
        PolicyStatus status;
    }

    // --------------------------------------------------------
    //  State-Changing Functions
    // --------------------------------------------------------

    function buyPolicy(
        address protocol,
        uint256 coverageAmount,
        uint256 duration
    ) external payable returns (uint256 policyId);

    function cancelPolicy(uint256 policyId) external;
    function expirePolicy(uint256 policyId) external;
    function markClaimed(uint256 policyId) external;

    // --------------------------------------------------------
    //  View Functions
    // --------------------------------------------------------

    function getPolicy(uint256 policyId) external view returns (Policy memory);
    function quotePremium(address protocol, uint256 coverageAmount, uint256 duration) external view returns (uint256);
    function getProtocolExposure(address protocol) external view returns (uint256);
    function isPolicyActive(uint256 policyId) external view returns (bool);
    function totalPolicies() external view returns (uint256);
}