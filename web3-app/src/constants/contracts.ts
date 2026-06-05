import PolicyEngineABI from './abis/PolicyEngine.json';
import CoveragePoolABI from './abis/CoveragePool.json';
import RiskRegistryABI from './abis/RiskRegistry.json';
import ClaimsGovernorABI from './abis/ClaimsGovernor.json';
import ShieldTokenABI from './abis/ShieldToken.json';
import VetoCouncilABI from './abis/VetoCouncil.json';
import PolicyNFTABI from './abis/PolicyNFT.json';

// Pure core atomic deployed endpoints synchronized via Base Mainnet Deployment Script
export const SENTINEL_ADDRESSES = {
  POLICY_ENGINE:   "0xEF80cd6370D4619D2f71BD4000a4757357Be5564",
  COVERAGE_POOL:   "0x374d949c7A575212d423Ecc0e765a59664d7C3eD",
  RISK_REGISTRY:   "0x049C2eC773cDa5F3a19F9cc7C67D3331C21853DB",
  CLAIMS_GOVERNOR: "0xB7939f8b41C932595cf358842BC63AFE221D2Ba3",
  SHIELD_TOKEN:    "0xafE2B560ad1743DA67BdA1850aF47CdB2280a2d1",
  VETO_COUNCIL:    "0x896627825AEAc934e4CAec4cb00EC8B90a5292B0",
  POLICY_NFT:      "0x02A9E50D9EB6fec67c419C5ddb3ffd894DD01C00",
  PAYOUT_EXECUTOR: "0x897a76eC710DC780E4627532A0e863F2672d50A7",

  // Base Mainnet External Protocols & Native Assets Layer (Verified Integration Matrix)
  AAVE_V3_POOL:    "0xA238Dd80C259b705191C65851448bB1e2D3b3790",
  USDC:            "0x833589fCD6eDb6E08f4c7C32D4f71b54bda02913",
  A_USDC:          "0x724dc807b0491c6b13239c33e2182c40c741ea1c",
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

export const BASE_CHAIN_ID = 8453;