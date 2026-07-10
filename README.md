

# ⚙️ On-Chain Automation Protocol

### Base Mainnet · Decentralized · Slashing-Secured

> **A fully decentralized automation protocol for Ethereum smart contracts.** 
> 
> 
> 
> 
> Keepers bond ETH to a slashing-secured registry to monitor and execute recurring on-chain jobs.

💻 Source Code  · 
🔗 Core Registry

---

## 🎯 What Makes This Protocol Different

Most smart contract automation relies on centralized cron-bots or permissioned multi-sigs. This protocol eliminates centralized triggers by creating a permissionless, cryptographically secured economic game for independent keepers.

| Traditional Execution | Protocol Solution |
| --- | --- |
| Centralized bot failure halts network | Permissionless execution allows any bonded keeper to step in |
| Malicious triggers drain target contracts | Hard ETH bonding, automated slashing, and permanent jailing |
| One failing job reverts the entire batch | ExecutionEngine uses `try/catch` fault isolation per job |
| Unbounded iteration gas limits | `O(1)` swap-and-pop arrays and strict bounds on active job lists |

---

## 🏗️ Core Architecture Invariants

**1. Fault Isolation**
The ExecutionEngine never holds a standing ETH balance. It routes calls and catches errors. If Job A reverts due to out-of-gas or a malicious target, Job B and Job C in the same batch execute successfully.

**2. Absolute Solvency**
KeeperRegistry ETH balance strictly equals the sum of all active, exiting, and jailed bonds. JobManager ETH balance strictly equals reward pools plus accumulated protocol fees.

**3. Checks-Effects-Interactions (CEI)**
All state transitions, reputation penalties, and bond deductions occur before any external call is made to a target contract, nullifying reentrancy vectors.

---

## ✅ Deployed Contracts

All contracts are deployed and verified on **Base Mainnet**.

| Contract | Address | Network Explorer |
| --- | --- | --- |
| **KeeperRegistry** | `0xcEa37b9CCA6170d43BF133CCfdeaD9CB2A4D61D3` | [↗ Basescan](https://www.google.com/search?q=https://basescan.org/address/0xcEa37b9CCA6170d43BF133CCfdeaD9CB2A4D61D3) |
| **JobManager** | `0xBAa2B4c250DD6da358e23244C2fa85dA1927718C` | [↗ Basescan](https://www.google.com/search?q=https://basescan.org/address/0xBAa2B4c250DD6da358e23244C2fa85dA1927718C) |
| **ExecutionEngine** | `0x388665c32F9F17E0d5cfEE3Eabe1880A3AEd80e9` | [↗ Basescan](https://www.google.com/search?q=https://basescan.org/address/0x388665c32F9F17E0d5cfEE3Eabe1880A3AEd80e9) |

---

## 🧩 Contract Reference

* **KeeperRegistry.sol**: Handles keeper onboarding, ETH bonding, unbonding cooldowns, and the slashing/jailing mechanisms.
* **JobManager.sol**: Manages job lifecycles (register, pause, cancel) and reward pool escrow. Splits protocol fees via pull-payment architecture.
* **ExecutionEngine.sol**: The execution router. Validates keeper active status, checks job readiness, and executes target logic.
* **KeeperMath.sol**: Pure library for calculating reward splits, slashing penalties, and block-interval timings.

---

## 🔐 Security & Auditing

The protocol is secured by rigorous automated testing and static analysis to ensure economic stability under adversarial conditions.

### Static Analysis (Slither)

* **0 Critical, 0 High, 0 Medium findings.**
* All informational findings were manually reviewed and mitigated by design.
* *Note on loops:* Slither flags external calls inside the batch execution loop. This is an intentional design; the `try/catch` block isolates each call, ensuring a malicious target cannot revert the overarching transaction.

### Testing Coverage

* **Unit & Integration:** Complete coverage of state transitions, access controls, and cross-contract logic.
* **Stateful Invariant Testing:** Withstood extensive randomized fuzzing sequences. Invariants confirmed that accounting never drifts, the registry never loses ETH-to-bond parity, and the execution engine leaves zero stranded funds.

---

## 💻 Local Development

Requires [Foundry](https://book.getfoundry.sh/) and Git.

```bash
git clone https://github.com/NexTechArchitect/OnChain-Automation-Protocol.git
cd OnChain-Automation-Protocol

# Install dependencies and build
forge install && forge build

# Run invariant and unit tests
forge test -vvv

```

**Local / Mainnet Deployment**
Execution configuration via Makefile.

```bash
source .env && forge script script/DeployKeeperNetwork.s.sol:DeployKeeperNetwork --rpc-url $(BASE_MAINNET_URL) --private-key $(PRIVATE_KEY) --broadcast --verify -vvvv

```

---

Built on **Base** · Secured by **Foundry** · Executed by **Keepers**

*Engineered by [NexTechArchitect*](https://github.com/NexTechArchitect)
