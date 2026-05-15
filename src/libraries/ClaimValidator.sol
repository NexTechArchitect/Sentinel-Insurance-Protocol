// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title  ClaimValidator
 * @notice Stateless library for validating claim eligibility and governance parameters.
 * @dev    Executes pre-flight checks before state mutations in ClaimsGovernor. 
 * Maintains zero state, makes no external calls, and has zero reentrancy surface.
 */
library ClaimValidator {
    

 // -------------------------------------------------------
 // Constants
 // -------------------------------------------------------

/// @dev Minimum allowed duration for a claim voting period (3 days).
uint256 public constant MIN_VOTING_PERIOD = 3 days;

/// @dev Maximum allowed duration for a claim voting period (14 days).
uint256 public constant MAX_VOTING_PERIOD = 14 days;

/// @dev Minimum quorum required to validate a vote, represented in basis points (1% = 100 bps).
uint256 public constant QUORUM_BPS = 100;

/// @dev Standar basis points denominator (100% = 10,000 bps).
uint256 public constant BPS_DENOMINATOR = 10_000;

/// @dev Minimum Character length for evidence URIs to prevent empty or invalid submissions.
uint256 public constant MIN_EVIDENCE_URI_LENGTH = 10;

// -------------------------------------------------------
//  Errors
// -------------------------------------------------------

    error ClaimValidator__PolicyNotActive();
    error ClaimValidator__PolicyExpired();
    error ClaimValidator__EmptyEvidence();
    error ClaimValidator__EvidenceTooShort(uint256 length, uint256 minimum);
    error ClaimValidator__VotingPeriodOutOfRange(uint256 period);
    error ClaimValidator__ZeroTotalSupply();
    error ClaimValidator__ClaimantNotHolder(address claimant, address holder);

// -------------------------------------------------------
//  External — Validation Functions
// -------------------------------------------------------

/**
 * @notice Validates if a specific policy is currently eligible for a claim submission.
 * @dev    Reverts if the policy is inactive, expired, or if the caller is not the rightful holder.
 * @param  policyStatus  Current encoded status of the policy (0 = ACTIVE).
 * @param  policyHolder  The authorized wallet address of the policy owner.
 * @param  claimant      The address attempting to file the claim (msg.sender).
 * @param  expiresAt     Unix timestamp marking the policy's expiration.
 * @param  currentTime   Current block timestamp.
 */

function validateClaimEligibility(
        uint8 policyStatus,
        address policyHolder,
        address claimant,
        uint256 expiresAt,
        uint256 currentTime
    ) external pure {

    if (policyStatus !=0) revert ClaimValidator__PolicyNotActive();
    if (currentTime > expiresAt) revert ClaimValidator__PolicyExpired();
    if (claimant != policyHolder) revert ClaimValidator__ClaimantNotHolder(claimant, policyHolder);
    }

/**
 * @notice Validates the integrity and format of the submitted evidence URI.
 * @dev    Enforces strict length checks. Maintains separation of Empty and TooShort errors for frontend clarity.
 * @param  evidenceUri   The IPFS, Arweave, or HTTPS URI containing claim evidence.
 */
function validateEvidence(string calldata evidenceUri) external pure {
    uint256 len = bytes(evidenceUri).length;
    if (len == 0) revert ClaimValidator__EmptyEvidence();
    if (len < MIN_EVIDENCE_URI_LENGTH) revert ClaimValidator__EvidenceTooShort(len, MIN_EVIDENCE_URI_LENGTH);
}
/**
 * @notice Determines if a concluded vote has met quorum and achieved a majority consensus.
 * @dev    Implements precision-safe arithmetic for quorum calculation: (totalSupply * QUORUM_BPS) / 10000.
 * @param  yesVotes      Total accumulated weight of affirmative votes.
 * @param  noVotes       Total accumulated weight of negative votes.
 * @param  totalSupply   Total supply of the governance token at the snapshot block.
 * @return approved      Boolean indicating if the claim is officially approved.
 */
function isClaimApproved(
        uint256 yesVotes,
        uint256 noVotes,
        uint256 totalSupply
     ) external pure returns (bool approved) {
    if (totalSupply == 0) revert ClaimValidator__ZeroTotalSupply();

    uint256 quorumRequired = (totalSupply * QUORUM_BPS) / BPS_DENOMINATOR;
    uint256 totalVotes = yesVotes + noVotes;

    approved = (totalVotes >= quorumRequired) && (yesVotes > noVotes);
}

/**
 * @notice Computes the exact voting weight for a given user.
 * @dev    Currently acts as a pass-through for SHIELD balances. Centralized here to allow future 
 * complex weight calculations (e.g., quadratic voting) without altering the ClaimsGovernor.
 * @param  pastVotes     User's token balance at the established snapshot block.
 * @return weight        The final calculated voting power.
 */

function computeVoteWeight(uint256 pastVotes) external pure returns (uint256 weight) {
    return pastVotes;
}

}