// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

// ============================================================
//                     IClaimsGovernor
// ------------------------------------------------------------
//  The "Judge" of SentinelShield.
//
//  When an exploit happens, the holder of a valid policy comes
//  here to file a claim. What follows is a 7-day governance
//  window where SHIELD token holders vote on validity.
// ============================================================

interface IClaimsGovernor {
 
    /// @notice Policy does not exist or is not in ACTIVE state.
    error IClaimsGovernor__PolicyNotClaimable(uint256 policyId);

    /// @notice A claim already exists for this policy.
    error IClaimsGovernor__ClaimAlreadyExists(uint256 policyId);

    /// @notice Voting window has not started or has already closed.
    error IClaimsGovernor__VotingWindowClosed(uint256 claimId);

    /// @notice This address already voted on this claim.
    error IClaimsGovernor__AlreadyVoted(uint256 claimId, address voter);

    /// @notice Voter had zero SHIELD tokens at the snapshot block.
    error IClaimsGovernor__NoVotingPower(address voter);

    /// @notice Claim is not in a state that allows finalization.
    error IClaimsGovernor__CannotFinalize(uint256 claimId);

    /// @notice VetoCouncil attempted to veto a claim that isn't PENDING or APPROVED.
    error IClaimsGovernor__CannotVeto(uint256 claimId);

    /// @notice Caller is not the VetoCouncil.
    error IClaimsGovernor__NotVetoCouncil(address caller);

    /// @notice Caller did not file the claim (for claimant-only actions).
    error IClaimsGovernor__NotClaimant(uint256 claimId, address caller);

    // --------------------------------------------------------
    //  Events
    // --------------------------------------------------------

    /**
     * @notice A new claim was filed and voting has begun.
     * @param claimId       Unique claim identifier.
     * @param policyId      The policy backing the claim.
     * @param claimant      The policyholder filing the claim.
     * @param protocol      Protocol that was allegedly exploited.
     * @param evidenceUri   IPFS URI (or arweave) of exploit evidence.
     * @param votingEndsAt  Timestamp when the 7-day window closes.
     */
    event ClaimFiled(
        uint256 indexed claimId,
        uint256 indexed policyId,
        address indexed claimant,
        address protocol,
        string evidenceUri,
        uint256 votingEndsAt
    );

    /**
     * @notice A SHIELD token holder cast a vote on a claim.
     * @param claimId    The claim voted on.
     * @param voter      The voter's address.
     * @param support    True = YES (approve claim), False = NO (reject).
     * @param weight     Voting power used (SHIELD balance at snapshot).
     */
    event VoteCast(
        uint256 indexed claimId,
        address indexed voter,
        bool support,
        uint256 weight
    );

    /**
     * @notice Voting window closed and claim was approved — payout queued.
     * @param claimId   The approved claim.
     * @param yesVotes  Total YES voting weight.
     * @param noVotes   Total NO voting weight.
     */
    event ClaimApproved(uint256 indexed claimId, uint256 yesVotes, uint256 noVotes);

    /**
     * @notice Voting window closed and claim was rejected — no payout.
     * @param claimId  The rejected claim.
     * @param yesVotes Total YES voting weight.
     * @param noVotes  Total NO voting weight.
     */
    event ClaimRejected(uint256 indexed claimId, uint256 yesVotes, uint256 noVotes);

    /**
     * @notice VetoCouncil cancelled a claim before payout.
     * @param claimId The vetoed claim.
     * @param reason  Human-readable veto reason (stored as event, not storage).
     */
    event ClaimVetoed(uint256 indexed claimId, string reason);

    // --------------------------------------------------------
    //  Data Structures
    // --------------------------------------------------------

    /// @notice All possible states of a claim.
    enum ClaimStatus {
        PENDING,   // Filed, voting in progress
        APPROVED,  // Passed vote, awaiting PayoutExecutor
        REJECTED,  // Failed quorum or majority was NO
        VETOED,    // VetoCouncil intervened
        EXECUTED   // PayoutExecutor confirmed payout complete
    }

    /**
     * @notice Full on-chain record of a filed claim.
     *
     * @param policyId        The insured policy.
     * @param claimant        Policyholder who filed.
     * @param protocol        Protocol alleged to have been exploited.
     * @param evidenceUri     Off-chain evidence pointer (IPFS/Arweave).
     * @param snapshotBlock   Block at which SHIELD balances are snapshotted for voting.
     * @param votingEndsAt    Unix timestamp when voting closes.
     * @param yesVotes        Accumulated YES voting weight.
     * @param noVotes         Accumulated NO voting weight.
     * @param status          Current claim lifecycle state.
     */
    struct Claim {
        uint256     policyId;
        address     claimant;
        address     protocol;
        string      evidenceUri;
        uint256     snapshotBlock;
        uint256     votingEndsAt;
        uint256     yesVotes;
        uint256     noVotes;
        ClaimStatus status;
    }

    // --------------------------------------------------------
    //  Write Functions
    // --------------------------------------------------------

    /**
     * @notice File a claim against an active policy.
     * @param policyId    The policy to claim against.
     * @param evidenceUri IPFS/Arweave URI of exploit evidence.
     * @return claimId    Unique ID for the newly filed claim.
     */
    function fileClaim(
        uint256 policyId,
        string calldata evidenceUri
    ) external returns (uint256 claimId);

    /**
     * @notice Cast a vote on a pending claim.
     * @param claimId The claim to vote on.
     * @param support True = approve, False = reject.
     */
    function castVote(uint256 claimId, bool support) external;

    /**
     * @notice Finalize a claim after the voting window closes.
     *
     * @dev    Anyone can call this — it's a keeper function.
     * @param claimId The claim to finalize.
     */
    function finalizeClaim(uint256 claimId) external;

    /**
     * @notice VetoCouncil veto — cancels an approved OR pending claim.
     * @param claimId The claim to veto.
     * @param reason  Human-readable reason — stored as event data only.
     */
    function vetoClaim(uint256 claimId, string calldata reason) external;

    /**
     * @notice Mark a claim as EXECUTED — callable only by PayoutExecutor.
     *
     * @dev    Called after PayoutExecutor successfully sends USDC to claimant.
     *         CEI: check caller, check status == APPROVED, set status = EXECUTED.
     *
     * @param claimId The claim that has been fully paid out.
     */
    function markExecuted(uint256 claimId) external;

    // --------------------------------------------------------
    //  View Functions
    // --------------------------------------------------------

    /**
     * @notice Get full claim details.
     * @param claimId Claim to query.
     * @return claim  Complete Claim struct.
     */
    function getClaim(uint256 claimId) external view returns (Claim memory claim);

    /**
     * @notice Check whether an address has voted on a claim.
     * @param claimId The claim.
     * @param voter   The address to check.
     * @return True if already voted.
     */
    function hasVoted(uint256 claimId, address voter) external view returns (bool);

    /**
     * @notice Current claim ID associated with a policy (0 if none).
     * @param policyId The policy to check.
     * @return claimId The associated claim ID, or 0 if no claim exists.
     */
    function claimForPolicy(uint256 policyId)
        external
        view
        returns (uint256 claimId);

    /**
     * @notice Total claims ever filed (monotonically increasing).
     * @return count All-time claim count.
     */
    function totalClaims() external view returns (uint256 count);
}
