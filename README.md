
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
> Token-weighted consensus adjudication, automated capital optimization via Aave V3, and flash-loan resistant governance voting wrapped in a high-performance WebGL 3D interface. Securing real-world assets on the Base Layer-2 ecosystem.

<br>

<h3><a href="https://sentinel-insurance-protocol.vercel.app/">🚀 Launch Live Application</a></h3>

<a href="https://github.com/NexTechArchitect/Sentinel-Insurance-Protocol">💻 Source Code</a> &nbsp;·&nbsp;
<a href="https://basescan.org/address/0xEF80cd6370D4619D2f71BD4000a4757357Be5564">🔗 Core Contract (Verified)</a> &nbsp;·&nbsp;
<a href="https://docs.base.org/">📘 Base Ecosystem</a>

</div>

---

## 🎯 The Problem & The Sentinel Solution

Traditional decentralized insurance protocols face three critical bottlenecks: **severe capital inefficiency** (locking collateral without yield), **centralized claim adjudication** (relying on single points of failure), and **vulnerability to flash-loan governance attacks**. 

SentinelShield fundamentally re-architects this model.

| The Core Problem | The Sentinel Solution |
| :--- | :--- |
| **Capital Inefficiency (Idle TVL)**<br>Locked collateral sits idle, creating a massive opportunity cost for liquidity providers. | **Automated Yield Routing**<br>`CoveragePool` implements an ERC-4626 vault architecture, natively routing idle USDC into the Aave V3 Base Core to generate continuous APY, ensuring zero capital drag. |
| **Governance Manipulation**<br>Whales use flash-loans to borrow tokens, pass malicious claims, and dump the tokens in a single block. | **Flash-Resistant DAO Consensus**<br>`ClaimsGovernor` enforces strict `block.number - 1` snapshot voting, ensuring only genuine, long-term $SHIELD holders can influence claim adjudication. |
| **Centralized Points of Failure**<br>Protocols rely on centralized oracles or a small multi-sig board to approve user payouts. | **Decentralized Adjudication Engine**<br>Claims undergo a strict 7-day token-weighted public consensus window. A multi-sig `VetoCouncil` exists *only* as a structural safety valve against systemic fraud, not for standard approvals. |
| **Illiquid & Static Policies**<br>Insurance receipts are non-transferable data points hidden in contract state. | **Dynamic On-Chain NFT Portfolios**<br>Active policies are minted as fully transferable ERC-721 `PolicyNFTs` with dynamically generated SVG art reflecting real-time coverage states directly on-chain. |

---

## 📑 Table of Contents

1. [🏛️ Protocol Architecture](#protocol-architecture)
2. [✅ Deployed Infrastructure (Base Mainnet)](#deployed-infrastructure)
3. [📁 Codebase Structure](#codebase-structure)
4. [🧩 Contract Reference](#contract-reference)
5. [🛡️ Security & Audit Profile](#security-audit)
6. [🛠️ Local Setup & Automation](#local-setup)

---

## <a id="protocol-architecture"></a> 🏛️ Protocol Architecture

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

##  ✅ Deployed Infrastructure (Base Mainnet)

All core systems are actively deployed, strictly wired, and cryptographically verified on **Base Mainnet**, handling live USDC assets.

*(Click on any address to view verified on-chain code and live transactions directly on Basescan).*

### Core Engine & Governance

| Component | Address | Explorer Link |
| --- | --- | --- |
| **PolicyEngine** | `0xEF80cd6370D4619D2f71BD4000a4757357Be5564` | [View on Basescan ↗](https://basescan.org/address/0xEF80cd6370D4619D2f71BD4000a4757357Be5564) |
| **CoveragePool** | `0x374d949c7A575212d423Ecc0e765a59664d7C3eD` | [View on Basescan ↗](https://basescan.org/address/0x374d949c7A575212d423Ecc0e765a59664d7C3eD) |
| **ClaimsGovernor** | `0xB7939f8b41C932595cf358842BC63AFE221D2Ba3` | [View on Basescan ↗](https://basescan.org/address/0xB7939f8b41C932595cf358842BC63AFE221D2Ba3) |
| **VetoCouncil** | `0x896627825AEAc934e4CAec4cb00EC8B90a5292B0` | [View on Basescan ↗](https://basescan.org/address/0x896627825AEAc934e4CAec4cb00EC8B90a5292B0) |

*(Refer to `web3-app/src/constants/contracts.ts` for the complete registry including Token & External Integrations).*

---

##  📁 Codebase Structure

The protocol is structured as a streamlined mono-repo separating EVM logic from the client application.

```text
Sentinel-Insurance-Protocol/
├── src/                 # Smart Contracts (Core, Governance, Oracles, Tokens)
├── script/              # Foundry Deployment & Execution Matrix
├── test/                # Fuzzing & Invariant Test Suites
└── web3-app/            # Next.js 14 Frontend & Wagmi Integrations

```

---

##  🧩 Contract Reference

* **`PolicyEngine.sol`**: Central hub for policy origination. Executes atomic validations, locks premiums, and triggers NFT minting.
* **`CoveragePool.sol` (ERC-4626)**: The capital vault. Sweeps surplus USDC into Aave V3 lending pools to accrue yield for LPs.
* **`ClaimsGovernor.sol`**: The decentralized adjudication machine featuring strict block-snapshot queries to neutralize flash-loan attacks.
* **`VetoCouncil.sol`**: A multi-signature threshold contract acting as a final fail-safe mechanism against fraudulent consensus.

---

##  🛡️ Security & Audit Profile

**Audit Engine:** Slither v0.10.x Static Analyzer

**Framework Integration:** Foundry (Forge Artifact Matrix with Yul IR Optimization)

**Security Status:** Deployed to Base Mainnet (✅ 100% Cleared)

> **Defense Validation:** The static scanning analysis confirms zero structural data-leakage vectors, non-reentrant state transitions, and absolute mathematical precision across internal processing paths. Fuzz and invariant depth configured to enterprise standards.

---

##  🛠️ Local Setup & Automation

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
<div align="center">
<br>

**SentinelShield Protocol** 
<br>
Architected by **NexTechArchitect** Smart Contract Engineer & Web3 Developer
