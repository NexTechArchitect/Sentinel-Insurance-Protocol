// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ICoveragePool}              from "../interfaces/ICoveragePool.sol";
import {ERC4626}                    from "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";
import {ERC20}                      from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20}                     from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20}                  from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard}            from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Ownable2Step, Ownable}      from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {Pausable}                   from "@openzeppelin/contracts/utils/Pausable.sol";
import {Math}                       from "@openzeppelin/contracts/utils/math/Math.sol";
import {IPool}                      from "@aave/core-v3/contracts/interfaces/IPool.sol";
import {IAToken}                    from "@aave/core-v3/contracts/interfaces/IAToken.sol";

/**
 * @title  CoveragePool
 * @author NexTechArchitect
 * @notice ERC-4626 compliant liquidity vault for the SentinelShield protocol.
 * @dev    Seamlessly integrates with Aave V3 for automated yield generation.
 * Share pricing and inflation attack mitigations are handled via OpenZeppelin's ERC-4626 base,
 * optimized for 6-decimal underlying assets (USDC) via the _decimalsOffset hook.
 * CEI and Reentrancy guards are strictly enforced on all state-changing operations.
 */
contract CoveragePool is
    ICoveragePool,
    ERC4626,
    ReentrancyGuard,
    Ownable2Step,
    Pausable
{
    using SafeERC20 for IERC20;
    using Math for uint256;

    // -------------------------------------------------------
    //  Immutables
    // -------------------------------------------------------

    /// @notice The Aave V3 core lending pool interface.
    IPool   public immutable i_aavePool;

    /// @notice The Aave interest-bearing token representing supplied underlying assets.
    IAToken public immutable i_aUsdc;

    // -------------------------------------------------------
    //  State Variables
    // -------------------------------------------------------

    /// @dev Address of the authorized PolicyEngine contract.
    address private s_policyEngine;

    /// @dev Address of the authorized PayoutExecutor contract.
    address private s_payoutExecutor;

    /// @dev Flag indicating if the PolicyEngine address has been permanently set.
    bool    private s_engineSet;

    /// @dev Flag indicating if the PayoutExecutor address has been permanently set.
    bool    private s_executorSet;

    /// @dev Aggregate amount of underlying asset (USDC) locked against active policies.
    uint256 private s_totalLocked;

    /// @dev Mapping of policy IDs to their specific locked collateral amounts.
    mapping(uint256 => uint256) private s_lockedCoverage;

    // -------------------------------------------------------
    //  Errors & Events (Events added for Slither fix)
    // -------------------------------------------------------

    /// @notice Thrown when attempting to set an already configured PolicyEngine.
    error CoveragePool__EngineAlreadySet();

    /// @notice Thrown when attempting to set an already configured PayoutExecutor.
    error CoveragePool__ExecutorAlreadySet();

    /// @notice Thrown when a zero address is provided during initialization or setup.
    error CoveragePool__ZeroAddress();

    /// @notice Thrown when operations are attempted while the pool is paused.
    error CoveragePool__PoolPaused();

    event PolicyEngineSet(address indexed engine);
    event PayoutExecutorSet(address indexed executor);

    // -------------------------------------------------------
    //  Constructor
    // -------------------------------------------------------

    /**
     * @notice Initializes the ERC-4626 vault and Aave dependencies.
     * @param usdc     Address of the underlying asset (USDC, 6 decimals).
     * @param aavePool Address of the Aave V3 core lending pool.
     * @param aUsdc    Address of the corresponding Aave interest-bearing token.
     */
    constructor(address usdc, address aavePool, address aUsdc)
        ERC4626(IERC20(usdc))
        ERC20("SentinelShield LP", "ssUSDC")
        Ownable(msg.sender)
    {
        if (usdc == address(0) || aavePool == address(0) || aUsdc == address(0)) {
            revert CoveragePool__ZeroAddress();
        }
        i_aavePool = IPool(aavePool);
        i_aUsdc    = IAToken(aUsdc);
    }

    // -------------------------------------------------------
    //  System Setup
    // -------------------------------------------------------

    /**
     * @notice Configures the authorized PolicyEngine contract.
     * @dev    Restricted to contract owner. Can only be invoked once to ensure trustless operation.
     * @param  engine Address of the PolicyEngine.
     */
    function setPolicyEngine(address engine) external onlyOwner {
        if (s_engineSet)          revert CoveragePool__EngineAlreadySet();
        if (engine == address(0)) revert CoveragePool__ZeroAddress();
        s_engineSet    = true;
        s_policyEngine = engine;
        emit PolicyEngineSet(engine);
    }

    /**
     * @notice Configures the authorized PayoutExecutor contract.
     * @dev    Restricted to contract owner. Can only be invoked once.
     * @param  executor Address of the PayoutExecutor.
     */
    function setPayoutExecutor(address executor) external onlyOwner {
        if (s_executorSet)          revert CoveragePool__ExecutorAlreadySet();
        if (executor == address(0)) revert CoveragePool__ZeroAddress();
        s_executorSet    = true;
        s_payoutExecutor = executor;
        emit PayoutExecutorSet(executor);
    }

    // -------------------------------------------------------
    //  Modifiers
    // -------------------------------------------------------

    modifier onlyPolicyEngine() {
        if (msg.sender != s_policyEngine) revert ICoveragePool__Unauthorized(msg.sender);
        _;
    }

    modifier onlyPayoutExecutor() {
        if (msg.sender != s_payoutExecutor) revert ICoveragePool__Unauthorized(msg.sender);
        _;
    }

    // -------------------------------------------------------
    //  ERC-4626 Core Overrides
    // -------------------------------------------------------

    /**
     * @notice Mitigates inflation/donation attacks by offsetting share precision.
     * @dev    Crucial for low-decimal underlying assets like USDC (6 decimals).
     * Vault shares (ssUSDC) will natively scale to 12 decimals (6 asset + 6 offset).
     * @return Offset value mapped to 10^6 virtual shares.
     */
    function _decimalsOffset() internal pure override returns (uint8) {
        return 6;
    }

    /**
     * @notice Retrieves the live underlying asset balance.
     * @dev    Overrides standard ERC-4626 to query aUSDC directly, inherently capturing Aave yield.
     * @return Total underlying assets including accrued interest.
     */
    function totalAssets() public view override returns (uint256) {
        return i_aUsdc.balanceOf(address(this));
    }

    /**
     * @dev Internal hook invoked post-deposit. Approves and supplies assets directly to Aave V3.
     */
    function _deposit(
    address caller,
    address receiver,
    uint256 assets,
    uint256 shares
) internal override whenNotPaused {
    super._deposit(caller, receiver, assets, shares);

    IERC20(asset()).forceApprove(address(i_aavePool), assets);
    i_aavePool.supply(asset(), assets, address(this), 0);

    emit LiquidityDeposited(receiver, assets, shares);
}

    /**
     * @dev Internal hook invoked pre-withdrawal. Validates free liquidity and pulls assets from Aave V3.
     * Fix: Renamed parameter 'owner' to 'account' to prevent shadowing Ownable.owner()
     */
    function _withdraw(
        address caller,
        address receiver,
        address account,
        uint256 assets,
        uint256 shares
    ) internal override nonReentrant whenNotPaused {
        uint256 freeLiq = totalAssets() - s_totalLocked;
        if (assets > freeLiq) {
            revert ICoveragePool__InsufficientFreeLiquidity(assets, freeLiq);
        }

        uint256 actualWithdrawn = i_aavePool.withdraw(asset(), assets, address(this));
        require(actualWithdrawn >= assets, "Aave withdrawal mismatch");

        super._withdraw(caller, receiver, account, assets, shares);

        emit LiquidityWithdrawn(receiver, assets, shares);
    }

    // -------------------------------------------------------
    //  ICoveragePool — LP Operations
    // -------------------------------------------------------

    /**
     * @notice Deposits underlying asset, minting proportional ssUSDC shares.
     * @param  usdcAmount Amount of underlying asset to deposit.
     */
    function deposit(uint256 usdcAmount) external override(ICoveragePool) {
        if (usdcAmount == 0) revert ICoveragePool__ZeroDeposit();
        ERC4626.deposit(usdcAmount, msg.sender);
    }

    /**
     * @notice Redeems ssUSDC shares for proportional underlying asset and yield.
     * @param  shares Amount of pool shares to burn.
     */
    function withdraw(uint256 shares) external override(ICoveragePool) {
        if (shares == 0) revert ICoveragePool__InsufficientShares(0, 0);
        redeem(shares, msg.sender, msg.sender);
    }

    // -------------------------------------------------------
    //  System State Operations — PolicyEngine
    // -------------------------------------------------------

    /**
     * @notice Reserves vault liquidity as collateral for a newly issued policy.
     * @dev    Restricted to PolicyEngine. Reverts if requested collateral exceeds free liquidity.
     * @param  policyId       Unique identifier of the policy.
     * @param  protocol       Address of the covered protocol.
     * @param  coverageAmount Amount of underlying asset to lock.
     */
    function lockCoverage(
        uint256 policyId,
        address protocol,
        uint256 coverageAmount
    ) external onlyPolicyEngine {
        uint256 freeLiq = totalAssets() - s_totalLocked;
        if (coverageAmount > freeLiq) {
            revert ICoveragePool__InsufficientFreeLiquidity(coverageAmount, freeLiq);
        }

        s_lockedCoverage[policyId] = coverageAmount;
        s_totalLocked             += coverageAmount;

        emit CoverageLocked(policyId, protocol, coverageAmount);
    }

    /**
     * @notice Unlocks collateral tied to an expired or cancelled policy.
     * @dev    Restricted to PolicyEngine. Safely restores assets to the free liquidity pool.
     * @param  policyId Unique identifier of the policy to release.
     */
    function releaseCoverage(uint256 policyId) external onlyPolicyEngine {
        uint256 locked = s_lockedCoverage[policyId];
        if (locked == 0) return;

        s_lockedCoverage[policyId] = 0;
        s_totalLocked             -= locked;

        emit CoverageReleased(policyId, locked);
    }

    /**
     * @notice Routes collected premium payments directly into the yield strategy.
     * @dev    Restricted to PolicyEngine. Yield naturally increments the global share price.
     * @param  policyId      Unique identifier of the policy.
     * @param  premiumAmount Premium amount collected.
     */
    function collectPremium(
        uint256 policyId,
        uint256 premiumAmount
    ) external onlyPolicyEngine {
        if (premiumAmount == 0) return;

        IERC20(asset()).safeTransferFrom(msg.sender, address(this), premiumAmount);
        IERC20(asset()).forceApprove(address(i_aavePool), premiumAmount);
        i_aavePool.supply(asset(), premiumAmount, address(this), 0);

        emit PremiumCollected(policyId, premiumAmount);
    }

    /**
     * @notice Processes premium refunds via a pull-pattern directly from Aave.
     * @dev    Restricted to PolicyEngine. Optimized to bypass vault state changes.
     * @param  recipient Address of the user receiving the refund.
     * @param  amount    Refund amount to transfer.
     */
    function refundPremium(
        address recipient,
        uint256 amount
    ) external nonReentrant onlyPolicyEngine {
        if (recipient == address(0)) revert CoveragePool__ZeroAddress();
        if (amount == 0) return;

        uint256 actualWithdrawn = i_aavePool.withdraw(asset(), amount, recipient);
        require(actualWithdrawn >= amount, "Aave withdrawal mismatch");
    }

    // -------------------------------------------------------
    //  System State Operations — PayoutExecutor
    // -------------------------------------------------------

    /**
     * @notice Executes a verified claim payout to a policyholder.
     * @dev    Restricted to PayoutExecutor. Adjusts locked state and withdraws directly to the user.
     * @param  policyId  Unique identifier of the approved policy.
     * @param  recipient Address of the policyholder.
     * @param  amount    Approved payout amount.
     */
    function executePayout(
        uint256 policyId,
        address recipient,
        uint256 amount
    ) external nonReentrant onlyPayoutExecutor {
        if (recipient == address(0)) revert CoveragePool__ZeroAddress();

        uint256 locked = s_lockedCoverage[policyId];
        if (amount > locked) {
            revert ICoveragePool__PayoutExceedsLocked(amount, locked);
        }

        s_lockedCoverage[policyId] = 0;
        s_totalLocked             -= locked;

        uint256 actualWithdrawn = i_aavePool.withdraw(asset(), amount, recipient);
        require(actualWithdrawn >= amount, "Aave withdrawal mismatch");

        emit ClaimPaid(policyId, recipient, amount);
    }

    // -------------------------------------------------------
    //  View Functions
    // -------------------------------------------------------

    /**
     * @notice Returns the total underlying asset balance controlled by the pool.
     * @return Total liquidity in the underlying asset.
     */
    function totalLiquidity() external view returns (uint256) {
        return totalAssets();
    }

    /**
     * @notice Returns the aggregate amount of underlying assets currently locked as collateral.
     * @return Total locked collateral.
     */
    function totalLockedLiquidity() external view returns (uint256) {
        return s_totalLocked;
    }

    /**
     * @notice Returns the amount of underlying assets available for new policies or LP withdrawals.
     * @return Available free liquidity.
     */
    function freeLiquidity() external view returns (uint256) {
        return totalAssets() - s_totalLocked;
    }

    /**
     * @notice Computes the current underlying asset value for a given amount of LP shares.
     * @param  shares Amount of LP shares.
     * @return Current underlying asset value.
     */
    function sharesToUsdc(uint256 shares) external view returns (uint256) {
        return convertToAssets(shares);
    }

    /**
     * @notice Computes the amount of LP shares that would be minted for a given deposit.
     * @param  usdcAmount Amount of underlying asset.
     * @return Number of LP shares to be minted.
     */
    function usdcToShares(uint256 usdcAmount) external view returns (uint256) {
        return convertToShares(usdcAmount);
    }

    /**
     * @notice Returns the LP share balance for a specific address.
     * @param  lp Address of the liquidity provider.
     * @return Current share balance.
     */
    function sharesOf(address lp) external view returns (uint256) {
        return balanceOf(lp);
    }

    /**
     * @notice Returns the specific amount of underlying asset locked for a given policy.
     * @param  policyId Unique identifier of the policy.
     * @return Locked collateral amount.
     */
    function lockedCoverageOf(uint256 policyId) external view returns (uint256) {
        return s_lockedCoverage[policyId];
    }

    // -------------------------------------------------------
    //  Emergency Controls
    // -------------------------------------------------------

    /**
     * @notice Pauses vault operations in an emergency.
     * @dev    Restricted to contract owner. Halts deposits and withdrawals.
     */
    function pause()   external onlyOwner { _pause();   }

    /**
     * @notice Unpauses vault operations.
     * @dev    Restricted to contract owner.
     */
    function unpause() external onlyOwner { _unpause(); }

    // -------------------------------------------------------
    //  ERC-4626 Max Overrides
    // -------------------------------------------------------

    /**
     * @notice Computes the maximum amount of underlying assets an owner can withdraw.
     * @dev    Overrides standard ERC-4626 to dynamically cap withdrawals based on available free liquidity.
     * @param  account Address of the asset owner.
     * @return Maximum withdrawable underlying assets.
     */
    function maxWithdraw(address account) public view override returns (uint256) {
        uint256 ownerAssets  = convertToAssets(balanceOf(account));
        uint256 freeLiq      = totalAssets() - s_totalLocked;
        return ownerAssets < freeLiq ? ownerAssets : freeLiq;
    }

    /**
     * @notice Computes the maximum amount of shares an owner can redeem.
     * @dev    Overrides standard ERC-4626 to dynamically cap redemptions based on available free liquidity.
     * @param  account Address of the share owner.
     * @return Maximum redeemable shares.
     */
    function maxRedeem(address account) public view override returns (uint256) {
        uint256 freeLiq      = totalAssets() - s_totalLocked;
        uint256 freeShares   = convertToShares(freeLiq);
        uint256 ownerShares  = balanceOf(account);
        return ownerShares < freeShares ? ownerShares : freeShares;
    }
}
