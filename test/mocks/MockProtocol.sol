// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title  MockProtocol
 * @notice Simulates an insurable DeFi protocol for integration testing.
 * @dev    Used in tests to simulate hack scenarios and verify
 *         that ClaimsGovernor correctly handles exploit evidence.
 */
contract MockProtocol {

    bool    public isHacked;
    uint256 public totalValueLocked;

    event HackSimulated(uint256 tvlBefore);
    event ProtocolReset(uint256 newTvl);

    error MockProtocol__AlreadyHacked();
    error MockProtocol__NotHacked();

    constructor(uint256 initialTvl) {
        totalValueLocked = initialTvl;
    }

    /// @notice Simulate a hack — drains TVL, marks protocol as hacked.
    function simulateHack() external {
        if (isHacked) revert MockProtocol__AlreadyHacked();

        uint256 tvlBefore    = totalValueLocked;
        isHacked             = true;
        totalValueLocked     = 0;

        emit HackSimulated(tvlBefore);
    }

    /// @notice Reset protocol after remediation — for re-testing.
    function resetProtocol(uint256 newTvl) external {
        isHacked         = false;
        totalValueLocked = newTvl;

        emit ProtocolReset(newTvl);
    }
}
