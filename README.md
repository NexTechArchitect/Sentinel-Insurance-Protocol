<div align="center">

<br/>

<img src="https://img.shields.io/badge/🛡️_SENTINEL-SHIELD_PROTOCOL-6366f1?style=for-the-badge&labelColor=0f172a" height="40"/>

<br/><br/>

**Decentralized On-Chain Insurance Infrastructure**

*Base Mainnet · ERC-4626 Yield Routing · DAO Adjudication · Flash-Loan Resistant Governance*

<br/>

[![Live App](https://img.shields.io/badge/Production-Live_App-22c55e?style=flat-square&logo=vercel&logoColor=white)](https://sentinel-insurance-protocol.vercel.app/)
[![Network](https://img.shields.io/badge/Network-Base_Mainnet-0052FF?style=flat-square&logo=base&logoColor=white)](https://basescan.org/)
[![Solidity](https://img.shields.io/badge/Solidity-0.8.24-363636?style=flat-square&logo=solidity)](https://soliditylang.org/)
[![Foundry](https://img.shields.io/badge/Tests-Foundry-F0B90B?style=flat-square)](https://book.getfoundry.sh/)
[![OpenZeppelin](https://img.shields.io/badge/OpenZeppelin-5.x-4E5EE4?style=flat-square)](https://openzeppelin.com/)
[![License](https://img.shields.io/badge/License-MIT-green?style=flat-square)](LICENSE)

<br/>

> A modular, security-first DeFi insurance protocol built on Base L2.
> Token-weighted DAO adjudication, automated yield via Aave V3, and soulbound policy NFTs —
> engineered to secure real-world DeFi assets against smart contract exploits.

<br/>

[🚀 Launch App](https://sentinel-insurance-protocol.vercel.app/) &nbsp;·&nbsp;
[📄 Source Code](https://github.com/NexTechArchitect/Sentinel-Insurance-Protocol) &nbsp;·&nbsp;
[🔗 Core Contract](https://basescan.org/address/0xEF80cd6370D4619D2f71BD4000a4757357Be5564)

<br/>

</div>

---

## Table of Contents

- [Overview](#overview)
- [Architecture](#architecture)
- [Deployed Contracts](#deployed-contracts)
- [Contract Reference](#contract-reference)
- [Security & Audit](#security--audit)
- [Local Development](#local-development)

---

## Overview

SentinelShield re-architects the three core failures of traditional DeFi insurance:

| Problem | Solution |
|:---|:---|
| **Idle Capital (Zero Yield)** | `CoveragePool` implements ERC-4626, routing all idle USDC into Aave V3 Base Core — continuous APY with zero capital drag. |
| **Flash-Loan Governance Attacks** | `ClaimsGovernor` enforces `block.number - 1` snapshot voting — only genuine long-term `$SHIELD` holders influence adjudication. |
| **Centralized Claim Approval** | 7-day public token-weighted voting window. `VetoCouncil` multisig exists solely as an emergency fraud safety valve, not for standard approvals. |
| **Static Non-Transferable Policies** | Active policies mint as ERC-721 `PolicyNFTs` with fully on-chain SVG art reflecting real-time coverage state. Soulbound via ERC-5484. |

---

## Architecture

The protocol operates across three isolated execution layers. A failure in governance cannot drain the capital vault.

```
┌─────────────────────────────────────────────────────────────────┐
│                   WEB3 FRONTEND (Next.js / Wagmi)               │
│            sentinel-insurance-protocol.vercel.app               │
└──────────────────────────┬──────────────────────────────────────┘
                           │ USDC / Evidence URIs
┌──────────────────────────▼──────────────────────────────────────┐
│                    POLICY ROUTING LAYER                         │
│   PolicyEngine.sol  ──  RiskRegistry.sol  ──  PolicyNFT.sol     │
│   Validates risk · routes premiums · mints soulbound receipts   │
└────────────┬────────────────────────────────┬───────────────────┘
             │                                │
┌────────────▼───────────┐      ┌─────────────▼──────────────────┐
│  CAPITAL LAYER         │      │  ADJUDICATION LAYER            │
│  CoveragePool.sol      │      │  ClaimsGovernor.sol            │
│  ERC-4626 vault        │      │  Snapshot block-voting         │
│  Auto-routes to Aave   │      │  via ShieldToken ($SHIELD)     │
└────────────┬───────────┘      └─────────────┬──────────────────┘
             │                                │
┌────────────▼────────────────────────────────▼───────────────────┐
│                    PAYOUT EXECUTION LAYER                       │
│     PayoutExecutor.sol  ──  VetoCouncil.sol (Emergency Msig)    │
│     Unlocks CoveragePool liquidity on successful DAO vote       │
└─────────────────────────────────────────────────────────────────┘
```

**Key design invariants:**

- All role assignments are one-time immutable — no admin key rotation attack surface
- CEI (Checks-Effects-Interactions) enforced on every state-changing function
- `ReentrancyGuard` on all external entry points touching capital
- Flash-loan immunity via `ERC20Votes.getPastVotes(addr, block.number - 1)`

---

## Deployed Contracts

All contracts deployed, verified, and live on **Base Mainnet** (Chain ID: `8453`).

| Contract | Address | Basescan |
|:---|:---|:---|
| **PolicyEngine** | `0xEF80cd6370D4619D2f71BD4000a4757357Be5564` | [↗ View](https://basescan.org/address/0xEF80cd6370D4619D2f71BD4000a4757357Be5564) |
| **CoveragePool** | `0x374d949c7A575212d423Ecc0e765a59664d7C3eD` | [↗ View](https://basescan.org/address/0x374d949c7A575212d423Ecc0e765a59664d7C3eD) |
| **ClaimsGovernor** | `0xB7939f8b41C932595cf358842BC63AFE221D2Ba3` | [↗ View](https://basescan.org/address/0xB7939f8b41C932595cf358842BC63AFE221D2Ba3) |
| **VetoCouncil** | `0x896627825AEAc934e4CAec4cb00EC8B90a5292B0` | [↗ View](https://basescan.org/address/0x896627825AEAc934e4CAec4cb00EC8B90a5292B0) |
| **RiskRegistry** | `0x049C2eC773cDa5F3a19F9cc7C67D3331C21853DB` | [↗ View](https://basescan.org/address/0x049C2eC773cDa5F3a19F9cc7C67D3331C21853DB) |
| **ShieldToken** | `0xafE2B560ad1743DA67BdA1850aF47CdB2280a2d1` | [↗ View](https://basescan.org/address/0xafE2B560ad1743DA67BdA1850aF47CdB2280a2d1) |
| **PolicyNFT** | `0x02A9E50D9EB6fec67c419C5ddb3ffd894DD01C00` | [↗ View](https://basescan.org/address/0x02A9E50D9EB6fec67c419C5ddb3ffd894DD01C00) |
| **PayoutExecutor** | `0x897a76eC710DC780E4627532A0e863F2672d50A7` | [↗ View](https://basescan.org/address/0x897a76eC710DC780E4627532A0e863F2672d50A7) |

> External integrations: [Aave V3 Pool](https://basescan.org/address/0xA238Dd80C259b705191C65851448bB1e2D3b3790) · [USDC](https://basescan.org/address/0x833589fCD6eDb6E08f4c7C32D4f71b54bda02913) · [aUSDC](https://basescan.org/address/0x724dc807b0491c6b13239c33e2182c40c741ea1c)

---

## Contract Reference

| Contract | Role |
|:---|:---|
| `PolicyEngine.sol` | Policy origination hub. Validates eligibility, calculates premiums, pulls USDC, locks collateral, mints `PolicyNFT`. Handles cancellations (pro-rated refund, pull pattern) and expiry (public keeper). |
| `CoveragePool.sol` | ERC-4626 capital vault. Auto-supplies deposited USDC to Aave V3. `totalAssets()` reads live `aUSDC` balance for real-time yield pricing. `_decimalsOffset = 6` prevents share inflation attacks. Tracks free vs locked liquidity. |
| `ClaimsGovernor.sol` | Adjudication engine. 7-day voting window, `$SHIELD` balances snapshotted at `block.number - 1` to block flash-loan attacks. `finalizeClaim()` is a public keeper. Quorum = 1% of supply, simple majority wins. |
| `VetoCouncil.sol` | M-of-N multisig safety valve. Guardians collectively veto `PENDING` claims only — not routine approvals. Threshold enforced with guardian count invariants. |
| `PayoutExecutor.sol` | Single-purpose payout executor. Keeper-callable. Marks claim `EXECUTED` before pool withdrawal (CEI). Emits `PayoutFailed` instead of reverting — prevents claims getting permanently stuck. |
| `RiskRegistry.sol` | Protocol eligibility registry. Stores `riskScore` (0–100), `audited`, `coverageCap`, `active` per protocol. Blacklisting halts new policies without affecting existing ones. |
| `ShieldToken.sol` | Governance token. ERC-20 Votes + Permit + Burnable. Hard cap: 100M `$SHIELD`. Users must `delegate()` to activate voting power. |
| `PolicyNFT.sol` | Soulbound policy receipt (ERC-5484). Fully on-chain SVG via `PolicyNFTSVG` — no IPFS dependency. ERC-4906 `MetadataUpdate` on status change. Burn-on-cancel. |

---

## Security & Audit

**Audit Engine:** Slither v0.10.x Static Analyzer · **Framework:** Foundry (Fuzz + Invariant suites)

| Severity | Found | Status |
|:---|:---|:---|
| 🔴 High | 0 | — |
| 🟡 Medium | 2 | False positives — verified design intent |
| 🔵 Low | 11 | Standard ERC-4626 / ERC-721 library properties |
| ℹ️ Info | 16 | NatSpec / documentation flags |

**Medium findings clarified:**

- `Complex Code` on `PolicyEngine.buyPolicy` — intentional atomic sequence (risk check → collateral lock → NFT mint must be single-tx to prevent front-running and state desync).
- `Receive ETH` on `PolicyEngine` — gas optimization only. `if (msg.value != 0) revert()` gates any ETH entry. All accounting is strictly ERC-20.

**Implemented mitigations:**

- Flash-loan resistant voting — `getPastVotes(addr, block.number - 1)`
- CEI pattern on all capital-touching functions
- `ReentrancyGuard` on `CoveragePool`, `ClaimsGovernor`, `PolicyEngine`, `PayoutExecutor`
- `SafeERC20` + `forceApprove()` — approval race condition closed
- One-time role initialization — no post-deploy key rotation surface
- Pull-pattern refunds — no DoS via reverting recipients
- `_decimalsOffset = 6` — ERC-4626 share inflation attack mitigated
- `Ownable2Step` on all privileged contracts

---

## Local Development

**Prerequisites:** [Foundry](https://book.getfoundry.sh/getting-started/installation) · Node.js v18+ · Git

```bash
# Clone & setup
git clone https://github.com/NexTechArchitect/Sentinel-Insurance-Protocol.git
cd Sentinel-Insurance-Protocol

forge install && forge build
forge test -vvv

# Mainnet fork simulation
forge script script/DeploySentinel.s.sol:DeploySentinel --rpc-url https://mainnet.base.org -vvv
```

```bash
# Frontend
cd web3-app && npm install && npm run dev
```

<div align="center">

Built on **Base** · Secured by **Aave V3** · Governed by **$SHIELD**

*Engineered by [NexTechArchitect](https://github.com/NexTechArchitect)*

</div>

