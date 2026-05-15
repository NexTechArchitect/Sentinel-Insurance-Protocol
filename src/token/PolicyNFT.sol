// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {Ownable2Step, Ownable} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {PolicyNFTSVG} from "../libraries/PolicyNFTSVG.sol";

/**
 * @title  PolicyNFT
 * @author Amit (SentinelShield)
 * @notice ERC-5484 Soulbound token representing an active insurance policy.
 * @dev    Implements strict access controls ensuring only the designated PolicyEngine
 *         can mint, modify, or burn tokens. Metadata is dynamically rendered on-chain.
 */
contract PolicyNFT is ERC721, Ownable2Step {
    // -------------------------------------------------------
    //  Types
    // -------------------------------------------------------

    /**
     * @dev Core data structure for individual policies.
     */
    struct PolicyData {
        address protocol;
        uint256 coverageAmount;
        uint256 expiresAt;
        uint8   status; // 0: ACTIVE, 1: EXPIRED, 2: CLAIMED, 3: CANCELLED
    }

    // -------------------------------------------------------
    //  Storage
    // -------------------------------------------------------

    /**
     * @dev Address of the core routing contract authorized to manage states.
     */
    address private s_policyEngine;

    /**
     * @dev Mapping of token ID to its respective policy configuration.
     */
    mapping(uint256 => PolicyData) private s_policyData;

    /**
     * @dev Auto-incrementing counter for unique token generation.
     */
    uint256 private s_nextTokenId;

    // -------------------------------------------------------
    //  Errors
    // -------------------------------------------------------

    error PolicyNFT__Soulbound();
    error PolicyNFT__OnlyPolicyEngine(address caller);
    error PolicyNFT__ZeroAddress();
    error PolicyNFT__TokenDoesNotExist(uint256 tokenId);
    error PolicyNFT__EngineAlreadySet();
    error PolicyNFT__InvalidStatus(uint8 status);

    // -------------------------------------------------------
    //  Events
    // -------------------------------------------------------

    event PolicyMinted(uint256 indexed tokenId, address indexed holder, address indexed protocol);
    event PolicyBurned(uint256 indexed tokenId);
    event PolicyStatusUpdated(uint256 indexed tokenId, uint8 newStatus);
    event PolicyEngineSet(address indexed engine);

    /**
     * @dev ERC-4906 standard event. Signals decentralized indexers (e.g., OpenSea) 
     *      to refresh metadata parameters when policy state mutates.
     */
    event MetadataUpdate(uint256 _tokenId);

    // -------------------------------------------------------
    //  Modifiers
    // -------------------------------------------------------

    modifier onlyPolicyEngine() {
        if (msg.sender != s_policyEngine) revert PolicyNFT__OnlyPolicyEngine(msg.sender);
        _;
    }

    // -------------------------------------------------------
    //  Constructor
    // -------------------------------------------------------

    constructor() ERC721("SentinelShield Policy", "SSP") Ownable(msg.sender) {}

    // -------------------------------------------------------
    //  External — Setup
    // -------------------------------------------------------

    /**
     * @notice Initializes the central engine authority.
     * @dev Can only be invoked once to prevent centralized tampering post-deployment.
     * @param engine Address of the PolicyEngine contract.
     */
    function setPolicyEngine(address engine) external onlyOwner {
        if (s_policyEngine != address(0)) revert PolicyNFT__EngineAlreadySet();
        if (engine == address(0)) revert PolicyNFT__ZeroAddress();

        s_policyEngine = engine;

        emit PolicyEngineSet(engine);
    }

    // -------------------------------------------------------
    //  External — Authorized (PolicyEngine)
    // -------------------------------------------------------

    /**
     * @notice Issues a new soulbound policy to the insured party.
     * @param holder The recipient wallet address.
     * @param protocol The target protocol receiving coverage.
     * @param coverageAmount Maximum compensable USDC limit (6 decimals).
     * @param expiresAt Unix timestamp dictating policy validity.
     * @return tokenId The sequentially generated unique token identifier.
     */
    function mint(
        address holder,
        address protocol,
        uint256 coverageAmount,
        uint256 expiresAt
    ) external onlyPolicyEngine returns (uint256 tokenId) {
        if (holder == address(0))   revert PolicyNFT__ZeroAddress();
        if (protocol == address(0)) revert PolicyNFT__ZeroAddress();

        tokenId = s_nextTokenId;
        unchecked { ++s_nextTokenId; }

        s_policyData[tokenId] = PolicyData({
            protocol:       protocol,
            coverageAmount: coverageAmount,
            expiresAt:      expiresAt,
            status:         0 
        });

        _mint(holder, tokenId);

        emit PolicyMinted(tokenId, holder, protocol);
    }

    /**
     * @notice Irreversibly destroys a policy and purges its storage footprint.
     * @param tokenId The identifier of the token to be burned.
     */
    function burn(uint256 tokenId) external onlyPolicyEngine {
        if (_ownerOf(tokenId) == address(0)) revert PolicyNFT__TokenDoesNotExist(tokenId);

        delete s_policyData[tokenId];

        _burn(tokenId);

        emit PolicyBurned(tokenId);
    }

    /**
     * @notice Mutates the state of an existing policy (e.g., triggering a claim).
     * @dev Emits ERC-4906 MetadataUpdate to flush off-chain caches.
     * @param tokenId The identifier of the token being updated.
     * @param newStatus The encoded state integer (0-3).
     */
    function updateStatus(uint256 tokenId, uint8 newStatus) external onlyPolicyEngine {
        if (_ownerOf(tokenId) == address(0)) revert PolicyNFT__TokenDoesNotExist(tokenId);
        if (newStatus > 3) revert PolicyNFT__InvalidStatus(newStatus);

        s_policyData[tokenId].status = newStatus;

        emit PolicyStatusUpdated(tokenId, newStatus);
        emit MetadataUpdate(tokenId);
    }

    // -------------------------------------------------------
    //  External — View & Metadata
    // -------------------------------------------------------

    /**
     * @notice Returns the fully rendered on-chain vector graphic and JSON schema.
     * @param tokenId The target token identifier.
     * @return Full base64-encoded standard data URI.
     */
    function tokenURI(uint256 tokenId)
        public
        view
        override
        returns (string memory)
    {
        if (_ownerOf(tokenId) == address(0)) revert PolicyNFT__TokenDoesNotExist(tokenId);

        PolicyData memory d = s_policyData[tokenId];

        return PolicyNFTSVG.buildTokenURI(PolicyNFTSVG.SVGParams({
            tokenId:        tokenId,
            protocol:       d.protocol,
            coverageAmount: d.coverageAmount,
            expiresAt:      d.expiresAt,
            status:         d.status
        }));
    }

    /**
     * @notice Fetches raw, unformatted policy state parameters.
     * @param tokenId The target token identifier.
     * @return PolicyData core struct containing mapping values.
     */
    function getPolicyData(uint256 tokenId)
        external
        view
        returns (PolicyData memory)
    {
        if (_ownerOf(tokenId) == address(0)) revert PolicyNFT__TokenDoesNotExist(tokenId);
        return s_policyData[tokenId];
    }

    /**
     * @notice Returns the absolute sequence count of all generated tokens.
     */
    function totalMinted() external view returns (uint256) {
        return s_nextTokenId;
    }

    /**
     * @notice Returns the currently authorized PolicyEngine orchestrator.
     */
    function policyEngine() external view returns (address) {
        return s_policyEngine;
    }

    // -------------------------------------------------------
    //  ERC-5484 (Soulbound) Concurrency
    // -------------------------------------------------------

    /**
     * @dev Resolves transfer requests by rejecting all non-mint/burn actions.
     *      Enforces the ERC-5484 standard requirements.
     */
    function _update(
        address to,
        uint256 tokenId,
        address auth
    ) internal override returns (address) {
        address from = _ownerOf(tokenId);

        if (from != address(0) && to != address(0)) {
            revert PolicyNFT__Soulbound();
        }

        return super._update(to, tokenId, auth);
    }

    // -------------------------------------------------------
    //  ERC-165 Sub-Routing
    // -------------------------------------------------------

    /**
     * @dev Exposes implemented interface signatures to external query engines.
     *      Includes support for Soulbound (ERC-5484) and Dynamic Metadata (ERC-4906).
     */
    function supportsInterface(bytes4 interfaceId)
        public
        view
        override
        returns (bool)
    {
        return interfaceId == 0x0489b56f || interfaceId == 0x49064906 || super.supportsInterface(interfaceId);
    }
}