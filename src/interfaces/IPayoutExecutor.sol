// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

// ============================================================
//                     IPayoutExecutor
// ------------------------------------------------------------
//  The "Executioner" of SentinelShield.
//  After a claim is APPROVED by the DAO, this contract is called
//  to transfer the payout to the claimant. It interacts with CoveragePool to
//  withdraw the necessary USDC and send it to the policyholder's wallet.
// ============================================================

interface IPayoutExecutor {
  
    /// @notice Claim is not in APPROVED state — cannot execute.
    error IPayoutExecutor__ClaimNotApproved(uint256 claimId);

    /// @notice A payout for this claim is already in progress (reentrancy guard).
    error IPayoutExecutor__PayoutInFlight(uint256 claimId);

    /// @notice Policy linked to the claim has been altered unexpectedly (sanity check).
    error IPayoutExecutor__PolicyMismatch(uint256 claimId, uint256 policyId);

    /// @notice Pool does not have sufficient liquidity to cover the payout.
   
    error IPayoutExecutor__InsufficientPoolLiquidity(uint256 required, uint256 available);

    /// @notice Caller is not authorised to trigger a payout.
    /// @dev    Only used if implementation restricts to keeper/anyone — optional.
    error IPayoutExecutor__Unauthorized(address caller);

    // --------------------------------------------------------
    //  Events
    // --------------------------------------------------------

    /**
     * @notice A payout was successfully executed.
     * @param claimId    The claim that was resolved.
     * @param policyId   The associated policy.
     * @param recipient  The claimant's wallet that received USDC.
     * @param amount     USDC transferred.
     * @param executedAt Block timestamp of execution.
     */
    event PayoutExecuted(
        uint256 indexed claimId,
        uint256 indexed policyId,
        address indexed recipient,
        uint256 amount,
        uint256 executedAt
    );

    /**
     * @notice Payout was attempted but failed (e.g., pool had insufficient funds).
     * @dev    Emitted instead of reverting so the claim doesn't get stuck.
     *         Governance can investigate and retry or escalate.
     * @param claimId The claim that failed to pay out.
     * @param reason  Short encoded reason.
     */
    event PayoutFailed(uint256 indexed claimId, bytes reason);

    // --------------------------------------------------------
    //  Write Functions
    // --------------------------------------------------------

    /**
     * @notice Execute the payout for an APPROVED claim.
     *
     * @dev    This function is intentionally callable by anyone (keeper pattern).
     *         There is no privilege in triggering a payout — the claim has already
     *         been democratically approved. The caller earns no bonus; they just
     *         advance the protocol state.
     *         Emits PayoutExecuted on success.
     *         Emits PayoutFailed (does NOT revert) if CoveragePool call fails,
     *         so the claim doesn't get permanently stuck.
     *
     * @param claimId The approved claim to pay out.
     */
    function executePayout(uint256 claimId) external;

    // --------------------------------------------------------
    //  View Functions
    // --------------------------------------------------------

    /**
     * @notice Check whether a payout has already been executed for a claim.
     * @dev    Reads ClaimsGovernor status — EXECUTED means payout is done.
     * @param claimId The claim to check.
     * @return True if payout was successfully completed.
     */
    function isPayoutComplete(uint256 claimId) external view returns (bool);

    /**
     * @notice Preview the payout amount for an approved claim (before execution).
     * @dev    Reads PolicyEngine for coverageAmount — useful for keepers/UI.
     * @param claimId Claim to preview.
     * @return recipient  The policyholder who will receive USDC.
     * @return amount     USDC that will be transferred.
     */
    function previewPayout(uint256 claimId)
        external
        view
        returns (address recipient, uint256 amount);
}
