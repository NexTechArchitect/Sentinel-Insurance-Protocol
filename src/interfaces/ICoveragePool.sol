// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title  ICoveragePool
 * @notice Interface for the SentinelShield treasury and yield engine.
 * @dev    Implements an ERC-4626 inspired vault tailored for Aave V3 integration.
 * Manages LP deposits, yield accrual, and policy-locked liquidity.
 */
interface ICoveragePool {
    
    // --------------------------------------------------------
    //  Errors
    // --------------------------------------------------------

    /// @notice Thrown when a deposit or action amount is zero.
    error ICoveragePool__ZeroDeposit();

    /// @notice Thrown when an LP attempts to withdraw more shares than they own.
    error ICoveragePool__InsufficientShares(uint256 requested, uint256 available);

    /// @notice Thrown when required coverage exceeds the available unlocked pool liquidity.
    error ICoveragePool__InsufficientFreeLiquidity(uint256 requested, uint256 available);

    /// @notice Thrown when a requested payout exceeds the collateral locked for the policy.
    error ICoveragePool__PayoutExceedsLocked(uint256 payout, uint256 locked);

    /// @notice Thrown when the caller lacks the required protocol role.
    error ICoveragePool__Unauthorized(address caller);

    /// @notice Thrown when a zero address is provided for a critical parameter.
    error ICoveragePool__ZeroAddress();

    /// @notice Thrown when an external interaction with the Aave protocol fails.
    error ICoveragePool__AaveInteractionFailed();

    /// @notice Thrown when operations are attempted while the pool is paused.
    error ICoveragePool__PoolPaused();

    // --------------------------------------------------------
    //  Events
    // --------------------------------------------------------

    /**
     * @notice Emitted when a liquidity provider deposits underlying assets.
     * @param lp           Address of the liquidity provider.
     * @param usdcAmount   Amount of underlying asset deposited (6 decimals).
     * @param sharesIssued Number of pool shares minted to the LP.
     */
    event LiquidityDeposited(address indexed lp, uint256 usdcAmount, uint256 sharesIssued);

    /**
     * @notice Emitted when a liquidity provider redeems shares for underlying assets.
     * @param lp           Address of the liquidity provider.
     * @param usdcReturned Amount of underlying asset transferred to the LP (6 decimals).
     * @param sharesBurned Number of pool shares destroyed.
     */
    event LiquidityWithdrawn(address indexed lp, uint256 usdcReturned, uint256 sharesBurned);

    /**
     * @notice Emitted when the PolicyEngine locks liquidity against a new policy.
     * @param policyId       Unique identifier of the issued policy.
     * @param protocol       Address of the covered protocol.
     * @param coverageAmount Amount of underlying asset locked (6 decimals).
     */
    event CoverageLocked(uint256 indexed policyId, address indexed protocol, uint256 coverageAmount);

    /**
     * @notice Emitted when locked liquidity is released back to the free pool.
     * @param policyId       Unique identifier of the expired or cancelled policy.
     * @param coverageAmount Amount of underlying asset unlocked (6 decimals).
     */
    event CoverageReleased(uint256 indexed policyId, uint256 coverageAmount);

    /**
     * @notice Emitted when an approved claim is successfully paid out.
     * @param policyId  Unique identifier of the claimed policy.
     * @param recipient Address receiving the payout.
     * @param amount    Amount of underlying asset transferred (6 decimals).
     */
    event ClaimPaid(uint256 indexed policyId, address indexed recipient, uint256 amount);

    /**
     * @notice Emitted when policy premiums are routed into the pool.
     * @param policyId      Unique identifier of the policy generating the premium.
     * @param premiumAmount Amount of underlying asset added to the pool (6 decimals).
     */
    event PremiumCollected(uint256 indexed policyId, uint256 premiumAmount);

    // --------------------------------------------------------
    //  LP Core Operations
    // --------------------------------------------------------

    /**
     * @notice Mints pool shares in exchange for depositing the underlying asset.
     * @dev    Deposits are automatically supplied to Aave V3. Share pricing follows ERC-4626 math.
     * @param  usdcAmount Amount of underlying asset to deposit (6 decimals).
     */
    function deposit(uint256 usdcAmount) external;

    /**
     * @notice Redeems pool shares for the underlying asset and accrued yield.
     * @dev    Reverts if the withdrawal cuts into locked liquidity.
     * @param  shares Number of pool shares to burn.
     */
    function withdraw(uint256 shares) external;

    // --------------------------------------------------------
    //  System State Operations
    // --------------------------------------------------------

    /**
     * @notice Reserves pool liquidity as collateral for a newly issued policy.
     * @dev    Restricted to PolicyEngine.
     * @param  policyId       Unique identifier of the policy.
     * @param  protocol       Address of the covered protocol.
     * @param  coverageAmount Amount of underlying asset to lock (6 decimals).
     */
    function lockCoverage(uint256 policyId, address protocol, uint256 coverageAmount) external;

    /**
     * @notice Unlocks collateral tied to an expired or cancelled policy.
     * @dev    Restricted to PolicyEngine. Restores locked assets to free liquidity.
     * @param  policyId Unique identifier of the policy to release.
     */
    function releaseCoverage(uint256 policyId) external;

    /**
     * @notice Executes a verified claim payout to a policyholder.
     * @dev    Restricted to PayoutExecutor. Withdraws directly from Aave to the recipient.
     * @param  policyId  Unique identifier of the approved policy.
     * @param  recipient Address of the policyholder.
     * @param  amount    Approved payout amount (6 decimals).
     */
    function executePayout(uint256 policyId, address recipient, uint256 amount) external;

    /**
     * @notice Accepts premium payments and deposits them into the yield strategy.
     * @dev    Restricted to PolicyEngine. Increases the global share price for LPs.
     * @param  policyId      Unique identifier of the policy.
     * @param  premiumAmount Premium collected (6 decimals).
     */
    function collectPremium(uint256 policyId, uint256 premiumAmount) external;

    /**
     * @notice Processes a premium refund for a cancelled policy.
     * @dev    Restricted to PolicyEngine. Pulls liquidity directly from Aave to the user.
     * @param  recipient Address of the user receiving the refund.
     * @param  amount    Refund amount (6 decimals).
     */
    function refundPremium(address recipient, uint256 amount) external;

    // --------------------------------------------------------
    //  View Functions
    // --------------------------------------------------------

    /**
     * @notice Returns the total underlying asset balance controlled by the pool.
     * @dev    Includes active deposits, accrued yield from Aave, and locked collateral.
     * @return Total liquidity in the underlying asset (6 decimals).
     */
    function totalLiquidity() external view returns (uint256);

    /**
     * @notice Returns the aggregate amount of underlying assets currently locked as collateral.
     * @return Total locked collateral (6 decimals).
     */
    function totalLockedLiquidity() external view returns (uint256);

    /**
     * @notice Returns the amount of underlying assets available for new policies or LP withdrawals.
     * @dev    Calculated as totalLiquidity - totalLockedLiquidity.
     * @return Available free liquidity (6 decimals).
     */
    function freeLiquidity() external view returns (uint256);

    /**
     * @notice Computes the current underlying asset value for a given amount of LP shares.
     * @param  shares Amount of LP shares.
     * @return Current underlying asset value (6 decimals).
     */
    function sharesToUsdc(uint256 shares) external view returns (uint256);

    /**
     * @notice Computes the amount of LP shares that would be minted for a given deposit.
     * @param  usdcAmount Amount of underlying asset (6 decimals).
     * @return Number of LP shares to be minted.
     */
    function usdcToShares(uint256 usdcAmount) external view returns (uint256);

    /**
     * @notice Returns the LP share balance for a specific address.
     * @param  lp Address of the liquidity provider.
     * @return Current share balance.
     */
    function sharesOf(address lp) external view returns (uint256);

    /**
     * @notice Returns the specific amount of underlying asset locked for a given policy.
     * @param  policyId Unique identifier of the policy.
     * @return Locked collateral amount (6 decimals).
     */
    function lockedCoverageOf(uint256 policyId) external view returns (uint256);
}