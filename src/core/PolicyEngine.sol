// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IPolicyEngine}    from "../interfaces/IPolicyEngine.sol";
import {IRiskRegistry}    from "../interfaces/IRiskRegistry.sol";
import {ICoveragePool}    from "../interfaces/ICoveragePool.sol";
import {IERC20}           from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20}        from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard}  from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Ownable2Step, Ownable} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {Pausable}         from "@openzeppelin/contracts/utils/Pausable.sol";
import {PremiumMath}      from "../libraries/PremiumMath.sol";
import {IClaimsGovernor}  from "../interfaces/IClaimsGovernor.sol";
import {PolicyNFT}        from "../token/PolicyNFT.sol";

/**
 * @title  PolicyEngine
 * @notice Central hub for purchasing, managing, and tracking SentinelShield insurance policies.
 * @dev    Coordinates interactions between the RiskRegistry (eligibility/pricing parameters) 
 * and the CoveragePool (liquidity locking/premium routing).
 */
contract PolicyEngine is IPolicyEngine, ReentrancyGuard, Ownable2Step, Pausable {
    using SafeERC20 for IERC20;

    // -------------------------------------------------------
    //  Immutables & State
    // -------------------------------------------------------

    IERC20          public immutable i_usdc;
    IRiskRegistry   public immutable i_registry;
    ICoveragePool   public immutable i_pool;
    PolicyNFT       public immutable i_policyNFT;

    address private s_claimsGovernor;
    bool    private s_governorSet;

    uint256 public constant MIN_COVERAGE = 100e6;
    uint256 public constant MAX_COVERAGE = 1_000_000e6;

    uint256 private s_totalPolicies;
    mapping(uint256 => Policy) private s_policies;
    mapping(address => uint256) private s_protocolExposure;
    mapping(address => uint256) private s_pendingRefund;

    // -------------------------------------------------------
    //  Errors & Events
    // -------------------------------------------------------

    error PolicyEngine__GovernorAlreadySet();
    error PolicyEngine__ZeroAddress();
    error PolicyEngine__CoverageBelowMinimum(uint256 amount, uint256 minimum);
    error PolicyEngine__CoverageAboveMaximum(uint256 amount, uint256 maximum);
    error PolicyEngine__OnlyClaimsGovernor(address caller);

    event RefundClaimed(address indexed user, uint256 amount);
    event ClaimsGovernorSet(address indexed governor);

    // -------------------------------------------------------
    //  Constructor & Configuration
    // -------------------------------------------------------

    /**
     * @notice Initializes the PolicyEngine and connects external dependencies.
     * @param  usdc      Address of the underlying stablecoin (e.g., USDC).
     * @param  registry  Address of the RiskRegistry contract.
     * @param  pool      Address of the CoveragePool contract.
     * @param  policyNFT Address of the PolicyNFT contract.
     */
    constructor(
        address usdc,
        address registry,
        address pool,
        address policyNFT
    ) Ownable(msg.sender) {
        if (usdc == address(0) || registry == address(0) || pool == address(0) || policyNFT == address(0)) {
            revert PolicyEngine__ZeroAddress();
        }

        i_usdc      = IERC20(usdc);
        i_registry  = IRiskRegistry(registry);
        i_pool      = ICoveragePool(pool);
        i_policyNFT = PolicyNFT(policyNFT);
    }

    /**
     * @notice Configures the designated ClaimsGovernor contract.
     * @dev    Restricted to the owner. Can only be set once to maintain trustlessness.
     * @param  governor Address of the ClaimsGovernor.
     */
    function setClaimsGovernor(address governor) external onlyOwner {
        if (s_governorSet)            revert PolicyEngine__GovernorAlreadySet();
        if (governor == address(0))   revert PolicyEngine__ZeroAddress();
        
        s_governorSet    = true;
        s_claimsGovernor = governor;
        emit ClaimsGovernorSet(governor);
    }

    modifier onlyClaimsGovernor() {
        if (msg.sender != s_claimsGovernor) revert PolicyEngine__OnlyClaimsGovernor(msg.sender);
        _;
    }

    // -------------------------------------------------------
    //  Core State-Changing Operations
    // -------------------------------------------------------

    /**
     * @notice Purchases a new insurance policy for a specified protocol.
     * @dev    The `payable` modifier is used strictly to bypass EVM's `msg.value == 0` validation, 
     * saving gas. Actual premium is transferred via ERC20 pull.
     * @param  protocol       The target protocol to be insured.
     * @param  coverageAmount The maximum USDC compensation requested.
     * @param  duration       The length of the policy in seconds.
     * @return policyId       The newly generated ID assigned to the policy.
     */
    function buyPolicy(
        address protocol,
        uint256 coverageAmount,
        uint256 duration
    )
        external
        payable
        nonReentrant
        whenNotPaused
        returns (uint256 policyId)
    {
        if (msg.value != 0) revert IPolicyEngine__IncorrectPremiumAmount(0, msg.value);
        if (!i_registry.isEligibleForCoverage(protocol)) revert IPolicyEngine__ProtocolNotEligible(protocol);
        
        if (coverageAmount < MIN_COVERAGE) revert PolicyEngine__CoverageBelowMinimum(coverageAmount, MIN_COVERAGE);
        if (coverageAmount > MAX_COVERAGE) revert PolicyEngine__CoverageAboveMaximum(coverageAmount, MAX_COVERAGE);

        if (duration < PremiumMath.MIN_DURATION || duration > PremiumMath.MAX_DURATION) {
            revert IPolicyEngine__InvalidDuration(duration);
        }

        uint256 cap = i_registry.getCoverageCap(protocol);
        if (s_protocolExposure[protocol] + coverageAmount > cap) {
            revert IPolicyEngine__ProtocolCapExceeded(protocol);
        }

        uint256 freeLiq = i_pool.freeLiquidity();
        if (coverageAmount > freeLiq) {
            revert IPolicyEngine__InsufficientPoolLiquidity(coverageAmount, freeLiq);
        }

        uint8 riskScore = i_registry.getRiskScore(protocol);
        bool audited = i_registry.getProtocolInfo(protocol).audited;
        uint256 premium = PremiumMath.calculatePremium(coverageAmount, riskScore, audited, duration);

        uint256 allowance = i_usdc.allowance(msg.sender, address(this));
        if (allowance < premium) revert IPolicyEngine__IncorrectPremiumAmount(premium, allowance);

        policyId = s_totalPolicies;
        unchecked { ++s_totalPolicies; }

        uint256 expiresAt = block.timestamp + duration;

        s_policies[policyId] = Policy({
            holder:         msg.sender,
            protocol:       protocol,
            coverageAmount: coverageAmount,
            premium:        premium,
            issuedAt:       block.timestamp,
            expiresAt:      expiresAt,
            status:         PolicyStatus.ACTIVE
        });

        s_protocolExposure[protocol] += coverageAmount;

        uint256 mintedId = i_policyNFT.mint(msg.sender, protocol, coverageAmount, expiresAt);
        require(mintedId == policyId, "Policy ID mismatch during NFT mint");
        
        i_usdc.safeTransferFrom(msg.sender, address(this), premium);
        
        i_usdc.forceApprove(address(i_pool), premium);
        i_pool.collectPremium(policyId, premium);
        i_pool.lockCoverage(policyId, protocol, coverageAmount);

        emit PolicyIssued(policyId, msg.sender, protocol, coverageAmount, premium, expiresAt);
    }

    /**
     * @notice Allows a policyholder to cancel their active policy prematurely and receive a pro-rated refund.
     * @dev    Refunds are credited to a pull-balance to mitigate reentrancy and DoS vectors.
     * @param  policyId The identifier of the policy being cancelled.
     */
    function cancelPolicy(uint256 policyId) external nonReentrant whenNotPaused {
        Policy storage p = s_policies[policyId];

        if (p.holder != msg.sender) revert IPolicyEngine__NotPolicyOwner(policyId, msg.sender);
        if (p.status != PolicyStatus.ACTIVE) revert IPolicyEngine__PolicyNotActive(policyId);

        if (s_claimsGovernor != address(0)) {
            uint256 claimId = IClaimsGovernor(s_claimsGovernor).claimForPolicy(policyId);
            if (claimId != 0) {
                IClaimsGovernor.Claim memory c = IClaimsGovernor(s_claimsGovernor).getClaim(claimId);
                if (c.status == IClaimsGovernor.ClaimStatus.PENDING) {
                    revert IPolicyEngine__ActiveClaimExists(policyId, claimId);
                }
            }
        }

        uint256 refund = PremiumMath.calculateRefund(p.premium, p.issuedAt, p.expiresAt, block.timestamp);

        p.status = PolicyStatus.CANCELLED;
        s_protocolExposure[p.protocol] -= p.coverageAmount;

        if (refund > 0) {
            s_pendingRefund[msg.sender] += refund;
        }

        i_pool.releaseCoverage(policyId);
        i_policyNFT.burn(policyId);

        emit PolicyCancelled(policyId, refund);
    }

    /**
     * @notice Safely lapses a policy that has surpassed its duration window, freeing locked collateral.
     * @dev    Acts as a public keeper function. Cannot be called if a claim is currently under review.
     * @param  policyId The identifier of the policy to expire.
     */
    function expirePolicy(uint256 policyId) external nonReentrant {
        Policy storage p = s_policies[policyId];

        if (p.status != PolicyStatus.ACTIVE) revert IPolicyEngine__PolicyNotActive(policyId);
        if (block.timestamp <= p.expiresAt) revert IPolicyEngine__PolicyNotExpired(policyId);

        if (s_claimsGovernor != address(0)) {
            uint256 claimId = IClaimsGovernor(s_claimsGovernor).claimForPolicy(policyId);
            if (claimId != 0) {
                IClaimsGovernor.Claim memory claim = IClaimsGovernor(s_claimsGovernor).getClaim(claimId);
                if (claim.status == IClaimsGovernor.ClaimStatus.PENDING) {
                    revert IPolicyEngine__ActiveClaimExists(policyId, claimId);
                }
            }
        }

        p.status = PolicyStatus.EXPIRED;
        s_protocolExposure[p.protocol] -= p.coverageAmount;

        i_pool.releaseCoverage(policyId);
        i_policyNFT.updateStatus(policyId, 1);

        emit PolicyExpired(policyId, block.timestamp);
    }

    /**
     * @notice Transitions a policy's state to CLAIMED.
     * @dev    Restricted to the ClaimsGovernor. Executed post-approval of a legitimate claim.
     * @param  policyId The identifier of the finalized policy.
     */
    function markClaimed(uint256 policyId) external onlyClaimsGovernor {
        Policy storage p = s_policies[policyId];
        if (p.status != PolicyStatus.ACTIVE) revert IPolicyEngine__PolicyNotActive(policyId);

        p.status = PolicyStatus.CLAIMED;
        s_protocolExposure[p.protocol] -= p.coverageAmount;

        i_policyNFT.updateStatus(policyId, 2);

        emit PolicyMarkedClaimed(policyId);
    }

    /**
     * @notice Allows users to pull their accrued refunds from cancelled policies.
     */
    function claimRefund() external nonReentrant whenNotPaused {
        uint256 amount = s_pendingRefund[msg.sender];
        if (amount == 0) return;

        s_pendingRefund[msg.sender] = 0;
        i_pool.refundPremium(msg.sender, amount);

        emit RefundClaimed(msg.sender, amount);
    }

    // -------------------------------------------------------
    //  View & Utility Functions
    // -------------------------------------------------------

    function getPolicy(uint256 policyId) external view returns (Policy memory) {
        return s_policies[policyId];
    }

    function quotePremium(address protocol, uint256 coverageAmount, uint256 duration) external view returns (uint256) {
        uint8 riskScore = i_registry.getRiskScore(protocol);
        bool audited = i_registry.getProtocolInfo(protocol).audited;
        return PremiumMath.calculatePremium(coverageAmount, riskScore, audited, duration);
    }

    function getProtocolExposure(address protocol) external view returns (uint256) {
        return s_protocolExposure[protocol];
    }

    function isPolicyActive(uint256 policyId) external view returns (bool) {
        Policy storage p = s_policies[policyId];
        return p.status == PolicyStatus.ACTIVE && block.timestamp <= p.expiresAt;
    }

    function totalPolicies() external view returns (uint256) {
        return s_totalPolicies;
    }

    function pendingRefund(address user) external view returns (uint256) {
        return s_pendingRefund[user];
    }

    // -------------------------------------------------------
    //  Emergency Controls
    // -------------------------------------------------------

    function pause() external onlyOwner { _pause(); }
    function unpause() external onlyOwner { _unpause(); }
}