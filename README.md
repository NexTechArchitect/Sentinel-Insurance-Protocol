
<div align="center">

<img src="https://img.shields.io/badge/🛡️-Sentinel_Insurance_Protocol-2563EB?style=for-the-badge&labelColor=0f172a&color=2563EB" height="36"/>

# Decentralized On-Chain Insurance Infrastructure
### Base Mainnet · ERC-4626 Yield Routing · DAO Adjudication · Next.js 3D Engine 
<br>
 
[![Live App](https://img.shields.io/badge/Production-Live_App-22c55e?style=flat-square&logo=vercel)](https://sentinel-insurance-protocol.vercel.app/)
[![Network](https://img.shields.io/badge/Network-Base_Mainnet-0052FF?style=flat-square&logo=base)](https://basescan.org/)
[![Foundry](https://img.shields.io/badge/Contracts-Foundry-F0B90B?style=flat-square)](https://book.getfoundry.sh/)
[![Frontend](https://img.shields.io/badge/Frontend-Next.js_14-000000?style=flat-square&logo=next.js)](https://nextjs.org/)

<br> 

> **A highly modular, security-first DeFi insurance architecture.** <br>
> Token-weighted consensus adjudication, automated capital optimization via Aave V3, and flash-loan resistant governance voting—wrapped in a high-performance WebGL 3D interface. Securing real-world assets on the Base Layer-2 ecosystem.

<br>

<h3><a href="https://sentinel-insurance-protocol.vercel.app/">🚀 Launch Live Application</a></h3>

<a href="https://github.com/NexTechArchitect/Sentinel-Insurance-Protocol">💻 Source Code</a> &nbsp;·&nbsp;
<a href="https://basescan.org/address/0xEF80cd6370D4619D2f71BD4000a4757357Be5564">🔗 Core Contract</a> &nbsp;·&nbsp;
<a href="https://docs.base.org/">📘 Base Ecosystem</a>

</div>

---

## 🎯 What Makes SentinelShield Different

Most decentralized insurance protocols suffer from idle capital inefficiency and centralized claim adjudication. SentinelShield eliminates these bottlenecks through native ERC-4626 vault yield strategies, an immutable DAO governance pipeline, and a robust Next.js frontend operating efficiently on Base Mainnet.

| Architectural Challenge | The Sentinel Protocol Solution |
|:---|:---|
| **Capital Inefficiency (Idle TVL)** | `CoveragePool` implements ERC-4626, natively routing idle Native Circle USDC into Aave V3 Base Core to generate continuous APY for liquidity providers. |
| **Flash-Loan Voting Attacks** | `ClaimsGovernor` enforces historical checkpoint tracking (`block.number - 1`) ensuring only true long-term holders can vote on claim payouts. |
| **Centralized Claim Adjudication** | Fully decentralized outcome resolution. Claims are subjected to a strict 7-day token-weighted consensus voting window via the UI. |
| **Emergency Systemic Failures** | A secure `VetoCouncil` multisig serves as a structural safety valve to reject provably fraudulent claims without disrupting honest voters. |
| **Position Portability** | Active insurance policies are minted as dynamic `PolicyNFTs` (ERC-721), with 100% on-chain SVG art reflecting live policy states. |

---

## 📑 Table of Contents

1. [🏛️ Protocol Architecture](#-protocol-architecture)
2. [✅ Deployed Infrastructure (Base Mainnet)](#-deployed-infrastructure-base-mainnet)
3. [📁 Codebase Structure](#-codebase-structure)
4. [🧩 Contract Reference](#-contract-reference)
5. [🛡️ Security & Audit Profile](#-security--audit-profile)
6. [🛠️ Local Setup & Automation](#-local-setup--automation)

---

## 🏛️ Protocol Architecture

The system operates across three isolated execution layers governed by a unified Next.js dashboard. A failure in governance voting cannot drain the underlying capital vault.

```text
┌──────────────────────────────────────────────────────────────────┐
│                    WEB3 FRONTEND (Next.js / Wagmi)               │
│             App.SentinelShield.finance (Cinematic UI)            │
└───────────────────────────┬──────────────────────────────────────┘
                            │ (USDC / Proof URIs)
┌───────────────────────────▼──────────────────────────────────────┐
│                    POLICY ROUTING ENGINE                         │
│  PolicyEngine.sol  ──  RiskRegistry.sol  ──  PolicyNFT.sol (721) │
│  Validates risk profiles, routes premiums, and mints receipts    │
└────────────┬─────────────────────────────────┬───────────────────┘
             │                                 │
┌────────────▼────────────┐       ┌────────────▼────────────────── ┐
│ CAPITAL UNDERWRITING    │       │ DECENTRALIZED ADJUDICATION     │
│ CoveragePool.sol (4626) │       │ ClaimsGovernor.sol             │
│ Routes idle USDC to     │       │ Snapshot block-voting via      │
│ Aave V3 for LP yield.   │       │ ShieldToken.sol ($SHIELD)      │
└────────────┬────────────┘       └────────────┬────────────────── ┘
             │                                 │
┌────────────▼─────────────────────────────────▼───────────────────┐
│                    PAYOUT EXECUTION PIPELINE                     │
│  PayoutExecutor.sol ── VetoCouncil.sol (Emergency Multisig)      │
│  Unlocks CoveragePool liquidity upon successful consensus vote   │
└──────────────────────────────────────────────────────────────────┘

```

---

## ✅ Deployed Infrastructure (Base Mainnet)

All core systems are actively deployed, strictly wired, and cryptographically verified on **Base Mainnet**, handling live USDC assets.

### Core Engine & Governance

| Component | Address | Explorer |
| --- | --- | --- |
| **PolicyEngine** | `0xEF80cd6370D4619D2f71BD4000a4757357Be5564` | [Basescan ↗](https://www.google.com/url?sa=E&source=gmail&q=https://basescan.org/address/0xEF80cd6370D4619D2f71BD4000a4757357Be5564) |
| **CoveragePool** | `0x374d949c7A575212d423Ecc0e765a59664d7C3eD` | [Basescan ↗](https://www.google.com/search?q=https://basescan.org/address/0x374d949c7A575212d423Ecc0e765a59664d7C3eD) |
| **ClaimsGovernor** | `0xB7939f8b41C932595cf358842BC63AFE221D2Ba3` | [Basescan ↗](https://www.google.com/search?q=https://basescan.org/address/0xB7939f8b41C932595cf358842BC63AFE221D2Ba3) |
| **VetoCouncil** | `0x896627825AEAc934e4CAec4cb00EC8B90a5292B0` | [Basescan ↗](https://www.google.com/search?q=https://basescan.org/address/0x896627825AEAc934e4CAec4cb00EC8B90a5292B0) |

*(Refer to `web3-app/src/constants/contracts.ts` for the complete registry including Token & External Integrations).*

---

## 📁 Codebase Structure

The protocol is structured as a streamlined mono-repo separating EVM logic from the client application.

```text
Sentinel-Insurance-Protocol/
├── src/                 # Smart Contracts (Core, Governance, Oracles, Tokens)
├── script/              # Foundry Deployment & Execution Matrix
├── test/                # Fuzzing & Invariant Test Suites
└── web3-app/            # Next.js 14 Frontend & Wagmi Integrations

```

---

## 🧩 Contract Reference

* **`PolicyEngine.sol`**: Central hub for policy origination. Executes atomic validations, locks premiums, and triggers NFT minting.
* **`CoveragePool.sol` (ERC-4626)**: The capital vault. Sweeps surplus USDC into Aave V3 lending pools to accrue yield for LPs.
* **`ClaimsGovernor.sol`**: The decentralized adjudication machine featuring strict block-snapshot queries to neutralize flash-loan attacks.
* **`VetoCouncil.sol`**: A multi-signature threshold contract acting as a final fail-safe mechanism against fraudulent consensus.

---

## 🛡️ Security & Audit Profile

**Audit Engine:** Slither v0.10.x Static Analyzer

**Framework Integration:** Foundry (Forge Artifact Matrix with Yul IR Optimization)

**Security Status:** Deployed to Base Mainnet (✅ 100% Cleared)

> **Defense Validation:** The static scanning analysis confirms zero structural data-leakage vectors, non-reentrant state transitions, and absolute mathematical precision across internal processing paths. Fuzz and invariant depth configured to enterprise standards.

---

## 🛠️ Local Setup & Automation

### 1. Smart Contracts (Foundry)

```bash
git clone [https://github.com/NexTechArchitect/Sentinel-Insurance-Protocol.git](https://github.com/NexTechArchitect/Sentinel-Insurance-Protocol.git)
cd Sentinel-Insurance-Protocol

# Install dependencies and compile
forge install
make compile

# Mainnet Fork Simulation
forge script script/DeploySentinel.s.sol:DeploySentinel --rpc-url [https://mainnet.base.org](https://mainnet.base.org) -vvv

```

### 2. Web3 Frontend (Next.js)

```bash
cd web3-app
npm install

# Run local development server
npm run dev

```

---

<div align="center">
**SentinelShield Protocol**

*Engineered for the Decentralized Frontier.*

Architected by **NexTechArchitect**

Smart Contract Engineer & Full-Stack Web3 Developer
