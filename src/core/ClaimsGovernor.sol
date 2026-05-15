// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IClaimsGovernor}  from "../interfaces/IClaimsGovernor.sol";
import {IPolicyEngine}    from "../interfaces/IPolicyEngine.sol";
import {ICoveragePool}    from "../interfaces/ICoveragePool.sol";
import {ReentrancyGuard}  from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Ownable2Step, Ownable} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {Pausable}         from "@openzeppelin/contracts/utils/Pausable.sol";
import {ClaimValidator}   from "../libraries/ClaimValidator.sol";
import {ShieldToken}      from "../governance/ShieldToken.sol";

/**
 * @title  ClaimsGovernor
 * @author NexTechArchitect
 * @notice The decentralized adjudication engine for the SentinelShield protocol.
 * @dev    Handles the entire claims lifecycle via snapshot-based governance voting.
 * Protects against same-block flash-loan and post-incident vote manipulation
 * by enforcing historical checkpoint queries (`block.number - 1`).
 */
contract ClaimsGovernor is IClaimsGovernor, ReentrancyGuard, Ownable2Step, Pausable {

    // -------------------------------------------------------
    //  Immutables
    // -------------------------------------------------------

    /** @notice The Governance Token used to calculate voting power snapshots. */
    ShieldToken     public immutable i_shieldToken;
    
    /** @notice The core engine registry processing policy parameters. */
    IPolicyEngine   public immutable i_policyEngine;
    
    /** @notice The underlying underwriting asset pool vault. */
    ICoveragePool   public immutable i_pool;

    // -------------------------------------------------------
    //  Access Control & System Architecture Roles
    // -------------------------------------------------------

    /** @dev Multisig safety valve address authorized to discard fraudulent claims. */
    address private s_vetoCouncil;
    
    /** @dev Authorized automated context handler/keeper to trigger payouts. */
    address private s_payoutExecutor;
    
    /** @dev Configuration locks ensuring roles are configured only once. */
    bool    private s_vetoSet;
    bool    private s_executorSet;

    // -------------------------------------------------------
    //  Governance Configuration
    // -------------------------------------------------------

    /** @notice Length of the active phase in seconds where votes are accepted. */
    uint256 public s_votingPeriod;

    // -------------------------------------------------------
    //  State Variables (Private Encapsulation)
    // -------------------------------------------------------

    /** @dev Internal ledger mapping: claimId => Claim structural criteria. */
    mapping(uint256 => Claim) private s_claims;
    
    /** @dev Integrity mapping ensuring single claim submission per policy: policyId => claimId. */
    mapping(uint256 => uint256) private s_policyToClaim;
    
    /** @dev Double-voting protection registry: claimId => voterAddress => hasVoted. */
    mapping(uint256 => mapping(address => bool)) private s_hasVoted;
    
    /** @dev Global sequential tracking index for total claims filed. */
    uint256 private s_totalClaims;

    // -------------------------------------------------------
    //  Custom Errors & Events
    // -------------------------------------------------------

    error ClaimsGovernor__VetoCouncilAlreadySet();
    error ClaimsGovernor__ExecutorAlreadySet();
    error ClaimsGovernor__ZeroAddress();
    error ClaimsGovernor__VotingPeriodInvalid();
    error ClaimsGovernor__OnlyPayoutExecutor(address caller);

    event VetoCouncilSet(address indexed vetoCouncil);
    event PayoutExecutorSet(address indexed executor);
    event VotingPeriodUpdated(uint256 newPeriod);

    // -------------------------------------------------------
    //  Constructor
    // -------------------------------------------------------

    /**
     * @notice Initializes dependencies, verifies inputs, and defines base configurations.
     * @param  shieldToken   The address of the governance $SHIELD ERC20 token.
     * @param  policyEngine  The central system router processing policies.
     * @param  pool          The underwriting capital deployment vault.
     * @param  votingPeriod  The default baseline window for active votes (3 to 14 days).
     */
    constructor(
        address shieldToken,
        address policyEngine,
        address pool,
        uint256 votingPeriod
    ) Ownable(msg.sender) {
        if (
            shieldToken   == address(0) ||
            policyEngine  == address(0) ||
            pool          == address(0)
        ) revert ClaimsGovernor__ZeroAddress();

        if (votingPeriod < ClaimValidator.MIN_VOTING_PERIOD || votingPeriod > ClaimValidator.MAX_VOTING_PERIOD) {
            revert ClaimsGovernor__VotingPeriodInvalid();
        }

        i_shieldToken   = ShieldToken(shieldToken);
        i_policyEngine  = IPolicyEngine(policyEngine);
        i_pool          = ICoveragePool(pool);
        s_votingPeriod  = votingPeriod;
    }

    // -------------------------------------------------------
    //  System Infrastructure Configuration (Only Owner Roles)
    // -------------------------------------------------------

    /**
     * @notice Attaches the Veto Council multisig configuration to the adjudication cycle.
     * @dev    Enforces a strict one-time initialization invariant.
     * @param  vetoCouncil The address of the deployed VetoCouncil contract.
     */
    function setVetoCouncil(address vetoCouncil) external onlyOwner {
        if (s_vetoSet)                 revert ClaimsGovernor__VetoCouncilAlreadySet();
        if (vetoCouncil == address(0)) revert ClaimsGovernor__ZeroAddress();
        s_vetoSet      = true;
        s_vetoCouncil  = vetoCouncil;
        emit VetoCouncilSet(vetoCouncil);
    }

    /**
     * @notice Authorizes the designated payout pipeline runtime router.
     * @dev    Enforces a strict one-time initialization invariant.
     * @param  executor The address of the deployed PayoutExecutor contract.
     */
    function setPayoutExecutor(address executor) external onlyOwner {
        if (s_executorSet)          revert ClaimsGovernor__ExecutorAlreadySet();
        if (executor == address(0)) revert ClaimsGovernor__ZeroAddress();
        s_executorSet    = true;
        s_payoutExecutor = executor;
        emit PayoutExecutorSet(executor);
    }

    // -------------------------------------------------------
    //  System Access Control Restrictions
    // -------------------------------------------------------

    modifier onlyVetoCouncil() {
        if (msg.sender != s_vetoCouncil) {
            revert IClaimsGovernor__NotVetoCouncil(msg.sender);
        }
        _;
    }

    modifier onlyPayoutExecutor() {
        if (msg.sender != s_payoutExecutor) {
            revert ClaimsGovernor__OnlyPayoutExecutor(msg.sender);
        }
        _;
    }

    // -------------------------------------------------------
    //  Core External Adjudication Operations
    // -------------------------------------------------------

    /**
     * @notice Files a formal claim submission against an exploit event for a valid policy.
     * @dev    Uses the Checkpoints ledger (`block.number - 1`) to take an immutable snapshot.
     * Enforces Check-Effects-Interactions (CEI) to block malicious reentrancy vectors.
     * @param  policyId    The unique database sequence index of the target active policy.
     * @param  evidenceUri Cryptographic identifier or decentralized URI (IPFS/Arweave) holding proof.
     * @return claimId     The unique autoincremented index assigned to the newly active claim file.
     */
    function fileClaim(
        uint256 policyId,
        string calldata evidenceUri
    )
        external
        nonReentrant
        whenNotPaused
        returns (uint256 claimId)
    {
        ClaimValidator.validateEvidence(evidenceUri);

        if (s_policyToClaim[policyId] != 0) {
            revert IClaimsGovernor__ClaimAlreadyExists(policyId);
        }

        IPolicyEngine.Policy memory policy = i_policyEngine.getPolicy(policyId);

        ClaimValidator.validateClaimEligibility(
            uint8(uint256(policy.status)),
            policy.holder,
            msg.sender,
            policy.expiresAt,
            block.timestamp
        );

        claimId = s_totalClaims + 1; 
        unchecked { ++s_totalClaims; }

        uint256 votingEndsAt = block.timestamp + s_votingPeriod;

        s_claims[claimId] = Claim({
            policyId:      policyId,
            claimant:      msg.sender,
            protocol:      policy.protocol,
            evidenceUri:   evidenceUri,
            snapshotBlock: block.number - 1, 
            votingEndsAt:  votingEndsAt,
            yesVotes:      0,
            noVotes:       0,
            status:        ClaimStatus.PENDING
        });

        s_policyToClaim[policyId] = claimId;

        emit ClaimFiled(
            claimId,
            policyId,
            msg.sender,
            policy.protocol,
            evidenceUri,
            votingEndsAt
        );
    }

    /**
     * @notice Records token-weighted consensus voting parameters from an external actor.
     * @dev    Queries the historical checkpoint snapshot balance to neutralize flash-loan vectors.
     * @param  claimId Unique database reference of the active target claim file.
     * @param  support True values increment the affirmative ledger, False values stack opposition weight.
     */
    function castVote(uint256 claimId, bool support)
        external
        nonReentrant
        whenNotPaused
    {
        Claim storage c = s_claims[claimId];

        if (c.status != ClaimStatus.PENDING || block.timestamp >= c.votingEndsAt) {
            revert IClaimsGovernor__VotingWindowClosed(claimId);
        }
        if (s_hasVoted[claimId][msg.sender]) {
            revert IClaimsGovernor__AlreadyVoted(claimId, msg.sender);
        }

        uint256 weight = ClaimValidator.computeVoteWeight(
            i_shieldToken.getPastVotes(msg.sender, c.snapshotBlock)
        );
        if (weight == 0) revert IClaimsGovernor__NoVotingPower(msg.sender);

        s_hasVoted[claimId][msg.sender] = true;

        if (support) {
            c.yesVotes += weight;
        } else {
            c.noVotes  += weight;
        }

        emit VoteCast(claimId, msg.sender, support, weight);
    }

    /**
     * @notice Resolves a completed vote cycle, assessing quorum rules and majority consensus weights.
     * @dev    Public keeper activation. Mutates internal criteria before routing state to external dependencies.
     * @param  claimId Unique index pointer of the concluded claim processing block.
     */
    function finalizeClaim(uint256 claimId) external nonReentrant {
        Claim storage c = s_claims[claimId];

        if (c.status != ClaimStatus.PENDING || block.timestamp < c.votingEndsAt) {
            revert IClaimsGovernor__CannotFinalize(claimId);
        }

        uint256 totalSupply = i_shieldToken.totalSupply();
        bool approved = ClaimValidator.isClaimApproved(
            c.yesVotes,
            c.noVotes,
            totalSupply
        );

        if (approved) {
            c.status = ClaimStatus.APPROVED;
            i_policyEngine.markClaimed(c.policyId);
            emit ClaimApproved(claimId, c.yesVotes, c.noVotes);
        } else {
            c.status = ClaimStatus.REJECTED;
            emit ClaimRejected(claimId, c.yesVotes, c.noVotes);
        }
    }

    /**
     * @notice Unilaterally enforces a structural emergency veto to cancel invalid or fraudulent claims.
     * @dev    Restricted exclusively to the authorized active VetoCouncil multisig engine.
     * @param  claimId Unique structural pointer targeting the under-review claim file.
     * @param  reason  String literal containing documentation justifying the administrative intervention.
     */
    function vetoClaim(uint256 claimId, string calldata reason)
        external
        nonReentrant
        onlyVetoCouncil
    {
        Claim storage c = s_claims[claimId];

        if (c.status != ClaimStatus.PENDING) {
            revert IClaimsGovernor__CannotVeto(claimId);
        }

        c.status = ClaimStatus.VETOED;

        emit ClaimVetoed(claimId, reason);
    }

    /**
     * @notice Internal validation bridge shifting state criteria to EXECUTED upon vault payout release.
     * @dev    Restricted strictly to the PayoutExecutor to prevent systemic sync vulnerabilities.
     * @param  claimId Target identification pointer processing state advancement.
     */
    function markExecuted(uint256 claimId) external onlyPayoutExecutor {
        Claim storage c = s_claims[claimId];

        if (c.status != ClaimStatus.APPROVED) {
            revert IClaimsGovernor__CannotFinalize(claimId);
        }

        c.status = ClaimStatus.EXECUTED;
    }

    // -------------------------------------------------------
    //  Administrative Maintenance Parameters (Only Owner)
    // -------------------------------------------------------

    /**
     * @notice Calibrates the baseline lifecycle window required for future consensus voting configurations.
     * @param  newPeriod Total requested length in seconds (Strict limit bound within 3 to 14 days).
     */
    function setVotingPeriod(uint256 newPeriod) external onlyOwner {
        if (newPeriod < ClaimValidator.MIN_VOTING_PERIOD || newPeriod > ClaimValidator.MAX_VOTING_PERIOD) {
            revert ClaimsGovernor__VotingPeriodInvalid();
        }
        s_votingPeriod = newPeriod;
        emit VotingPeriodUpdated(newPeriod);
    }

    /** @notice Global Emergency Pause — halts new claims filing and voting mechanics. */
    function pause()   external onlyOwner { _pause();   }
    
    /** @notice Resumes full autonomous system operations. */
    function unpause() external onlyOwner { _unpause(); }

    // -------------------------------------------------------
    //  Public View & Query Routines
    // -------------------------------------------------------

    function getClaim(uint256 claimId) external view returns (Claim memory) {
        return s_claims[claimId];
    }

    function hasVoted(uint256 claimId, address voter) external view returns (bool) {
        return s_hasVoted[claimId][voter];
    }

    function claimForPolicy(uint256 policyId) external view returns (uint256 claimId) {
        return s_policyToClaim[policyId];
    }

    function totalClaims() external view returns (uint256) {
        return s_totalClaims;
    }
}