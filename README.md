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
- [Security](#security)
- [Local Development](#local-development)

---

## Overview

SentinelShield re-architects the three core failures of traditional DeFi insurance:

| Problem | Solution |
|:---|:---|
| **Idle Capital (Zero Yield)** | `CoveragePool` implements ERC-4626, routing all idle USDC into Aave V3 Base Core — continuous APY with zero capital drag. |
| **Flash-Loan Governance Attacks** | `ClaimsGovernor` enforces `block.number - 1` snapshot voting — only genuine long-term `$SHIELD` holders influence adjudication. |
| **Centralized Claim Approval** | 7-day public token-weighted voting window. `VetoCouncil` multisig exists solely as an emergency fraud safety valve, not for standard approvals. |
| **Non-Transferable Static Policies** | Active policies mint as ERC-721 `PolicyNFTs` with fully on-chain SVG art reflecting real-time coverage state. Soulbound via ERC-5484. |

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

- All role assignments are one-time immutable (no admin key rotation attack surface)
- CEI (Checks-Effects-Interactions) enforced on every state-changing function
- `ReentrancyGuard` on all external entry points touching capital
- Flash-loan immunity via ERC20Votes `getPastVotes(addr, block.number - 1)`

---

## Deployed Contracts

All contracts are deployed, verified, and live on **Base Mainnet** (Chain ID: `8453`).

### Protocol Contracts

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

### External Integrations

| Protocol | Address | Basescan |
|:---|:---|:---|
| **Aave V3 Pool** | `0xA238Dd80C259b705191C65851448bB1e2D3b3790` | [↗ View](https://basescan.org/address/0xA238Dd80C259b705191C65851448bB1e2D3b3790) |
| **USDC (Native)** | `0x833589fCD6eDb6E08f4c7C32D4f71b54bda02913` | [↗ View](https://basescan.org/address/0x833589fCD6eDb6E08f4c7C32D4f71b54bda02913) |
| **aUSDC (Aave)** | `0x724dc807b0491c6b13239c33e2182c40c741ea1c` | [↗ View](https://basescan.org/address/0x724dc807b0491c6b13239c33e2182c40c741ea1c) |

---

## Contract Reference

### `PolicyEngine.sol`
Central hub for policy origination. Validates protocol eligibility via `RiskRegistry`, calculates premiums via `PremiumMath`, pulls USDC from the buyer, routes premiums to `CoveragePool`, locks coverage collateral, and mints a soulbound `PolicyNFT`. Also handles cancellations (pro-rated refund via pull pattern) and expiry (public keeper function).

### `CoveragePool.sol` — ERC-4626
The capital vault. All deposited USDC is automatically supplied to Aave V3 Base Core via the `_deposit` hook, accruing continuous yield for LPs. `totalAssets()` reads live `aUSDC` balance, so share pricing reflects real-time yield. A `_decimalsOffset()` of `6` mitigates share inflation attacks for USDC's 6-decimal precision. Free vs locked liquidity is tracked to prevent LP withdrawals from eating into active coverage collateral.

### `ClaimsGovernor.sol`
The adjudication engine. Policyholders file claims with IPFS/Arweave evidence. A 7-day voting window opens immediately; `$SHIELD` holders vote using balances snapshotted at `block.number - 1` to neutralize same-block flash-loan manipulation. `finalizeClaim()` is a public keeper function — anyone can call it after the window closes. Quorum is 1% of total supply; simple majority wins.

### `VetoCouncil.sol`
M-of-N multisig safety valve. Guardians can collectively veto a `PENDING` claim before it finalizes. Designed only for systemic fraud or governance attacks — not routine claim review. Threshold and guardian set are owner-managed with safe invariant checks.

### `PayoutExecutor.sol`
Single-purpose payout executor. After a claim reaches `APPROVED`, anyone can call `executePayout()` (keeper pattern). Marks the claim `EXECUTED` in `ClaimsGovernor` before withdrawing from `CoveragePool` (CEI). Emits `PayoutFailed` instead of reverting on pool failure to prevent claims getting permanently stuck.

### `RiskRegistry.sol`
Owner-controlled registry of insurable protocols. Stores `riskScore` (0–100), `audited` status, `coverageCap`, and `active` flag per protocol. `PolicyEngine` queries this for eligibility checks and premium inputs. Protocols can be blacklisted without affecting existing active policies.

### `ShieldToken.sol` — ERC-20 Votes
Governance token. Implements `ERC20Votes` for snapshot-based voting power, `ERC20Permit` for gasless approvals, and `ERC20Burnable`. Hard-capped at 100M `$SHIELD`. Users must `delegate()` before their balance counts as voting power.

### `PolicyNFT.sol` — ERC-721 Soulbound
Non-transferable policy receipt (ERC-5484). Dynamically rendered on-chain SVG via `PolicyNFTSVG` library — no IPFS dependency. Status updates trigger `MetadataUpdate` (ERC-4906) for indexer cache invalidation. Burn-on-cancel keeps state clean.

---

## Security

**Static Analysis:** Slither v0.10.x — zero high/medium findings on deployed build.

**Framework:** Foundry with Yul IR optimization, fuzz testing, and invariant suites.

**Key mitigations implemented:**

- Flash-loan resistant voting via `ERC20Votes.getPastVotes(addr, block.number - 1)`
- CEI pattern enforced on all capital-touching functions
- `ReentrancyGuard` on `CoveragePool`, `ClaimsGovernor`, `PolicyEngine`, `PayoutExecutor`
- One-time role initialization (no post-deploy admin key rotation)
- Pull-pattern refunds to prevent DoS via reverting recipients
- `_decimalsOffset = 6` in ERC-4626 prevents share inflation attacks
- `Ownable2Step` on all privileged contracts — two-step ownership transfer

> **Disclaimer:** Slither static analysis is not a substitute for a full manual audit. Use at your own risk. Smart contracts on mainnet carry inherent financial risk.

---

## Local Development

### Prerequisites

- [Foundry](https://book.getfoundry.sh/getting-started/installation)
- [Node.js](https://nodejs.org/) v18+
- [Git](https://git-scm.com/)

### Smart Contracts

```bash
git clone https://github.com/NexTechArchitect/Sentinel-Insurance-Protocol.git
cd Sentinel-Insurance-Protocol

# Install dependencies
forge install

# Compile
forge build

# Run tests (fuzz + invariant)
forge test -vvv

# Mainnet fork simulation
forge script script/DeploySentinel.s.sol:DeploySentinel \
  --rpc-url https://mainnet.base.org \
  --vvv
```

### Frontend

```bash
cd web3-app

# Install dependencies
npm install

# Start dev server
npm run dev
```

The frontend connects to Base Mainnet by default. Contract addresses are sourced from `web3-app/src/constants/contracts.ts`.

---

### Repository Structure

```
Sentinel-Insurance-Protocol/
├── src/
│   ├── core/           # PolicyEngine, CoveragePool, ClaimsGovernor, PayoutExecutor
│   ├── governance/     # ShieldToken, VetoCouncil
│   ├── registry/       # RiskRegistry
│   ├── token/          # PolicyNFT
│   ├── libraries/      # PremiumMath, ClaimValidator, PolicyNFTSVG
│   └── interfaces/     # All contract interfaces
├── script/             # Foundry deployment scripts
├── test/               # Fuzz & invariant test suites
└── web3-app/           # Next.js 14 frontend + Wagmi
```

---

<div align="center">

Built on **Base** · Secured by **Aave V3** · Governed by **$SHIELD**

*Engineered by [NexTechArchitect](https://github.com/NexTechArchitect)*

</div>
