// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/**
 * @title  MockAToken
 * @notice Simulates Aave's aUSDC interest-bearing token.
 * @dev    CoveragePool calls i_aUsdc.balanceOf(address(this)) to get total assets.
 *         MockAavePool mints/burns these tokens on supply/withdraw.
 *         simulateYield() mints extra tokens to simulate Aave interest accrual.
 */
contract MockAToken is ERC20 {

    address public i_pool;
    bool    private s_poolSet;

    error MockAToken__OnlyPool();
    error MockAToken__PoolAlreadySet();

    modifier onlyPool() {
        if (msg.sender != i_pool) revert MockAToken__OnlyPool();
        _;
    }

    constructor() ERC20("Mock aUSDC", "aUSDC") {}

    /// @dev Call this after deploying MockAavePool to wire the two mocks.
    function setPool(address pool) external {
        if (s_poolSet) revert MockAToken__PoolAlreadySet();
        s_poolSet = true;
        i_pool    = pool;
    }

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    /// @dev Called by MockAavePool on supply
    function mint(address to, uint256 amount) external onlyPool {
        _mint(to, amount);
    }

    /// @dev Called by MockAavePool on withdraw
    function burn(address from, uint256 amount) external onlyPool {
        _burn(from, amount);
    }

    /// @dev Called by MockAavePool.simulateYield — mints yield without pool auth check
    function mintYield(address to, uint256 amount) external {
        _mint(to, amount);
    }
}
