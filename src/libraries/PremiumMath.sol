// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title  PremiumMath
 * @notice Pure math library for insurance premium calculation.
 * @dev    Implements precision-safe arithmetic operations (multiply-before-divide).
 *         Maintains native asset precision natively (e.g., 6 decimals for USDC) without 
 *         intermediate scaling to 1e18. Stateless execution with zero external calls.
 */
library PremiumMath {

    // -------------------------------------------------------
    //  Constants
    // -------------------------------------------------------

    /// @dev Normalization factor for protocol risk scores (0-100).
    uint256 private constant SCORE_DENOMINATOR  = 100;

    /// @dev Standard basis points denominator (100% = 10,000 bps).
    uint256 private constant BPS_DENOMINATOR    = 10_000;

    /// @dev Premium discount rate applied to audited protocols (2,000 bps = 20%).
    uint256 private constant AUDIT_DISCOUNT_BPS = 2_000;

    /// @dev Seconds in a standard year, used for annualizing risk rates.
    uint256 private constant YEAR_SECONDS       = 365 days;

    /// @dev Base annual premium rate basis (1,000 bps = 10% APR at max risk score).
    uint256 private constant BASE_RATE_BPS      = 1_000;

    /// @dev Absolute minimum premium threshold to prevent dust policies (1 USDC).
    uint256 private constant MIN_PREMIUM_USDC   = 1e6;

    /// @dev Protocol-enforced maximum coverage duration (1 year).
    uint256 public  constant MAX_DURATION       = 365 days;

    /// @dev Protocol-enforced minimum coverage duration (7 days).
    uint256 public  constant MIN_DURATION       = 7 days;

    // -------------------------------------------------------
    //  Errors
    // -------------------------------------------------------

    error PremiumMath__InvalidRiskScore(uint8 score);
    error PremiumMath__InvalidDuration(uint256 duration);
    error PremiumMath__ZeroCoverageAmount();

    // -------------------------------------------------------
    //  External — Premium Calculation
    // -------------------------------------------------------

    /**
     * @notice Calculates the exact premium required for a specified policy configuration.
     * @dev    Executes all multiplications prior to divisions to prevent precision loss.
     *         Mathematically safe from overflow under enforced protocol parameter constraints.
     * @param  coverageAmount Maximum compensable amount (maintains input decimals).
     * @param  riskScore      Assessed risk score of the target protocol [0-100].
     * @param  audited        Boolean flag indicating valid audit status.
     * @param  duration       Requested policy duration in seconds.
     * @return premium        Calculated premium amount in the same decimals as coverageAmount.
     */
    function calculatePremium(
        uint256 coverageAmount,
        uint8   riskScore,
        bool    audited,
        uint256 duration
    ) internal pure returns (uint256 premium) {
        if (coverageAmount == 0)                                        revert PremiumMath__ZeroCoverageAmount();
        if (riskScore > 100)                                            revert PremiumMath__InvalidRiskScore(riskScore);
        if (duration < MIN_DURATION || duration > MAX_DURATION) revert PremiumMath__InvalidDuration(duration);

        uint256 numerator = coverageAmount
                          * BASE_RATE_BPS
                          * uint256(riskScore)
                          * duration;

        uint256 denominator = SCORE_DENOMINATOR
                            * BPS_DENOMINATOR
                            * YEAR_SECONDS;

        uint256 basePremium;

        if (audited) {
            uint256 discountedNumerator = numerator * (BPS_DENOMINATOR - AUDIT_DISCOUNT_BPS);
            uint256 discountedDenominator = denominator * BPS_DENOMINATOR;
            basePremium = discountedNumerator / discountedDenominator;
        } else {
            basePremium = numerator / denominator;
        }

        premium = basePremium < MIN_PREMIUM_USDC ? MIN_PREMIUM_USDC : basePremium;
    }

    /**
     * @notice Computes the pro-rated refund amount for early policy cancellations.
     * @dev    Refund is linearly proportional to the remaining time. Returns 0 if expired.
     * @param  premium        Original premium amount paid by the user.
     * @param  issuedAt       Unix timestamp indicating policy issuance.
     * @param  expiresAt      Unix timestamp indicating policy expiration.
     * @param  currentTime    Current block timestamp.
     * @return refund         Pro-rated refund amount in the native asset precision.
     */
    function calculateRefund(
        uint256 premium,
        uint256 issuedAt,
        uint256 expiresAt,
        uint256 currentTime
    ) internal pure returns (uint256 refund) {
        if (currentTime >= expiresAt) return 0;

        uint256 totalDuration   = expiresAt - issuedAt;
        uint256 timeRemaining   = expiresAt - currentTime;

        refund = (premium * timeRemaining) / totalDuration;
    }

    /**
     * @notice Validates if the provided payment meets the required premium threshold.
     * @dev    Convenience wrapper standardizing premium checks for the PolicyEngine.
     * @param  paid           Amount of underlying asset provided by the user.
     * @param  coverageAmount Desired coverage limit.
     * @param  riskScore      Protocol's current risk score.
     * @param  audited        Protocol's current audit status.
     * @param  duration       Requested policy duration in seconds.
     * @return sufficient     Boolean indicating if the paid amount satisfies the requirement.
     * @return required       The exact calculated premium requirement.
     */
    function isPremiumSufficient(
        uint256 paid,
        uint256 coverageAmount,
        uint8   riskScore,
        bool    audited,
        uint256 duration
    ) internal pure returns (bool sufficient, uint256 required) {
        required  = calculatePremium(coverageAmount, riskScore, audited, duration);
        sufficient = paid >= required;
    }
}