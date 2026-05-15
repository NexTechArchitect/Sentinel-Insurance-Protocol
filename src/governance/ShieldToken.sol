// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Votes} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Votes.sol";
import {ERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";
import {ERC20Burnable} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import {ERC20Pausable} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Pausable.sol";
import {Ownable2Step, Ownable} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {Nonces} from "@openzeppelin/contracts/utils/Nonces.sol";

/**
 * @title  ShieldToken
 * @author Amit (SentinelShield)
 * @notice Governance token of SentinelShield. Voting power is snapshot-based
 *         via ERC20Votes — immune to flash-loan and post-incident vote manipulation.
 * @dev    Users MUST call delegate(address) before their balance counts as votes.
 *         Self-delegation: delegate(msg.sender).
 */
contract ShieldToken is
    ERC20,
    ERC20Burnable,
    ERC20Pausable,
    ERC20Permit,
    ERC20Votes,
    Ownable2Step
{
    // -------------------------------------------------------
    //  Constants
    // -------------------------------------------------------

    /**
     * @notice Total supply limit for SHIELD tokens (100 Million).
     * @dev Hardcoded limit to ensure long-term scarcity and prevent inflation.
     */
    uint256 public constant MAX_SUPPLY = 100_000_000e18;

    // -------------------------------------------------------
    //  Errors
    // -------------------------------------------------------

    error ShieldToken__MaxSupplyExceeded(uint256 requested, uint256 available);
    error ShieldToken__ZeroAddress();
    error ShieldToken__ZeroAmount();

    // -------------------------------------------------------
    //  Constructor
    // -------------------------------------------------------

    /**
     * @dev Initializes token name, symbol, and enables EIP-712 permit functionality.
     */
    constructor()
        ERC20("Shield Token", "SHIELD")
        ERC20Permit("Shield Token")
        Ownable(msg.sender)
    {}

    // -------------------------------------------------------
    //  External Functions
    // -------------------------------------------------------

    /**
     * @notice Mint new SHIELD tokens. Capped at MAX_SUPPLY.
     * @dev Only callable by Owner (DAO) and respects the Pausable state.
     * @param to      Recipient address.
     * @param amount  Amount to mint (18 decimals).
     */
    function mint(address to, uint256 amount) external onlyOwner whenNotPaused {
        if (to == address(0)) revert ShieldToken__ZeroAddress();
        if (amount == 0) revert ShieldToken__ZeroAmount();

        uint256 available = MAX_SUPPLY - totalSupply();
        if (amount > available) revert ShieldToken__MaxSupplyExceeded(amount, available);

        _mint(to, amount);
    }

    // -------------------------------------------------------
    //  Only Owner — Emergency Controls
    // -------------------------------------------------------

    /**
     * @notice Halts all token transfers and minting in case of emergency.
     */
    function pause() external onlyOwner {
        _pause();
    }

    /**
     * @notice Resumes token operations.
     */
    function unpause() external onlyOwner {
        _unpause();
    }

    // -------------------------------------------------------
    //  Overrides for Multiple Inheritance
    // -------------------------------------------------------

    /**
     * @dev Handles the logic for token transfers, minting, and burning.
     *      Resolves conflicts between Pausable (transfer check) and Votes (snapshotting).
     */
    function _update(
        address from,
        address to,
        uint256 amount
    ) internal override(ERC20, ERC20Pausable, ERC20Votes) {
        super._update(from, to, amount);
    }

    /**
     * @dev Returns the current nonce for a given owner for EIP-712 signatures.
     *      Necessary override to resolve conflict between ERC20Permit and Nonces.
     */
    function nonces(address owner)
        public
        view
        override(ERC20Permit, Nonces)
        returns (uint256)
    {
        return super.nonces(owner);
    }
}