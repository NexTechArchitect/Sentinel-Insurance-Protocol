import PolicyEngineABI from './abis/PolicyEngine.json';
import CoveragePoolABI from './abis/CoveragePool.json';
import RiskRegistryABI from './abis/RiskRegistry.json';
import ClaimsGovernorABI from './abis/ClaimsGovernor.json';
import ShieldTokenABI from './abis/ShieldToken.json';
import VetoCouncilABI from './abis/VetoCouncil.json';
import PolicyNFTABI from './abis/PolicyNFT.json';

// Pure core atomic deployed endpoints synchronized via script/DeploySentinel.s.sol
export const SENTINEL_ADDRESSES = {
  POLICY_ENGINE:   "0xa373BD4d832E34C960A7bF6BBf6190c939932b40",
  COVERAGE_POOL:   "0x2bC42ae97A20b4f06F35C42e2Fb82A0550fAAf18",
  RISK_REGISTRY:   "0xE94a55ac7678013ff68B8c26A3337A0DCe7a5210",
  CLAIMS_GOVERNOR: "0xDc89D29Dc89178bE772EAf6E3587eB863Df6Ae8a",
  SHIELD_TOKEN:    "0x3D202f0Af4614DA97eDeC5326c585b9C6E29d4AF",
  VETO_COUNCIL:    "0x00493Da33899ea9FB9Fe5401dDa9EcE7F92319Ab",
  POLICY_NFT:      "0xbB6314f9775209e0999280BFE7e7A316ADc5b75C",
  PAYOUT_EXECUTOR: "0x004FF5Ce04AcC4106100C283edf2A69Fb879BdCb",

  // External Protocols & Collateral Assets Layer (Aave V3 Staging Matrix)
  AAVE_V3_POOL: "0x6Ae43d3271ff6888e7Fc43Fd7321a503ff738951",
  USDC:         "0x94a9D9AC8a22534E3FaCa9F4e7F2E2cf85d5E4C8",
  A_USDC:       "0x16dA455C6e21E90E9e1554a93A0aA8435d038290",
} as const;

export const SENTINEL_ABIS = {
  POLICY_ENGINE:   PolicyEngineABI,
  COVERAGE_POOL:   CoveragePoolABI,
  RISK_REGISTRY:   RiskRegistryABI,
  CLAIMS_GOVERNOR: ClaimsGovernorABI,
  SHIELD_TOKEN:    ShieldTokenABI,
  VETO_COUNCIL:    VetoCouncilABI,
  POLICY_NFT:      PolicyNFTABI,
} as const;

export const SEPOLIA_CHAIN_ID = 11155111;