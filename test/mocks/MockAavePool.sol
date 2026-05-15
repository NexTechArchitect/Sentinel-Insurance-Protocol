// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {MockUSDC} from "./MockUSDC.sol";
import {MockAToken} from "./MockAToken.sol";

/**
 * @title  MockAavePool
 * @notice Simulates Aave V3 IPool for testing.
 * @dev    Critical: CoveragePool calls i_aUsdc.balanceOf(address(this))
 *         to get total assets. MockAToken handles this correctly.
 *
 *         supply()  → transfers USDC in, mints aUSDC to onBehalfOf
 *         withdraw() → burns aUSDC from caller, transfers USDC to `to`
 *         simulateYield() → mints extra aUSDC to simulate interest
 */
contract MockAavePool {

    IERC20      public immutable i_usdc;
    MockAToken  public immutable i_aToken;

    error MockAavePool__InvalidAsset();
    error MockAavePool__ZeroAmount();
    error MockAavePool__InsufficientBalance(uint256 requested, uint256 available);

    constructor(address usdc, address aToken) {
        i_usdc   = IERC20(usdc);
        i_aToken = MockAToken(aToken);
    }

    /**
     * @notice Mimics Aave V3 supply.
     * @dev    Pulls USDC from msg.sender, mints aUSDC to onBehalfOf.
     *         CoveragePool calls this after transferring USDC to itself.
     */
    function supply(
        address asset,
        uint256 amount,
        address onBehalfOf,
        uint16  /* referralCode */
    ) external {
        if (asset != address(i_usdc)) revert MockAavePool__InvalidAsset();
        if (amount == 0)              revert MockAavePool__ZeroAmount();

        // Pull USDC from caller (CoveragePool already has it)
        bool ok = i_usdc.transferFrom(msg.sender, address(this), amount);
        require(ok, "MockAavePool: transferFrom failed");

        // Mint 1:1 aUSDC to onBehalfOf
        i_aToken.mint(onBehalfOf, amount);
    }

    /**
     * @notice Mimics Aave V3 withdraw.
     * @dev    Burns aUSDC from msg.sender, sends USDC to `to`.
     *         amount == type(uint256).max → withdraw full balance.
     */
    function withdraw(
        address asset,
        uint256 amount,
        address to
    ) external returns (uint256) {
        if (asset != address(i_usdc)) revert MockAavePool__InvalidAsset();

        uint256 userBalance  = i_aToken.balanceOf(msg.sender);
        uint256 actualAmount = amount == type(uint256).max ? userBalance : amount;

        if (actualAmount == 0)              revert MockAavePool__ZeroAmount();
        if (actualAmount > userBalance) {
            revert MockAavePool__InsufficientBalance(actualAmount, userBalance);
        }

        // Burn aUSDC from caller
        i_aToken.burn(msg.sender, actualAmount);

        // Send USDC to recipient
        bool ok = i_usdc.transfer(to, actualAmount);
        require(ok, "MockAavePool: transfer failed");

        return actualAmount;
    }

    /**
     * @notice Simulate yield — mints aUSDC to `user` without USDC backing.
     * @dev    In real Aave, aToken balance grows via rebasing.
     *         Here we just mint extra aUSDC to simulate interest.
     *         Also mints matching USDC to pool so withdraw doesn't fail.
     * @param  user        Address to receive yield (usually CoveragePool).
     * @param  yieldAmount Amount of yield to simulate (USDC 6 decimals).
     */
    function simulateYield(address user, uint256 yieldAmount) external {
        // Mint backing USDC to pool so withdraw succeeds
        MockUSDC(address(i_usdc)).mint(address(this), yieldAmount);

        // Mint aUSDC to user — increases balanceOf → totalAssets() rises
        i_aToken.mintYield(user, yieldAmount);
    }

    /// @notice Helper — check USDC balance held by this mock pool.
    function poolUsdcBalance() external view returns (uint256) {
        return i_usdc.balanceOf(address(this));
    }
}
