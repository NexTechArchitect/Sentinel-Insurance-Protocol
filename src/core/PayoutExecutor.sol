// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IPayoutExecutor}  from "../interfaces/IPayoutExecutor.sol";
import {IClaimsGovernor}  from "../interfaces/IClaimsGovernor.sol";
import {IPolicyEngine}    from "../interfaces/IPolicyEngine.sol";
import {ICoveragePool}    from "../interfaces/ICoveragePool.sol";
import {ReentrancyGuard}  from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Ownable2Step, Ownable} from "@openzeppelin/contracts/access/Ownable2Step.sol";

/**
 * @title  PayoutExecutor
 * @author NexTechArchitect
 * @notice Single-purpose execution contract for the SentinelShield protocol.
 * @dev    Acts as the exclusive entity authorized to withdraw USDC from the CoveragePool for claim settlements.
 */
contract PayoutExecutor is IPayoutExecutor, ReentrancyGuard, Ownable2Step {

    // -------------------------------------------------------
    //  Immutables
    // -------------------------------------------------------

    /// @notice The central governance contract dictating claim approvals and protocol rules.
    IClaimsGovernor public immutable i_claimsGovernor;

    /// @notice The policy registry storing policyholder and coverage data.
    IPolicyEngine public immutable i_policyEngine;

    /// @notice The liquidity vault managing the actual USDC assests.
    ICoveragePool   public immutable i_pool;

    // -------------------------------------------------------
    //  Errors
    // -------------------------------------------------------

    error PayoutExecutor__ZeroAddress();

    // -------------------------------------------------------
    //  Constructor
    // -------------------------------------------------------

    /**
     * @notice Initializes the PayoutExecutor with core protocol dependencies.
     * @param claimsGovernor Address of the ClaimsGovernor.
     * @param policyEngine   Address of the PolicyEngine.
     * @param pool           Address of the CoveragePool.
     */
    constructor(
        address claimsGovernor,
        address policyEngine,
        address pool
    ) Ownable(msg.sender) {
        if (
            claimsGovernor == address(0) ||
            policyEngine   == address(0) ||
            pool           == address(0)
        ) revert PayoutExecutor__ZeroAddress();

        i_claimsGovernor = IClaimsGovernor(claimsGovernor);
        i_policyEngine   = IPolicyEngine(policyEngine);
        i_pool           = ICoveragePool(pool);
    }

    // -------------------------------------------------------
    //  External State-Changing Operations
    // -------------------------------------------------------
    /**
     * @notice Executes the final USDC payout for a formally APPROVED claim.
     * @dev    Callable by any external actor (Keeper pattern). 
     * Applies CEI by marking the claim as EXECUTED in the governor before triggering the pool withdrawal.
     * @param  claimId Unique identifier of the approved claim to settle.
     */
     function executePayout(uint256 claimId) external nonReentrant{
        IClaimsGovernor.Claim memory claim = i_claimsGovernor.getClaim(claimId);

       if (claim.status != IClaimsGovernor.ClaimStatus.APPROVED) {
            revert IPayoutExecutor__ClaimNotApproved(claimId);
        }

        IPolicyEngine.Policy memory policy = i_policyEngine.getPolicy(claim.policyId);

        address recipient = policy.holder;
        uint256 amount = policy.coverageAmount;

        if(recipient == address(0)) revert PayoutExecutor__ZeroAddress();

        uint256 locked = i_pool.lockedCoverageOf(claim.policyId);
        if (amount > locked) {
                   revert IPayoutExecutor__PolicyMismatch(claimId, claim.policyId);
        }

        i_claimsGovernor.markExecuted(claimId);

        i_pool.executePayout(claim.policyId, recipient, amount);

        emit PayoutExecuted(
            claimId,
            claim.policyId,
            recipient,
            amount,
            block.timestamp
        );
     }  

    // -------------------------------------------------------
    //  View Functions
    // -------------------------------------------------------

    /**
     * @notice Checks if a specific claim has already been successfully paid out.
     * @param  claimId Unique identifier of the claim.
     * @return True if the claim status is EXECUTED.
     */
    function isPayoutComplete(uint256 claimId)
        external
        view
        returns (bool)
    {
        IClaimsGovernor.Claim memory claim = i_claimsGovernor.getClaim(claimId);
        return claim.status == IClaimsGovernor.ClaimStatus.EXECUTED;
    }

    /**
     * @notice Previews the recipient address and payout amount for a given claim.
     * @param  claimId Unique identifier of the claim.
     * @return recipient Address scheduled to receive the payout.
     * @return amount    The payout amount in USDC (6 decimals).
     */
    function previewPayout(uint256 claimId)
        external
        view
        returns (address recipient, uint256 amount)
    {
        IClaimsGovernor.Claim memory claim  = i_claimsGovernor.getClaim(claimId);
        IPolicyEngine.Policy  memory policy = i_policyEngine.getPolicy(claim.policyId);

        recipient = policy.holder;
        amount    = policy.coverageAmount;
    }
}

