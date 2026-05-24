'use client';

import React, { useEffect, useRef, useState, useCallback } from 'react';
import Link from 'next/link';

// ─── DATA ────────────────────────────────────────────────────────────────────

const CONTRACTS = [
  {
    num: '01', name: 'PolicyEngine', tag: 'CEI · NonReentrant', color: '#ffc676',
    addr: '0xa373BD4d832E34C960A7bF6BBf6190c939932b40',
    short: '0xa373…b40',
    etherscan: 'https://sepolia.etherscan.io/address/0xa373BD4d832E34C960A7bF6BBf6190c939932b40',
    icon: '⚙️',
    heading: 'The brain of policy issuance',
    body: `PolicyEngine is the central orchestration hub of SentinelShield. Every time a user buys coverage, this contract runs the entire atomic transaction — it validates the protocol against the RiskRegistry, checks that the pool has sufficient free liquidity, calculates the exact premium via PremiumMath, pulls USDC from the buyer, routes it to the CoveragePool as yield, locks the coverage collateral, and mints a soulbound PolicyNFT to the buyer's wallet — all within a single EVM execution frame that either succeeds completely or reverts cleanly. The payable modifier is present purely to bypass an EVM gas optimisation constraint; no ETH is ever accepted.`,
    detail: `One architectural decision worth noting: the ClaimsGovernor address is write-once — it can only be set by the owner once and can never be changed. This means that once the system is live, PolicyEngine's connection to governance is permanent and immutable, preventing any future owner from routing claim adjudication to a malicious contract.`,
  },
  {
    num: '02', name: 'CoveragePool', tag: 'ERC-4626 · Aave V3', color: '#58daff',
    addr: '0x2bC42ae97A20b4f06F35C42e2Fb82A0550fAAf18',
    short: '0x2bC4…f18',
    etherscan: 'https://sepolia.etherscan.io/address/0x2bC42ae97A20b4f06F35C42e2Fb82A0550fAAf18',
    icon: '🏦',
    heading: 'The capital vault',
    body: `CoveragePool is where the money lives. It is a fully ERC-4626 compliant vault with one critical modification: every deposit is immediately forwarded to Aave V3, where it earns continuous yield for liquidity providers. The vault tracks two separate buckets of USDC — "free" liquidity that is available for new policies or LP withdrawals, and "locked" liquidity that has been reserved as collateral for active policies. These two buckets are enforced at the mathematical level: the _withdraw hook reverts if a withdrawal would eat into locked collateral.`,
    detail: `The decimals offset of 6 is a deliberate inflation-attack mitigation. Since USDC only has 6 decimals, the vault applies a 10^6 virtual share multiplier so that the first depositor cannot manipulate the share price by donating dust. This is OpenZeppelin's recommended approach for ERC-4626 vaults with low-decimal underlying assets.`,
  },
  {
    num: '03', name: 'RiskRegistry', tag: 'Ownable2Step · Pausable', color: '#c484ff',
    addr: '0xE94a55ac7678013ff68B8c26A3337A0DCe7a5210',
    short: '0xE94a…210',
    etherscan: 'https://sepolia.etherscan.io/address/0xE94a55ac7678013ff68B8c26A3337A0DCe7a5210',
    icon: '📋',
    heading: 'The source of truth for risk',
    body: `RiskRegistry is the on-chain database that defines what can be insured and at what cost. Every protocol that SentinelShield covers must be registered here with a risk score between 0 and 100, an audit status flag, and a coverage cap. The risk score directly feeds into PremiumMath — a protocol scoring 80 pays a premium roughly 2.6x higher than one scoring 30. The audit status gives a flat 20% discount on top of the risk-score calculation. The coverage cap prevents any single protocol from consuming the entire pool.`,
    detail: `The blacklist mechanism is deliberately asymmetric with the pause. Pausing halts all registry management operations. But blacklisting a protocol — which prevents new policies being issued for it — ignores the pause state. This is intentional: if a protocol suffers an exploit and the owner needs to halt new coverage immediately, they should not be blocked by an administrative pause.`,
  },
  {
    num: '04', name: 'ClaimsGovernor', tag: 'Snapshot Voting · Flash-Loan Resistant', color: '#ff687c',
    addr: '0xDc89D29Dc89178bE772EAf6E3587eB863Df6Ae8a',
    short: '0xDc89…Ae8a',
    etherscan: 'https://sepolia.etherscan.io/address/0xDc89D29Dc89178bE772EAf6E3587eB863Df6Ae8a',
    icon: '⚖️',
    heading: 'The adjudication machine',
    body: `ClaimsGovernor is where a filed claim lives and dies. When a policyholder submits a claim with IPFS or Arweave evidence, the contract takes an immutable snapshot of SHIELD token balances at block.number - 1. This historical checkpoint is the key flash-loan defence: any attacker who borrows SHIELD tokens in the same block as the claim filing will find their borrowed balance was not present at the snapshot block and therefore carries zero voting weight. The 7-day voting window then opens, during which any wallet with historical SHIELD balance can cast a token-weighted vote.`,
    detail: `The VetoCouncil address and PayoutExecutor address are both write-once configurations here as well. Once set, neither can be changed. This makes the protocol's emergency override path permanent — the set of guardians who can veto a fraudulent claim cannot be silently swapped out after the fact.`,
  },
  {
    num: '05', name: 'ShieldToken', tag: 'ERC-20Votes · EIP-712', color: '#4af5b2',
    addr: '0x3D202f0Af4614DA97eDeC5326c585b9C6E29d4AF',
    short: '0x3D20…4AF',
    etherscan: 'https://sepolia.etherscan.io/address/0x3D202f0Af4614DA97eDeC5326c585b9C6E29d4AF',
    icon: '🛡️',
    heading: 'The governance token',
    body: `ShieldToken ($SHIELD) is the voting backbone of the entire protocol. It implements ERC20Votes — the OpenZeppelin extension that enables historical balance checkpointing — which is what makes flash-loan-resistant governance possible. Holders must delegate their votes to themselves or another address before their balance counts. This is a standard ERC-20Votes requirement: holding tokens without delegating means zero voting power. The token is capped at 100 million SHIELD total supply with no inflation mechanic — only the owner can mint, and only up to the hardcoded cap.`,
    detail: `The EIP-712 Permit extension allows gasless approvals via signature. For governance contexts, this means a holder can authorise a third party to vote on their behalf without needing to pay gas for the approval transaction. Combined with ERC20Votes' getPastVotes(), this creates a clean delegated voting stack.`,
  },
  {
    num: '06', name: 'VetoCouncil', tag: 'M-of-N Multisig · Emergency Circuit', color: '#ffae48',
    addr: '0x00493Da33899ea9FB9Fe5401dDa9EcE7F92319Ab',
    short: '0x0049…9Ab',
    etherscan: 'https://sepolia.etherscan.io/address/0x00493Da33899ea9FB9Fe5401dDa9EcE7F92319Ab',
    icon: '🔒',
    heading: 'The emergency safety valve',
    body: `VetoCouncil is the last line of defence against sophisticated governance attacks or fraudulent claims that somehow acquired enough SHIELD votes to pass. It implements an M-of-N multisignature pattern: a configurable set of guardians can each sign a veto proposal for any pending claim, and once the signature count meets the threshold, the veto is automatically executed against ClaimsGovernor. Crucially, a veto can only be applied while a claim is still PENDING — it cannot retroactively undo an already-executed payout. This makes the VetoCouncil a circuit breaker, not a rug mechanism.`,
    detail: `The CEI pattern is applied even within the veto execution: the VetoExecuted event is emitted before the external call to ClaimsGovernor.vetoClaim(). This prevents any theoretical reentrancy into the VetoCouncil's own state from an untrusted ClaimsGovernor, even though the current ClaimsGovernor is trusted.`,
  },
  {
    num: '07', name: 'PolicyNFT', tag: 'ERC-5484 Soulbound · On-chain SVG', color: '#b2c6ff',
    addr: '0xbB6314f9775209e0999280BFE7e7A316ADc5b75C',
    short: '0xbB63…b75C',
    etherscan: 'https://sepolia.etherscan.io/address/0xbB6314f9775209e0999280BFE7e7A316ADc5b75C',
    icon: '🖼️',
    heading: 'The soulbound policy receipt',
    body: `PolicyNFT issues one non-transferable ERC-721 token per purchased policy. The soulbound enforcement is implemented at the lowest possible level — the _update() hook in OpenZeppelin's ERC-721 v5 base. Any call that would move a token from one non-zero address to another non-zero address is unconditionally reverted. This cannot be bypassed by any external call path because _update() is the single choke point for all ERC-721 balance mutations. The token's metadata — including a rendered SVG badge showing the policy status, protocol, coverage amount, and expiry — is generated entirely in Solidity by PolicyNFTSVG and returned as a Base64 data URI directly from tokenURI().`,
    detail: `The ERC-4906 MetadataUpdate event is emitted whenever a policy status changes — when it expires, is claimed, or is cancelled. Any marketplace or dashboard that implements ERC-4906 will automatically refresh the token's displayed artwork when this event fires, without any off-chain intervention.`,
  },
  {
    num: '08', name: 'PayoutExecutor', tag: 'Keeper Pattern · CEI', color: '#ffec84',
    addr: '0x004FF5Ce04AcC4106100C283edf2A69Fb879BdCb',
    short: '0x004F…BdCb',
    etherscan: 'https://sepolia.etherscan.io/address/0x004FF5Ce04AcC4106100C283edf2A69Fb879BdCb',
    icon: '💸',
    heading: 'The payout execution engine',
    body: `PayoutExecutor is a deliberately simple contract with exactly one job: execute a USDC payout when a claim has been formally approved by governance. It is callable by anyone — there is no privilege in triggering a payout, because the democratic process has already completed. Any keeper, bot, or manual user can call executePayout() for an APPROVED claim. The contract reads the claim from ClaimsGovernor, reads the policy details from PolicyEngine, verifies the payout amount does not exceed the locked collateral, marks the claim as EXECUTED in ClaimsGovernor first (CEI), then instructs CoveragePool to withdraw the USDC from Aave and send it directly to the claimant.`,
    detail: `The CEI application here is particularly important. By marking the claim as EXECUTED before calling CoveragePool, any reentrancy back into PayoutExecutor would find the claim status is EXECUTED, not APPROVED, and would revert. This means the payout can only ever be sent once regardless of how the external call behaves.`,
  },
];

const PRINCIPLES = [
  {
    num: '01', title: 'Separation of concerns taken seriously',
    body: `SentinelShield's architecture deliberately separates three concerns that DeFi protocols routinely conflate: capital management, policy administration, and governance adjudication. The CoveragePool knows nothing about policy terms — it only knows how much USDC is locked per policy ID. The PolicyEngine knows nothing about claims voting — it only knows whether a policy is active. The ClaimsGovernor knows nothing about USDC movements — it only manages claim state transitions. A bug in one layer cannot cascade into another because there are no shared state variables between contracts.`,
    color: '#58daff',
  },
  {
    num: '02', title: 'Flash-loan resistance is not optional',
    body: `Most DeFi governance protocols are vulnerable to flash-loan governance attacks: borrow a large amount of governance token in a single transaction, vote, repay. SentinelShield closes this vector at the source. ClaimsGovernor queries SHIELD balances using getPastVotes(voter, snapshotBlock) where snapshotBlock is block.number - 1 at the time of claim filing. Tokens borrowed in the current block do not appear in any historical checkpoint. A flash loan that buys voting power in block N cannot vote on a claim filed in block N because the snapshot was taken at block N-1. This protection is cryptographically guaranteed by ERC-20Votes checkpoint mechanics, not by any custom logic.`,
    color: '#c484ff',
  },
  {
    num: '03', title: 'Write-once addresses prevent silent upgrades',
    body: `Every cross-contract address configuration in SentinelShield follows the same pattern: a boolean flag, a one-time setter, and a revert if called twice. PolicyEngine's ClaimsGovernor, CoveragePool's PolicyEngine, CoveragePool's PayoutExecutor, ClaimsGovernor's VetoCouncil, ClaimsGovernor's PayoutExecutor, PolicyNFT's PolicyEngine — every single wiring point is permanently set at deployment time and provably immutable thereafter. A compromised owner private key cannot silently reroute claims to a malicious adjudicator or redirect payouts to an attacker-controlled pool, because the routing addresses are already final.`,
    color: '#4af5b2',
  },
  {
    num: '04', title: 'No idle capital, ever',
    body: `A decentralised insurance protocol that parks USDC in a mapping is economically inefficient — the capital earns nothing while backing active policies. SentinelShield routes 100% of deposited USDC to Aave V3 the moment it enters the pool. Premiums collected from policy purchases are also immediately supplied to Aave. Even locked collateral earns aUSDC yield while it sits backing an active policy. LPs receive a yield stream from two sources simultaneously: Aave's base lending APY, and protocol premium flow. The share price of ssUSDC grows continuously even between policy purchases.`,
    color: '#ffc676',
  },
  {
    num: '05', title: 'CEI is applied without exception',
    body: `Every state-changing function in every contract follows the Checks-Effects-Interactions pattern without exception. Checks come first: validate inputs, verify caller permissions, confirm state preconditions. Effects come second: write all storage mutations before touching any external address. Interactions come last: external calls to other contracts, token transfers, Aave supply/withdraw operations. Reentrancy guards are applied on top of CEI as a belt-and-suspenders redundancy. The guards are present not because CEI has a gap, but because CEI is a manual guarantee that a single careless future modification could break — the guard makes it mechanical.`,
    color: '#ff687c',
  },
  {
    num: '06', title: 'Soulbound identity for real-world coverage semantics',
    body: `Insurance policies in the physical world are not tradeable assets. They are agreements between a specific insured party and an underwriter that a specific position will be covered. PolicyNFT enforces this semantic on-chain: a policy token minted to wallet A cannot be sold to wallet B, cannot be gifted, cannot be used as DeFi collateral. The policy covers exactly the wallet that purchased it, for exactly the protocol and amount specified at purchase time. The soulbound enforcement is not a soft social norm — it is a hard EVM revert on every transfer attempt. The only movements allowed are minting (address(0) → holder) and burning (holder → address(0)).`,
    color: '#b2c6ff',
  },
];

const FLOW_STEPS = [
  {
    num: '01', title: 'Risk assessment and quoting',
    body: 'A user selects a registered DeFi protocol and a coverage amount between $100 and $1,000,000 USDC. PolicyEngine calls quotePremium(), which reads the protocol\'s risk score and audit status from RiskRegistry and runs it through PremiumMath. The formula: (coverageAmount × BASE_RATE_BPS × riskScore × duration) / (100 × 10,000 × YEAR_SECONDS), with a 20% discount for audited protocols and a minimum of 1 USDC. The premium is a single one-time payment — no recurring costs.',
    color: '#58daff',
  },
  {
    num: '02', title: 'Policy purchase and collateral locking',
    body: 'The buyer approves the premium amount and calls buyPolicy(). PolicyEngine verifies eligibility, computes the premium, pulls USDC from the buyer, routes it to CoveragePool as yield-earning premium income, instructs CoveragePool to lock the coverage amount as reserved collateral, and mints a PolicyNFT (ERC-5484 Soulbound) to the buyer\'s wallet. The locked USDC immediately starts earning Aave V3 yield while backing the policy. All of this happens in a single atomic transaction.',
    color: '#ffc676',
  },
  {
    num: '03', title: 'Exploit event and claim filing',
    body: 'If the covered protocol suffers an exploit, the policyholder calls ClaimsGovernor.fileClaim() with an IPFS or Arweave URI containing exploit evidence — transaction hash, post-mortem, amount lost. The contract takes an immutable snapshot of SHIELD token balances at block.number - 1 (the flash-loan defence), opens a 7-day voting window, and emits ClaimFiled. The policy cannot be cancelled while a PENDING claim is active.',
    color: '#c484ff',
  },
  {
    num: '04', title: 'Token-weighted governance vote',
    body: 'During the 7-day window, any SHIELD holder with historical balance at the snapshot block can call castVote(claimId, true/false). Voting power is proportional to historical token balance. Double-voting is prevented by a per-claim-per-address flag. After the window closes, anyone can call finalizeClaim(). The claim passes if total votes reach the 1% quorum threshold and yes votes exceed no votes. Failed quorum or majority-no results in REJECTED status.',
    color: '#ff687c',
  },
  {
    num: '05', title: 'VetoCouncil intervention (if needed)',
    body: 'At any point while a claim is PENDING, the VetoCouncil can veto it if a threshold of guardian signatures is collected. A veto permanently cancels the claim and prevents payout. This is the emergency circuit for provably fraudulent claims — coordinated fake exploits, spam claims, or edge cases where governance was genuinely gamed despite the flash-loan protections. Once APPROVED or beyond, the veto can no longer be applied.',
    color: '#ffae48',
  },
  {
    num: '06', title: 'Payout execution',
    body: 'Once a claim reaches APPROVED status, any external actor can call PayoutExecutor.executePayout(claimId). The executor verifies the claim is APPROVED, reads the coverage amount from PolicyEngine, marks the claim EXECUTED (CEI — before the external call), then instructs CoveragePool to withdraw the exact coverage amount from Aave V3 and transfer it directly to the policyholder\'s wallet. The payout cannot be triggered twice because the EXECUTED status check prevents re-entry.',
    color: '#4af5b2',
  },
];

// ─── Floating ribbon background ───────────────────────────────────────────────
function RibbonBackground() {
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 0, pointerEvents: 'none', overflow: 'hidden' }}>
      {/* Base gradient */}
      <div style={{
        position: 'absolute', inset: 0,
        background: `
          radial-gradient(ellipse 90% 60% at 8% 4%, rgba(8,20,48,0.9) 0%, transparent 55%),
          radial-gradient(ellipse 70% 50% at 90% 8%, rgba(28,8,55,0.7) 0%, transparent 50%),
          radial-gradient(ellipse 55% 45% at 50% 88%, rgba(5,30,20,0.5) 0%, transparent 52%),
          radial-gradient(ellipse 40% 35% at 5% 90%, rgba(8,24,14,0.4) 0%, transparent 48%),
          #010208
        `,
      }} />

      {/* Animated mesh orbs */}
      <div style={{ position:'absolute', inset:0 }}>
        {[
          { w:380, top:'-6%', left:'-4%',  bg:'radial-gradient(circle at 30% 28%,rgba(10,30,80,0.85),rgba(25,8,60,0.65),transparent 72%)',   anim:'orbFloat0 8s ease-in-out infinite' },
          { w:280, top:'-3%', right:'2%',  bg:'radial-gradient(circle at 65% 22%,rgba(45,8,80,0.7),rgba(10,15,55,0.5),transparent 70%)',      anim:'orbFloat1 7s ease-in-out 1s infinite' },
          { w:320, top:'38%', left:'62%',  bg:'radial-gradient(circle at 40% 40%,rgba(5,40,30,0.6),rgba(8,28,20,0.4),transparent 68%)',        anim:'orbFloat2 9s ease-in-out 2s infinite' },
          { w:260, top:'65%', left:'-2%',  bg:'radial-gradient(circle at 55% 55%,rgba(20,5,60,0.55),rgba(8,15,45,0.38),transparent 65%)',      anim:'orbFloat3 6s ease-in-out 0.5s infinite' },
          { w:200, top:'80%', right:'8%',  bg:'radial-gradient(circle at 35% 35%,rgba(5,30,60,0.5),rgba(10,20,40,0.32),transparent 62%)',      anim:'orbFloat0 10s ease-in-out 3s infinite' },
        ].map((o, i) => (
          <div key={i} style={{
            position:'absolute', width:o.w, height:o.w, borderRadius:'50%',
            background:o.bg, top:o.top, left:o.left, right:o.right,
            animation:o.anim, filter:'blur(1px)',
          }} />
        ))}
      </div>

      {/* Subtle horizontal scan lines */}
      <div style={{
        position:'absolute', inset:0, opacity:0.018,
        backgroundImage:'repeating-linear-gradient(0deg, transparent, transparent 3px, rgba(88,218,255,0.5) 3px, rgba(88,218,255,0.5) 4px)',
        backgroundSize:'100% 4px',
      }} />

      {/* Top shimmer line */}
      <div style={{ position:'absolute', top:0, left:0, right:0, height:1, background:'linear-gradient(90deg,transparent,rgba(88,218,255,0.15),transparent)' }} />
    </div>
  );
}

// ─── Scroll reveal hook ───────────────────────────────────────────────────────
function useReveal() {
  const [visible, setVisible] = useState<Set<string>>(new Set());
  useEffect(() => {
    const obs = new IntersectionObserver(
      entries => entries.forEach(e => { if (e.isIntersecting) setVisible(p => new Set([...p, e.target.id])); }),
      { threshold: 0.06 }
    );
    document.querySelectorAll('[data-reveal]').forEach(el => obs.observe(el));
    return () => obs.disconnect();
  }, []);
  const rv = useCallback((id: string, delay = 0): React.CSSProperties => ({
    opacity: visible.has(id) ? 1 : 0,
    transform: visible.has(id) ? 'translateY(0) scale(1)' : 'translateY(20px) scale(0.99)',
    transition: `opacity 0.65s cubic-bezier(0.16,1,0.3,1) ${delay}ms, transform 0.65s cubic-bezier(0.16,1,0.3,1) ${delay}ms`,
  }), [visible]);
  return { rv };
}

// ─── Table of contents ────────────────────────────────────────────────────────
const TOC = [
  ['01', 'The Problem', '#problem'],
  ['02', 'How It Works', '#how'],
  ['03', 'Architecture Overview', '#arch'],
  ['04', 'The Eight Contracts', '#contracts'],
  ['05', 'PremiumMath — Pricing Model', '#math'],
  ['06', 'ClaimValidator — Adjudication Rules', '#validator'],
  ['07', 'PolicyNFTSVG — On-chain Art', '#svg'],
  ['08', 'Protocol Flow End-to-End', '#flow'],
  ['09', 'Design Philosophy', '#philosophy'],
  ['10', 'Security Model', '#security'],
  ['11', 'Deployed Addresses', '#deployed'],
];

// ─── Main ─────────────────────────────────────────────────────────────────────
export default function DocsPage() {
  const { rv } = useReveal();
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    const fn = () => setScrolled(window.scrollY > 55);
    window.addEventListener('scroll', fn, { passive: true });
    return () => window.removeEventListener('scroll', fn);
  }, []);

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,500;0,600;0,700;1,600;1,700;1,800&family=Space+Grotesk:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600;700&display=swap');

        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        html { scroll-behavior: smooth; background: #010208; }
        body { background: #010208; color: #e8f0ff; font-family: 'Space Grotesk', sans-serif; overflow-x: hidden; -webkit-font-smoothing: antialiased; -webkit-tap-highlight-color: transparent; }
        ::selection { background: rgba(88,218,255,0.18); }
        ::-webkit-scrollbar { width: 2px; }
        ::-webkit-scrollbar-track { background: #010208; }
        ::-webkit-scrollbar-thumb { background: rgba(88,218,255,0.3); border-radius: 1px; }

        @keyframes orbFloat0 { 0%,100%{transform:translate(0,0) scale(1)} 40%{transform:translate(20px,-28px) scale(1.03)} 70%{transform:translate(-12px,16px) scale(0.98)} }
        @keyframes orbFloat1 { 0%,100%{transform:translate(0,0)} 50%{transform:translate(-24px,20px)} }
        @keyframes orbFloat2 { 0%,100%{transform:translate(0,0)} 45%{transform:translate(16px,-20px)} 80%{transform:translate(-8px,12px)} }
        @keyframes orbFloat3 { 0%,100%{transform:translate(0,0) rotate(0deg)} 50%{transform:translate(12px,-16px) rotate(2deg)} }
        @keyframes shimmerTitle { 0%{background-position:-200% center} 100%{background-position:200% center} }
        @keyframes heroFadeUp { from{opacity:0;transform:translateY(20px)} to{opacity:1;transform:translateY(0)} }
        @keyframes liveDot { 0%,100%{transform:scale(1);opacity:0.9} 50%{transform:scale(1.8);opacity:0.35} }
        @keyframes scrollHint { 0%,100%{transform:translateY(0);opacity:0.35} 50%{transform:translateY(8px);opacity:0.75} }
        @keyframes scanLine { from{top:-2px} to{top:100%} }

        /* ── Nav ── */
        .doc-nav {
          position: fixed; top: 0; left: 0; right: 0; z-index: 900;
          display: flex; align-items: center; justify-content: space-between;
          padding: 14px clamp(16px,5vw,48px);
          transition: all 0.4s ease;
        }
        .doc-nav.scrolled {
          background: rgba(1,2,8,0.9);
          backdrop-filter: blur(28px) saturate(1.5);
          -webkit-backdrop-filter: blur(28px) saturate(1.5);
          border-bottom: 1px solid rgba(88,218,255,0.07);
          padding-top: 10px; padding-bottom: 10px;
        }
        .doc-brand { display:flex; align-items:center; gap:10px; text-decoration:none; }
        .doc-brand-logo { width:clamp(28px,4vw,33px); height:clamp(28px,4vw,33px); border-radius:9px; background:linear-gradient(135deg,#1a44aa,#aa2288); display:flex; align-items:center; justify-content:center; font-size:clamp(12px,2vw,14px); box-shadow:0 4px 14px rgba(100,50,200,0.38); flex-shrink:0; }
        .doc-brand-name { font-family:'Cormorant Garamond',serif; font-size:clamp(16px,2.5vw,20px); font-style:italic; font-weight:700; color:#fff; }
        .doc-brand-name em { color:#58daff; font-style:normal; }
        .doc-nav-links { display:flex; gap:4px; }
        .doc-nav-a { padding:0 clamp(8px,1.5vw,13px); height:36px; display:flex; align-items:center; font-family:'JetBrains Mono',monospace; font-size:clamp(7px,1.2vw,9.5px); font-weight:700; letter-spacing:0.12em; text-transform:uppercase; color:rgba(200,220,255,0.4); text-decoration:none; border-radius:6px; transition:all 0.2s; white-space:nowrap; }
        .doc-nav-a:hover { color:#58daff; background:rgba(88,218,255,0.07); }
        .doc-nav-a.active { color:#58daff; }
        .doc-ham { background:none; border:none; cursor:pointer; padding:6px; display:none; flex-direction:column; gap:5px; align-items:center; justify-content:center; }
        @media(max-width:860px){ .doc-nav-links{display:none!important;} .doc-ham{display:flex!important;} }

        /* ── Mobile menu ── */
        .doc-mobile-menu { position:fixed; inset:0; z-index:850; background:rgba(1,2,8,0.97); backdrop-filter:blur(30px); display:flex; flex-direction:column; align-items:center; justify-content:center; gap:22px; transition:opacity 0.3s; }
        .doc-mobile-menu.hidden { opacity:0; pointer-events:none; }
        .doc-mobile-link { font-family:'Cormorant Garamond',serif; font-size:clamp(26px,7vw,36px); font-style:italic; font-weight:700; color:#fff; text-decoration:none; transition:color 0.2s; }
        .doc-mobile-link:hover { color:#58daff; }

        /* ── Hero ── */
        .doc-hero {
          position: relative; z-index: 1;
          min-height: clamp(560px,80vh,800px);
          display: flex; flex-direction: column; align-items: center; justify-content: center;
          text-align: center; overflow: hidden;
          padding: clamp(90px,12vw,130px) clamp(16px,5vw,48px) clamp(50px,7vw,80px);
        }
        .doc-eyebrow { display:inline-flex; align-items:center; gap:9px; padding:5px 14px; margin-bottom:clamp(16px,3vw,22px); border:1px solid rgba(88,218,255,0.15); border-radius:100px; background:rgba(1,4,14,0.55); backdrop-filter:blur(14px); font-family:'JetBrains Mono',monospace; font-size:clamp(7px,1.2vw,9px); font-weight:700; letter-spacing:0.2em; text-transform:uppercase; color:rgba(88,218,255,0.7); animation:heroFadeUp 0.6s cubic-bezier(0.16,1,0.3,1) both; }
        .doc-eyebrow-dot { width:6px; height:6px; border-radius:50%; background:#4af5b2; box-shadow:0 0 10px rgba(74,245,178,0.85); flex-shrink:0; animation:liveDot 2s ease-in-out infinite; }
        .doc-title { font-family:'Cormorant Garamond',serif; font-style:italic; font-weight:800; font-size:clamp(42px,9vw,102px); line-height:0.87; letter-spacing:-0.025em; background:linear-gradient(150deg,#e8f0ff 0%,#b2c6ff 25%,#58daff 50%,#4af5b2 75%,#ffc676 100%); background-size:260% auto; -webkit-background-clip:text; -webkit-text-fill-color:transparent; background-clip:text; animation:shimmerTitle 5s linear infinite, heroFadeUp 0.7s cubic-bezier(0.16,1,0.3,1) 0.1s both; margin-bottom:clamp(14px,2.5vw,20px); }
        .doc-subtitle { font-size:clamp(13px,1.8vw,16px); color:rgba(180,210,255,0.55); max-width:550px; line-height:1.75; animation:heroFadeUp 0.7s cubic-bezier(0.16,1,0.3,1) 0.2s both; margin-bottom:clamp(24px,4vw,36px); }
        .doc-hero-links { display:flex; gap:8px; justify-content:center; flex-wrap:wrap; animation:heroFadeUp 0.7s cubic-bezier(0.16,1,0.3,1) 0.3s both; }
        .doc-hero-chip { padding:7px 16px; border-radius:10px; background:rgba(1,4,14,0.6); border:1px solid rgba(88,218,255,0.15); font-family:'JetBrains Mono',monospace; font-size:clamp(8px,1.2vw,10px); font-weight:700; letter-spacing:0.1em; text-transform:uppercase; color:rgba(180,210,255,0.5); text-decoration:none; transition:all 0.22s ease; }
        .doc-hero-chip:hover { color:#58daff; border-color:rgba(88,218,255,0.4); background:rgba(88,218,255,0.06); }

        /* ── Sections ── */
        .doc-section { position:relative; z-index:1; padding:clamp(52px,7vw,80px) clamp(16px,5vw,48px); }
        .doc-section-inner { max-width:780px; margin:0 auto; }
        .doc-section-wide { max-width:1000px; margin:0 auto; }

        /* ── Typography ── */
        .doc-sec-label { font-family:'JetBrains Mono',monospace; font-size:clamp(7px,1.2vw,9px); font-weight:700; letter-spacing:0.22em; text-transform:uppercase; color:rgba(88,218,255,0.5); margin-bottom:clamp(12px,2vw,18px); display:flex; align-items:center; gap:10px; }
        .doc-sec-label::after { content:''; flex:1; height:1px; background:linear-gradient(90deg,rgba(88,218,255,0.25),transparent); max-width:180px; }
        .doc-sec-title { font-family:'Cormorant Garamond',serif; font-style:italic; font-weight:800; font-size:clamp(26px,5vw,52px); line-height:0.95; color:#fff; margin-bottom:clamp(14px,2.5vw,22px); letter-spacing:-0.02em; }
        .doc-body { font-size:clamp(14px,1.7vw,16px); color:rgba(180,210,255,0.62); line-height:1.84; }
        .doc-body + .doc-body { margin-top:18px; }
        .doc-pull { border-left:2px solid; padding:clamp(14px,2.5vw,20px) clamp(16px,3vw,26px); border-radius:0 10px 10px 0; margin:clamp(22px,3.5vw,32px) 0; }
        .doc-pull p { font-family:'Cormorant Garamond',serif; font-style:italic; font-weight:700; font-size:clamp(16px,2.2vw,22px); line-height:1.55; }

        /* ── TOC ── */
        .doc-toc-grid { display:grid; grid-template-columns:1fr 1fr; gap:0 clamp(20px,4vw,48px); }
        .doc-toc-link { display:flex; align-items:center; gap:10px; padding:10px 0; border-bottom:1px solid rgba(88,218,255,0.06); text-decoration:none; color:rgba(180,210,255,0.5); font-size:clamp(12px,1.5vw,14px); transition:all 0.2s; }
        .doc-toc-link:hover { color:#58daff; padding-left:6px; }
        .doc-toc-num { font-family:'JetBrains Mono',monospace; font-size:clamp(8px,1.2vw,9px); color:rgba(88,218,255,0.3); min-width:22px; flex-shrink:0; }
        @media(max-width:600px){ .doc-toc-grid{grid-template-columns:1fr;} }

        /* ── Contract cards ── */
        .doc-contract-card { padding:clamp(20px,3vw,28px); border-radius:18px; background:rgba(1,4,14,0.65); backdrop-filter:blur(20px); position:relative; overflow:hidden; transition:border-color 0.25s; margin-bottom:14px; }
        .doc-cc-header { display:flex; align-items:flex-start; gap:12px; margin-bottom:14px; flex-wrap:wrap; }
        .doc-cc-icon { font-size:clamp(18px,3vw,22px); flex-shrink:0; padding-top:2px; }
        .doc-cc-title { font-family:'Cormorant Garamond',serif; font-style:italic; font-weight:800; font-size:clamp(20px,3.5vw,28px); color:#fff; letter-spacing:-0.02em; line-height:1; margin-bottom:5px; }
        .doc-cc-tag { font-family:'JetBrains Mono',monospace; font-size:clamp(7px,1.1vw,9px); font-weight:700; letter-spacing:0.1em; padding:3px 9px; border-radius:6px; display:inline-block; }
        .doc-cc-subhead { font-family:'Cormorant Garamond',serif; font-style:italic; font-size:clamp(13px,1.6vw,15px); color:rgba(180,210,255,0.45); margin-bottom:12px; }
        .doc-cc-body { font-size:clamp(13px,1.5vw,14.5px); color:rgba(180,210,255,0.62); line-height:1.82; margin-bottom:14px; }
        .doc-cc-detail { padding:clamp(12px,2vw,16px); border-radius:10px; font-size:clamp(12px,1.4vw,13.5px); color:rgba(180,210,255,0.5); line-height:1.72; margin-bottom:16px; }
        .doc-cc-addr { display:inline-flex; align-items:center; gap:7px; padding:5px 12px; border-radius:8px; font-family:'JetBrains Mono',monospace; font-size:clamp(8px,1.2vw,10px); font-weight:500; letter-spacing:0.05em; text-decoration:none; transition:all 0.2s; }

        /* ── Principle cards ── */
        .doc-principle { padding:clamp(18px,2.5vw,24px); border-radius:16px; background:rgba(1,4,14,0.6); backdrop-filter:blur(16px); margin-bottom:12px; display:flex; gap:14px; align-items:flex-start; }
        .doc-p-num { font-family:'Cormorant Garamond',serif; font-style:italic; font-weight:800; font-size:clamp(20px,3vw,28px); line-height:1; flex-shrink:0; padding-top:2px; }
        .doc-p-title { font-family:'Cormorant Garamond',serif; font-style:italic; font-weight:800; font-size:clamp(17px,2.5vw,22px); line-height:1.15; margin-bottom:10px; }
        .doc-p-body { font-size:clamp(13px,1.5vw,14.5px); color:rgba(180,210,255,0.6); line-height:1.82; }

        /* ── Flow steps ── */
        .doc-flow-step { display:flex; gap:16px; align-items:flex-start; padding:clamp(16px,2.5vw,22px); border-radius:14px; background:rgba(1,4,14,0.6); backdrop-filter:blur(14px); margin-bottom:12px; transition:border-color 0.2s; }
        .doc-flow-num { min-width:32px; height:32px; border-radius:8px; display:flex; align-items:center; justify-content:center; font-family:'JetBrains Mono',monospace; font-size:10px; font-weight:700; flex-shrink:0; margin-top:2px; }
        .doc-flow-title { font-family:'Cormorant Garamond',serif; font-style:italic; font-weight:800; font-size:clamp(18px,2.8vw,24px); line-height:1.1; color:#fff; margin-bottom:7px; }
        .doc-flow-body { font-size:clamp(13px,1.5vw,14px); color:rgba(180,210,255,0.58); line-height:1.78; }

        /* ── Security table ── */
        .doc-sec-table { width:100%; border-collapse:collapse; margin-top:20px; }
        .doc-sec-table th { font-family:'JetBrains Mono',monospace; font-size:clamp(7px,1.2vw,9px); font-weight:700; letter-spacing:0.15em; text-transform:uppercase; color:rgba(88,218,255,0.45); padding:10px 14px; border-bottom:1px solid rgba(88,218,255,0.1); text-align:left; }
        .doc-sec-table td { font-size:clamp(12px,1.4vw,13.5px); color:rgba(180,210,255,0.6); padding:10px 14px; border-bottom:1px solid rgba(88,218,255,0.05); line-height:1.65; vertical-align:top; }
        .doc-sec-table tr:last-child td { border-bottom:none; }
        .doc-level-badge { display:inline-flex; align-items:center; gap:5px; padding:2px 9px; border-radius:5px; font-family:'JetBrains Mono',monospace; font-size:clamp(7px,1vw,9px); font-weight:700; letter-spacing:0.08em; }

        /* ── Deployed addresses ── */
        .doc-addr-row { display:flex; align-items:center; gap:10px; padding:10px 14px; border-radius:10px; background:rgba(1,4,14,0.5); border:1px solid rgba(88,218,255,0.06); margin-bottom:8px; flex-wrap:wrap; transition:border-color 0.2s; }
        .doc-addr-row:hover { border-color:rgba(88,218,255,0.15); }
        .doc-addr-dot { width:7px; height:7px; border-radius:50%; flex-shrink:0; }
        .doc-addr-name { font-family:'Space Grotesk',sans-serif; font-size:clamp(12px,1.6vw,14px); font-weight:600; color:#fff; flex:1; min-width:100px; }
        .doc-addr-hash { font-family:'JetBrains Mono',monospace; font-size:clamp(9px,1.3vw,11px); color:rgba(180,210,255,0.4); letter-spacing:0.04em; word-break:break-all; }
        .doc-addr-link { font-family:'JetBrains Mono',monospace; font-size:clamp(8px,1vw,9px); font-weight:700; letter-spacing:0.1em; text-transform:uppercase; color:rgba(88,218,255,0.55); text-decoration:none; padding:4px 10px; border:1px solid rgba(88,218,255,0.18); border-radius:6px; flex-shrink:0; transition:all 0.2s; white-space:nowrap; }
        .doc-addr-link:hover { color:#58daff; border-color:rgba(88,218,255,0.4); }

        /* ── Divider ── */
        .doc-divider { width:100%; height:1px; background:linear-gradient(90deg,transparent,rgba(88,218,255,0.08),transparent); position:relative; z-index:1; }

        /* ── CTA ── */
        .doc-cta { position:relative; z-index:1; padding:clamp(60px,8vw,90px) clamp(16px,5vw,48px); text-align:center; background:linear-gradient(160deg,rgba(8,18,45,0.6),rgba(25,5,55,0.45),rgba(5,25,20,0.4)); border-top:1px solid rgba(88,218,255,0.07); }
        .doc-cta-title { font-family:'Cormorant Garamond',serif; font-style:italic; font-weight:800; font-size:clamp(28px,6vw,62px); color:#fff; line-height:0.95; margin-bottom:16px; letter-spacing:-0.02em; }
        .doc-cta-body { font-size:clamp(13px,1.6vw,15px); color:rgba(180,210,255,0.5); margin-bottom:28px; max-width:480px; margin-left:auto; margin-right:auto; line-height:1.72; }
        .doc-cta-btns { display:flex; gap:10px; justify-content:center; flex-wrap:wrap; }
        .doc-btn { display:inline-flex; align-items:center; gap:8px; padding:clamp(10px,2vw,13px) clamp(16px,3vw,22px); border-radius:10px; font-family:'JetBrains Mono',monospace; font-size:clamp(8px,1.3vw,10px); font-weight:700; letter-spacing:0.14em; text-transform:uppercase; text-decoration:none; border:1px solid; transition:all 0.22s ease; white-space:nowrap; }
        .doc-btn-primary { background:rgba(220,235,255,0.9); color:#010208; border-color:rgba(220,235,255,0.9); }
        .doc-btn-primary:hover { background:#fff; transform:translateY(-2px); box-shadow:0 8px 26px rgba(255,255,255,0.18); }
        .doc-btn-ghost { background:rgba(1,4,14,0.5); border-color:rgba(88,218,255,0.2); color:rgba(88,218,255,0.7); }
        .doc-btn-ghost:hover { border-color:rgba(88,218,255,0.5); color:#58daff; background:rgba(88,218,255,0.06); }

        /* ── Footer ── */
        .doc-footer { position:relative; z-index:1; display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:12px; padding:clamp(14px,2.5vw,20px) clamp(16px,5vw,48px); border-top:1px solid rgba(88,218,255,0.06); background:rgba(1,2,8,0.7); backdrop-filter:blur(20px); }
        .doc-footer-brand { font-family:'Cormorant Garamond',serif; font-size:clamp(13px,2vw,16px); font-style:italic; color:rgba(180,210,255,0.3); }
        .doc-footer-links { display:flex; flex-wrap:wrap; gap:clamp(10px,2vw,18px); }
        .doc-footer-link { font-family:'JetBrains Mono',monospace; font-size:clamp(7px,1.2vw,9px); font-weight:700; letter-spacing:0.12em; text-transform:uppercase; color:rgba(180,210,255,0.28); text-decoration:none; transition:color 0.2s; }
        .doc-footer-link:hover { color:rgba(88,218,255,0.7); }

        /* ── Scroll hint ── */
        @media(max-height:560px),(max-width:400px){ .scroll-hint{display:none!important;} }

        /* ── Responsive layout ── */
        @media(max-width:640px){
          .doc-toc-grid{grid-template-columns:1fr;}
          .doc-cc-header{flex-direction:column;}
          .doc-principle{flex-direction:column;gap:8px;}
          .doc-flow-step{flex-direction:column;gap:10px;}
          .doc-addr-row{flex-direction:column;align-items:flex-start;}
          .doc-cta-btns{flex-direction:column;align-items:center;}
          .doc-btn{width:100%;justify-content:center;}
        }
      `}</style>

      <RibbonBackground />

      {/* Mobile menu */}
      <div className={`doc-mobile-menu${menuOpen ? '' : ' hidden'}`} onClick={() => setMenuOpen(false)}>
        {[
          {label:'App', href:'/'},
          {label:'Coverage', href:'/buy-policy'},
          {label:'Claims', href:'/claims'},
          {label:'Governance', href:'/governance'},
          {label:'GitHub', href:'https://github.com/NexTechArchitect/Sentinel-Insurance-Protocol'},
        ].map((item, i) => (
          <a key={item.label} href={item.href} className="doc-mobile-link"
            style={{ opacity:menuOpen?1:0, transform:menuOpen?'none':'translateY(14px)', transition:`all 0.44s cubic-bezier(0.16,1,0.3,1) ${i*50}ms` }}>
            {item.label}
          </a>
        ))}
      </div>

      {/* Nav */}
      <nav className={`doc-nav${scrolled ? ' scrolled' : ''}`}>
        <Link href="/" className="doc-brand">
          <div className="doc-brand-logo">◆</div>
          <div className="doc-brand-name">Sentinel<em>Shield</em></div>
        </Link>
        <div className="doc-nav-links">
          {[
            {label:'← Back to App', href:'/'},
            {label:'Coverage', href:'/buy-policy'},
            {label:'Claims', href:'/claims'},
            {label:'Governance', href:'/governance'},
          ].map(item => (
            <a key={item.label} href={item.href} className="doc-nav-a">{item.label}</a>
          ))}
          <a href="https://github.com/NexTechArchitect/Sentinel-Insurance-Protocol" target="_blank" rel="noopener noreferrer" className="doc-nav-a">GitHub ↗</a>
        </div>
        <button className="doc-ham" onClick={() => setMenuOpen(!menuOpen)} aria-label="Toggle menu">
          {[0,1,2].map(i => (
            <div key={i} style={{ width:22, height:1.5, background:'#e8f0ff', borderRadius:1, transition:'all 0.3s',
              transform: menuOpen?(i===0?'rotate(45deg) translate(4.5px,4.5px)':i===1?'scaleX(0)':'rotate(-45deg) translate(4.5px,-4.5px)'):'none',
              opacity: menuOpen&&i===1?0:1 }} />
          ))}
        </button>
      </nav>

      {/* ══════ Hero ══════ */}
      <section className="doc-hero">
        <div className="doc-eyebrow">
          <span className="doc-eyebrow-dot" />
          Protocol Documentation · Ethereum Sepolia
        </div>
        <h1 className="doc-title">
          What is<br />SentinelShield?
        </h1>
        <p className="doc-subtitle">
          A decentralized insurance protocol for DeFi. Smart contract coverage backed by Aave V3 yield,
          adjudicated by on-chain DAO governance, and settled automatically by a keeper-pattern executor.
          No servers. No databases. No intermediaries.
        </p>
        <div className="doc-hero-links">
          {[
            {label:'Overview',     href:'#problem'},
            {label:'Architecture', href:'#arch'},
            {label:'Contracts',    href:'#contracts'},
            {label:'Flow',         href:'#flow'},
            {label:'Security',     href:'#security'},
            {label:'Addresses',    href:'#deployed'},
          ].map(link => (
            <a key={link.label} href={link.href} className="doc-hero-chip">{link.label}</a>
          ))}
        </div>

        {/* Scroll hint */}
        <div className="scroll-hint" style={{ position:'absolute', bottom:22, zIndex:2, display:'flex', flexDirection:'column', alignItems:'center', gap:7, animation:'scrollHint 2.2s ease-in-out infinite' }}>
          <div style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:8, color:'rgba(88,218,255,0.28)', letterSpacing:'0.22em' }}></div>
          <div style={{ width:1, height:22, background:'linear-gradient(to bottom,rgba(88,218,255,0.4),transparent)' }} />
        </div>
      </section>

      {/* ══════ Table of Contents ══════ */}
      <section className="doc-section">
        <div className="doc-section-wide">
          <div id="toc-block" data-reveal style={rv('toc-block')}>
            <div style={{ padding:'clamp(20px,3vw,32px)', border:'1px solid rgba(88,218,255,0.1)', borderRadius:16, background:'rgba(1,4,14,0.65)', backdropFilter:'blur(20px)' }}>
              <div style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:'clamp(7px,1.2vw,9px)', fontWeight:700, letterSpacing:'0.22em', textTransform:'uppercase', color:'rgba(88,218,255,0.4)', marginBottom:18 }}>Contents</div>
              <div className="doc-toc-grid">
                {TOC.map(([num, label, href]) => (
                  <a key={num} href={href} className="doc-toc-link">
                    <span className="doc-toc-num">{num}</span>
                    <span>{label}</span>
                  </a>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      <div className="doc-divider" />

      {/* ══════ The Problem ══════ */}
      <section className="doc-section" id="problem">
        <div className="doc-section-inner">
          <div id="prob-hdr" data-reveal style={rv('prob-hdr')}>
       
            <h2 className="doc-sec-title">DeFi has no safety net.</h2>
          </div>
          <div id="prob-body" data-reveal style={rv('prob-body', 80)}>
            <p className="doc-body">
              Smart contracts hold billions of dollars in user assets, and smart contracts get exploited. Reentrancy attacks, oracle manipulation, flash-loan price attacks, governance takeovers — the attack surface grows with every new protocol composing on top of another. When an exploit lands, users lose funds with no recourse. There is no FDIC for DeFi. There is no chargeback.
            </p>
            <p className="doc-body" style={{ marginTop:18 }}>
              Existing DeFi insurance solutions suffer from three recurring problems: idle capital that earns nothing, centralised claim adjudication that can be captured, and opaque premium models that users cannot verify. SentinelShield was built to solve all three simultaneously.
            </p>
            <div className="doc-pull" style={{ borderColor:'rgba(88,218,255,0.2)', background:'rgba(88,218,255,0.04)', marginTop:28 }}>
              <p style={{ color:'rgba(150,200,255,0.85)' }}>
                "Every dollar of collateral earns Aave V3 yield while it waits. Every claim is adjudicated by token-weighted governance that cannot be flash-loan-attacked. Every premium calculation is a pure function that anyone can verify."
              </p>
            </div>
            <p className="doc-body" style={{ marginTop:22 }}>
              The result is a composable insurance layer that any DeFi protocol, DAO, or individual position can plug into — protocol-native coverage with zero trusted intermediaries, zero idle capital, and fully on-chain settlement from first claim filing to final USDC payout.
            </p>
          </div>
        </div>
      </section>

      <div className="doc-divider" />

      {/* ══════ How It Works ══════ */}
      <section className="doc-section" id="how" style={{ background:'rgba(88,218,255,0.015)' }}>
        <div className="doc-section-inner">
          <div id="how-hdr" data-reveal style={rv('how-hdr')}>
          
            <h2 className="doc-sec-title">Three roles. One protocol.</h2>
          </div>
          <div id="how-body" data-reveal style={rv('how-body', 80)}>
            <p className="doc-body">SentinelShield has three participant types, each interacting with a different layer of the protocol stack:</p>
            <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(min(100%,220px),1fr))', gap:12, marginTop:24 }}>
              {[
                { role:'Policyholders', color:'#58daff', desc:'DeFi users or protocols that purchase coverage against smart contract exploits. They pay a one-time premium, receive a soulbound PolicyNFT, and can file a claim if the covered protocol is exploited while their policy is active.' },
                { role:'Liquidity Providers', color:'#4af5b2', desc:'Capital providers who deposit USDC into the CoveragePool. Their capital earns Aave V3 base yield plus a share of protocol premiums. In exchange, their capital backs active policies and may be partially drawn down if a claim pays out.' },
                { role:'SHIELD Holders', color:'#c484ff', desc:'Governance participants who hold $SHIELD tokens and vote on claim outcomes. They examine evidence submitted by claimants and vote yes or no within the 7-day window. Their historical balance at the snapshot block determines their voting weight.' },
              ].map(item => (
                <div key={item.role} style={{ padding:'clamp(16px,2.5vw,22px)', border:`1px solid ${item.color}20`, borderRadius:14, background:'rgba(1,4,14,0.65)', backdropFilter:'blur(16px)' }}>
                  <div style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:'clamp(7px,1.2vw,9px)', fontWeight:700, letterSpacing:'0.16em', textTransform:'uppercase', color:item.color, marginBottom:10 }}>{item.role}</div>
                  <p style={{ fontSize:'clamp(13px,1.5vw,14px)', color:'rgba(180,210,255,0.6)', lineHeight:1.75 }}>{item.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <div className="doc-divider" />

      {/* ══════ Architecture ══════ */}
      <section className="doc-section" id="arch">
        <div className="doc-section-inner">
          <div id="arch-hdr" data-reveal style={rv('arch-hdr')}>
        
            <h2 className="doc-sec-title">Three isolated layers.</h2>
          </div>
          <div id="arch-body" data-reveal style={rv('arch-body', 80)}>
            <p className="doc-body">
              The protocol is split across three execution layers that share no state variables with each other. A critical bug in the governance layer cannot drain the capital vault. A misconfigured PolicyEngine cannot override a veto. The separation is structural, not conventional.
            </p>
            {/* Architecture diagram */}
            <div style={{ marginTop:28, padding:'clamp(18px,3vw,26px)', borderRadius:16, background:'rgba(1,4,14,0.7)', border:'1px solid rgba(88,218,255,0.08)', fontFamily:"'JetBrains Mono',monospace", overflowX:'auto' }}>
              <div style={{ fontSize:'clamp(7px,1.2vw,9px)', fontWeight:700, letterSpacing:'0.2em', textTransform:'uppercase', color:'rgba(88,218,255,0.35)', marginBottom:18 }}>System Layers — Top to Bottom</div>
              {[
                { label:'USER / DAPP', sub:'wagmi v2 · viem · RainbowKit · any EOA', c:'#c484ff', arrow:true },
                { label:'POLICY ROUTING', sub:'PolicyEngine · RiskRegistry · PolicyNFT (ERC-5484)', c:'#ffc676', arrow:true },
                { label:'CAPITAL UNDERWRITING', sub:'CoveragePool (ERC-4626) · Aave V3 Pool · aUSDC', c:'#58daff', arrow:true },
                { label:'ADJUDICATION', sub:'ClaimsGovernor · ShieldToken (ERC-20Votes) · VetoCouncil', c:'#ff687c', arrow:true },
                { label:'SETTLEMENT', sub:'PayoutExecutor (Keeper-callable)', c:'#4af5b2', arrow:false },
              ].map((layer) => (
                <div key={layer.label}>
                  <div style={{ display:'flex', alignItems:'flex-start', gap:10, padding:'clamp(10px,1.8vw,14px) clamp(12px,2vw,18px)', borderRadius:10, background:`${layer.c}08`, border:`1px solid ${layer.c}18`, flexWrap:'wrap' }}>
                    <span style={{ color:layer.c, fontWeight:700, fontSize:'clamp(8px,1.3vw,10px)', letterSpacing:'0.08em', minWidth:clamp(120,160), flexShrink:0 }}>{layer.label}</span>
                    <span style={{ color:'rgba(180,210,255,0.4)', fontSize:'clamp(8px,1.2vw,10px)' }}>{layer.sub}</span>
                  </div>
                  {layer.arrow && <div style={{ textAlign:'center', color:'rgba(88,218,255,0.2)', fontSize:14, margin:'2px 0' }}>↓</div>}
                </div>
              ))}
            </div>
            <p className="doc-body" style={{ marginTop:22 }}>
              The key invariant: CoveragePool only accepts liquidity operations from PolicyEngine, and payout operations from PayoutExecutor. Neither ClaimsGovernor nor VetoCouncil can touch the underlying USDC directly — they can only update claim state. Actual fund movements require passing through CoveragePool's authorised caller checks.
            </p>
          </div>
        </div>
      </section>

      <div className="doc-divider" />

      {/* ══════ The Eight Contracts ══════ */}
      <section className="doc-section" id="contracts" style={{ background:'rgba(88,218,255,0.012)' }}>
        <div className="doc-section-wide">
          <div id="con-hdr" data-reveal style={{ marginBottom:clamp(28,40), ...rv('con-hdr') }}>
  
            <h2 className="doc-sec-title">Every contract. What it does. Why it exists.</h2>
            <p className="doc-body" style={{ maxWidth:560 }}>No contract in this system is ceremonial. Each one solves a specific problem that could not be solved by any other contract in the stack.</p>
          </div>
          <div>
            {CONTRACTS.map((c, i) => (
              <div key={c.name} id={`cc${i}`} data-reveal className="doc-contract-card"
                style={{ border:`1px solid ${c.color}18`, ...rv(`cc${i}`, i * 60) }}>
                <div style={{ position:'absolute', top:-20, right:-8, fontFamily:"'Cormorant Garamond',serif", fontStyle:'italic', fontSize:clamp(80,110), fontWeight:900, color:`${c.color}05`, lineHeight:1, userSelect:'none', pointerEvents:'none' }}>{c.num}</div>
                <div className="doc-cc-header">
                  <span className="doc-cc-icon">{c.icon}</span>
                  <div>
                    <div style={{ display:'flex', alignItems:'center', gap:10, flexWrap:'wrap', marginBottom:6 }}>
                      <h3 className="doc-cc-title">{c.name}</h3>
                      <span className="doc-cc-tag" style={{ color:c.color, background:`${c.color}12`, border:`1px solid ${c.color}25` }}>{c.tag}</span>
                    </div>
                    <div className="doc-cc-subhead">{c.heading}</div>
                  </div>
                </div>
                <p className="doc-cc-body">{c.body}</p>
                <div className="doc-cc-detail" style={{ background:`${c.color}06`, border:`1px solid ${c.color}12` }}>{c.detail}</div>
                <a href={c.etherscan} target="_blank" rel="noopener noreferrer" className="doc-cc-addr"
                  style={{ background:`${c.color}0c`, border:`1px solid ${c.color}25`, color:c.color }}
                  onMouseEnter={e=>(e.currentTarget as HTMLElement).style.background=`${c.color}1e`}
                  onMouseLeave={e=>(e.currentTarget as HTMLElement).style.background=`${c.color}0c`}>
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
                  Etherscan · {c.short}
                </a>
              </div>
            ))}
          </div>
        </div>
      </section>

      <div className="doc-divider" />

      {/* ══════ PremiumMath ══════ */}
      <section className="doc-section" id="math">
        <div className="doc-section-inner">
          <div id="math-hdr" data-reveal style={rv('math-hdr')}>

            <h2 className="doc-sec-title">Transparent. Verifiable. Pure.</h2>
          </div>
          <div id="math-body" data-reveal style={rv('math-body', 80)}>
            <p className="doc-body">
              PremiumMath is a stateless Solidity library — zero storage reads, zero external calls, zero reentrancy surface. It is a pure function that takes four inputs and returns one output: the exact premium in USDC. Because it is a pure library function, anyone can call it off-chain in advance and get the identical result that the contract will produce at purchase time.
            </p>
            <div style={{ margin:'24px 0', padding:'clamp(18px,3vw,24px)', borderRadius:14, background:'rgba(1,4,14,0.7)', border:'1px solid rgba(196,132,255,0.15)', fontFamily:"'JetBrains Mono',monospace", fontSize:'clamp(11px,1.5vw,13px)', color:'rgba(180,210,255,0.7)', lineHeight:2.0, overflowX:'auto' }}>
              <div style={{ color:'rgba(88,218,255,0.4)', fontSize:'clamp(7px,1.2vw,9px)', letterSpacing:'0.2em', marginBottom:12 }}>BASE FORMULA</div>
              <div>premium = (coverageAmount × BASE_RATE_BPS × riskScore × duration)</div>
              <div style={{ color:'rgba(180,210,255,0.35)', paddingLeft:12 }}>/ (100 × 10,000 × 365 days)</div>
              <div style={{ color:'rgba(196,132,255,0.7)', marginTop:8 }}>if audited: premium × (1 − 0.20)</div>
              <div style={{ color:'rgba(74,245,178,0.7)' }}>min(premium, 1 USDC)</div>
            </div>
            <p className="doc-body">
              BASE_RATE_BPS is 1,000 basis points (10% APR) at maximum risk score of 100. A protocol scored 50 pays half that annualised rate. Duration scales linearly — a 30-day policy costs roughly 1/12 of a 365-day policy at the same coverage level. The 20% audit discount rewards protocols that have demonstrated security diligence. All arithmetic is multiply-before-divide to avoid Solidity integer truncation errors.
            </p>
            <p className="doc-body" style={{ marginTop:18 }}>
              The refund function is equally simple: pro-rated by remaining time. If you cancel a 365-day policy after 180 days, you receive (185/365) × premium back. The refund goes into a pending-pull balance rather than being pushed immediately — this eliminates DoS vectors where a malicious policy contract could block the refund transfer.
            </p>
          </div>
        </div>
      </section>

      <div className="doc-divider" />

      {/* ══════ ClaimValidator ══════ */}
      <section className="doc-section" id="validator" style={{ background:'rgba(88,218,255,0.012)' }}>
        <div className="doc-section-inner">
          <div id="val-hdr" data-reveal style={rv('val-hdr')}>
           
            <h2 className="doc-sec-title">The rules of valid claims.</h2>
          </div>
          <div id="val-body" data-reveal style={rv('val-body', 80)}>
            <p className="doc-body">
              ClaimValidator is a pure library that encodes all governance validation rules in one place. ClaimsGovernor calls into it for every claim and vote operation. This separation means the validation rules can be read, audited, and verified independently of the governor's state management logic.
            </p>
            <div style={{ marginTop:24, display:'flex', flexDirection:'column', gap:10 }}>
              {[
                { rule:'validateClaimEligibility()', desc:'Checks that the policy status is ACTIVE (status == 0), that the current timestamp has not passed expiresAt, and that the caller is the policy holder. Three separate reverts for three separate failure modes — frontends can show the user exactly why their claim was rejected.' },
                { rule:'validateEvidence()', desc:'Enforces a minimum URI length of 10 characters. Rejects empty strings and suspiciously short inputs that would not constitute real IPFS or Arweave URIs. Two distinct errors distinguish empty from too-short for cleaner frontend error handling.' },
                { rule:'isClaimApproved()', desc:'Computes the 1% quorum threshold: (totalSupply × 100) / 10,000. If total votes (yes + no) do not meet this threshold, the claim fails regardless of vote distribution. If quorum is met, yes votes must strictly exceed no votes. Both conditions must hold simultaneously.' },
                { rule:'computeVoteWeight()', desc:'Currently a pass-through that returns the raw SHIELD balance from the snapshot. Architecturally isolated here so that future voting mechanisms — quadratic weighting, delegation multipliers, veToken curves — can be implemented by upgrading this single function without modifying ClaimsGovernor.' },
              ].map(item => (
                <div key={item.rule} style={{ padding:'clamp(14px,2.5vw,18px)', borderRadius:12, background:'rgba(1,4,14,0.65)', border:'1px solid rgba(196,132,255,0.1)', backdropFilter:'blur(14px)' }}>
                  <div style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:'clamp(10px,1.5vw,12px)', fontWeight:600, color:'#c484ff', marginBottom:8 }}>{item.rule}</div>
                  <p style={{ fontSize:'clamp(12px,1.5vw,14px)', color:'rgba(180,210,255,0.58)', lineHeight:1.78 }}>{item.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <div className="doc-divider" />

      {/* ══════ PolicyNFTSVG ══════ */}
      <section className="doc-section" id="svg">
        <div className="doc-section-inner">
          <div id="svg-hdr" data-reveal style={rv('svg-hdr')}>
            <h2 className="doc-sec-title">Art that lives on the blockchain.</h2>
          </div>
          <div id="svg-body" data-reveal style={rv('svg-body', 80)}>
            <p className="doc-body">
              PolicyNFTSVG is a pure Solidity library that generates the complete SVG artwork for every PolicyNFT — character by character, inside the EVM. There is no IPFS. No external server. No Arweave gateway that can go offline. The SVG is constructed from string concatenation in Solidity, base64-encoded by OpenZeppelin's Base64 library, and returned as a data URI directly from tokenURI(). The token's art exists as long as Ethereum exists.
            </p>
            <p className="doc-body" style={{ marginTop:18 }}>
              The SVG reflects the policy's current state in real time. Every tokenURI() call reads the policy's current status from PolicyNFT's storage and renders the appropriate badge color: green for ACTIVE, grey for EXPIRED, blue for CLAIMED, red for CANCELLED. As a policy transitions states — expiring, being claimed, being cancelled — the rendered artwork changes automatically on every metadata query. No re-minting. No gas cost. No owner action required.
            </p>
            <p className="doc-body" style={{ marginTop:18 }}>
              The library uses block scoping (curly braces) throughout its internal functions to avoid Solidity's stack-too-deep compiler error, which surfaces when a function references more than 16 local variables. This is a production-grade pattern for complex on-chain SVG generation and demonstrates the same approach used by on-chain generative art projects like Loot.
            </p>
            <div className="doc-pull" style={{ borderColor:'rgba(255,236,132,0.25)', background:'rgba(255,236,132,0.03)', marginTop:24 }}>
              <p style={{ color:'rgba(255,236,132,0.8)' }}>
                "A PolicyNFT is not a static image. It is a live window into the current state of your on-chain insurance position, rendered by the blockchain itself."
              </p>
            </div>
          </div>
        </div>
      </section>

      <div className="doc-divider" />

      {/* ══════ Protocol Flow ══════ */}
      <section className="doc-section" id="flow" style={{ background:'rgba(88,218,255,0.012)' }}>
        <div className="doc-section-wide">
          <div id="flow-hdr" data-reveal style={{ marginBottom:clamp(28,40), ...rv('flow-hdr') }}>
      
            <h2 className="doc-sec-title">From purchase to payout. Every step.</h2>
          </div>
          <div>
            {FLOW_STEPS.map((step, i) => (
              <div key={step.num} id={`fs${i}`} data-reveal className="doc-flow-step"
                style={{ border:`1px solid ${step.color}15`, ...rv(`fs${i}`, i * 70) }}>
                <div className="doc-flow-num" style={{ color:step.color, borderColor:`${step.color}28`, background:`${step.color}08` }}>{step.num}</div>
                <div>
                  <div className="doc-flow-title">{step.title}</div>
                  <div className="doc-flow-body">{step.body}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <div className="doc-divider" />

      {/* ══════ Design Philosophy ══════ */}
      <section className="doc-section" id="philosophy">
        <div className="doc-section-wide">
          <div id="phi-hdr" data-reveal style={{ marginBottom:clamp(28,40), ...rv('phi-hdr') }}>
         
            <h2 className="doc-sec-title">Why it was built this way.</h2>
          </div>
          {PRINCIPLES.map((p, i) => (
            <div key={p.num} id={`pp${i}`} data-reveal className="doc-principle"
              style={{ border:`1px solid ${p.color}15`, ...rv(`pp${i}`, i * 65) }}>
              <div className="doc-p-num" style={{ color:`${p.color}50` }}>{p.num}</div>
              <div>
                <div className="doc-p-title" style={{ color:p.color }}>{p.title}</div>
                <p className="doc-p-body">{p.body}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      <div className="doc-divider" />

      {/* ══════ Security Model ══════ */}
      <section className="doc-section" id="security" style={{ background:'rgba(88,218,255,0.012)' }}>
        <div className="doc-section-inner">
          <div id="sec-hdr" data-reveal style={rv('sec-hdr')}>
            <h2 className="doc-sec-title">Designed to be attacked. Built to hold.</h2>
          </div>
          <div id="sec-body" data-reveal style={rv('sec-body', 80)}>
            <p className="doc-body">
              The protocol was statically analysed with Slither v0.10.x against the full Foundry artifact matrix. Zero high-severity findings. Two medium findings were reviewed as false positives — the payable modifier on buyPolicy() is an intentional EVM gas optimisation, not an ETH acceptance bug.
            </p>

            <div style={{ overflowX:'auto', marginTop:28, marginBottom:28 }}>
              <table className="doc-sec-table">
                <thead>
                  <tr>
                    <th>Level</th>
                    <th>Count</th>
                    <th>Status</th>
                    <th>Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    { level:'Critical', count:'0', color:'#4af5b2', status:'Absolute zero',     note:'No exploit windows detected in any execution path.' },
                    { level:'High',     count:'0', color:'#58daff', status:'Clear',             note:'No structural data-leakage or state corruption vectors.' },
                    { level:'Medium',   count:'2', color:'#ffae48', status:'False positives',   note:'payable optimisation on buyPolicy(). Reviewed and documented.' },
                    { level:'Low',      count:'11', color:'rgba(180,210,255,0.4)', status:'Standard patterns', note:'SafeERC20 wrappers manage low-level transfer safety uniformly.' },
                    { level:'Info',     count:'16', color:'rgba(180,210,255,0.25)', status:'NatSpec',          note:'All documented with structured inline signatures.' },
                  ].map(row => (
                    <tr key={row.level}>
                      <td><span className="doc-level-badge" style={{ color:row.color, background:`${row.color}12`, border:`1px solid ${row.color}25` }}>{row.level}</span></td>
                      <td><span style={{ fontFamily:"'Cormorant Garamond',serif", fontStyle:'italic', fontWeight:700, fontSize:'clamp(20px,3vw,26px)', color:row.color }}>{row.count}</span></td>
                      <td><span style={{ color:row.color }}>{row.status}</span></td>
                      <td>{row.note}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div style={{ marginBottom:20 }}>
              <div style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:'clamp(8px,1.2vw,10px)', fontWeight:700, letterSpacing:'0.16em', textTransform:'uppercase', color:'rgba(88,218,255,0.5)', marginBottom:14 }}>Security Invariants</div>
              <div style={{ display:'flex', flexDirection:'column', gap:9 }}>
                {[
                  { inv:'CEI everywhere', how:'Checks-Effects-Interactions enforced without exception across all 8 contracts. All storage mutations precede external calls.' },
                  { inv:'Reentrancy guards belt-and-suspenders', how:'All state-changing functions carry nonReentrant modifiers as a redundant mechanical layer on top of CEI.' },
                  { inv:'Write-once addresses', how:'Every cross-contract routing address is immutable after first configuration. No owner key compromise can silently reroute funds.' },
                  { inv:'Flash-loan resistant voting', how:'Historical checkpoint queries (getPastVotes at block.number - 1) guarantee borrowed tokens carry zero weight.' },
                  { inv:'Soulbound transfer lock', how:'_update() override in PolicyNFT reverts any non-zero to non-zero token movement unconditionally.' },
                  { inv:'Free/locked liquidity accounting', how:'totalLiquidity = freeLiquidity + totalLockedLiquidity enforced at every deposit, withdrawal, lockCoverage, releaseCoverage, and executePayout call.' },
                  { inv:'Integer arithmetic precision', how:'PremiumMath uses multiply-before-divide throughout. No precision loss from early division.' },
                  { inv:'Payout uniqueness', how:'PayoutExecutor marks claim EXECUTED before calling CoveragePool. Any reentry attempt finds EXECUTED status and reverts.' },
                ].map((item, i) => (
                  <div key={i} style={{ display:'flex', alignItems:'flex-start', gap:12, padding:'clamp(10px,2vw,14px)', borderRadius:11, background:'rgba(1,4,14,0.65)', border:'1px solid rgba(88,218,255,0.07)', backdropFilter:'blur(12px)' }}>
                    <div style={{ width:6, height:6, borderRadius:'50%', background:'#4af5b2', flexShrink:0, marginTop:5, boxShadow:'0 0 6px rgba(74,245,178,0.6)' }} />
                    <div>
                      <div style={{ fontFamily:"'Space Grotesk',sans-serif", fontWeight:600, fontSize:'clamp(12px,1.5vw,14px)', color:'#e8f0ff', marginBottom:4 }}>{item.inv}</div>
                      <div style={{ fontSize:'clamp(11px,1.4vw,13px)', color:'rgba(180,210,255,0.5)', lineHeight:1.65 }}>{item.how}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div style={{ padding:'clamp(14px,2.5vw,18px)', borderRadius:12, background:'rgba(255,60,30,0.04)', border:'1px dashed rgba(255,80,50,0.22)' }}>
              <div style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:'clamp(7px,1.2vw,9px)', fontWeight:700, letterSpacing:'0.15em', textTransform:'uppercase', color:'rgba(255,100,70,0.6)', marginBottom:8 }}>⚠ Audit Disclaimer</div>
              <p style={{ fontSize:'clamp(12px,1.4vw,14px)', color:'rgba(180,210,255,0.45)', lineHeight:1.72 }}>
                These contracts implement production-grade security patterns and were self-audited by the author using Slither and manual review. They have not undergone a formal external security audit by a professional firm. Do not deploy to mainnet with material funds without engaging a qualified smart contract auditing firm. This is a testnet deployment on Ethereum Sepolia.
              </p>
            </div>
          </div>
        </div>
      </section>

      <div className="doc-divider" />

     
      <section className="doc-section" id="deployed">
        <div className="doc-section-wide">
          <div id="dep-hdr" data-reveal style={{ marginBottom:clamp(24,36), ...rv('dep-hdr') }}>
         
            <h2 className="doc-sec-title">Live on Ethereum Sepolia.</h2>
            <p className="doc-body" style={{ maxWidth:520, marginTop:12 }}>All contracts are verified and publicly readable on Etherscan. Interact with proxy addresses where applicable.</p>
          </div>
          <div>
            {[
              { name:'PolicyEngine',   addr:'0xa373BD4d832E34C960A7bF6BBf6190c939932b40', color:'#ffc676', role:'Core' },
              { name:'CoveragePool',   addr:'0x2bC42ae97A20b4f06F35C42e2Fb82A0550fAAf18', color:'#58daff', role:'Core' },
              { name:'RiskRegistry',   addr:'0xE94a55ac7678013ff68B8c26A3337A0DCe7a5210', color:'#c484ff', role:'Core' },
              { name:'ClaimsGovernor', addr:'0xDc89D29Dc89178bE772EAf6E3587eB863Df6Ae8a', color:'#ff687c', role:'Governance' },
              { name:'ShieldToken ($SHIELD)', addr:'0x3D202f0Af4614DA97eDeC5326c585b9C6E29d4AF', color:'#4af5b2', role:'Governance' },
              { name:'VetoCouncil',    addr:'0x00493Da33899ea9FB9Fe5401dDa9EcE7F92319Ab', color:'#ffae48', role:'Governance' },
              { name:'PolicyNFT',      addr:'0xbB6314f9775209e0999280BFE7e7A316ADc5b75C', color:'#b2c6ff', role:'Token' },
              { name:'PayoutExecutor', addr:'0x004FF5Ce04AcC4106100C283edf2A69Fb879BdCb', color:'#ffec84', role:'Execution' },
              { name:'Circle USDC (Collateral)', addr:'0x94a9D9AC8a22534E3FaCa9F4e7F2E2cf85d5E4C8', color:'rgba(180,210,255,0.5)', role:'External' },
              { name:'Aave V3 Pool (Sepolia)',   addr:'0x6Ae43d3271ff6888e7Fc43Fd7321a503ff738951', color:'rgba(180,210,255,0.35)', role:'External' },
            ].map((item, i) => (
              <div key={item.name} id={`da${i}`} data-reveal className="doc-addr-row"
                style={rv(`da${i}`, i * 40)}>
                <div className="doc-addr-dot" style={{ background:item.color, boxShadow:`0 0 6px ${item.color}80` }} />
                <div className="doc-addr-name">{item.name}</div>
                <div style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:'clamp(7px,1vw,9px)', fontWeight:700, letterSpacing:'0.08em', color:`${item.color}70`, flexShrink:0, padding:'2px 8px', borderRadius:5, background:`${item.color}0e` }}>{item.role}</div>
                <div className="doc-addr-hash">{item.addr}</div>
                <a href={`https://sepolia.etherscan.io/address/${item.addr}`} target="_blank" rel="noopener noreferrer" className="doc-addr-link">Etherscan ↗</a>
              </div>
            ))}
          </div>
        </div>
      </section>

      <div className="doc-divider" />

      {/* ══════ CTA ══════ */}
      <section className="doc-cta">
        <div id="cta-block" data-reveal style={{ maxWidth:500, margin:'0 auto', ...rv('cta-block') }}>
          <div style={{ fontSize:clamp(32,44), marginBottom:18, display:'inline-block' }}>◆</div>
          <h2 className="doc-cta-title">Ready to use<br />the protocol?</h2>
          <p className="doc-cta-body">Connect your wallet, purchase coverage, or provide liquidity. Everything runs on Ethereum Sepolia.</p>
          <div className="doc-cta-btns">
            <Link href="/buy-policy" className="doc-btn doc-btn-primary">Buy Coverage →</Link>
            <Link href="/pool" className="doc-btn doc-btn-ghost">Provide Liquidity</Link>
            <a href="https://github.com/NexTechArchitect/Sentinel-Insurance-Protocol" target="_blank" rel="noopener noreferrer" className="doc-btn doc-btn-ghost">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z"/></svg>
              Source Code
            </a>
          </div>
          <p style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:'clamp(7px,1.2vw,8px)', color:'rgba(88,218,255,0.22)', marginTop:20, letterSpacing:'0.14em', textTransform:'uppercase' }}>
            Sepolia Testnet · MIT License · Built by NexTech Architect
          </p>
        </div>
      </section>

      {/* Footer */}
      <footer className="doc-footer">
        <span className="doc-footer-brand">SentinelShield Documentation</span>
        <nav className="doc-footer-links">
          <Link href="/" className="doc-footer-link">← App</Link>
          <Link href="/buy-policy" className="doc-footer-link">Coverage</Link>
          <Link href="/governance" className="doc-footer-link">Governance</Link>
          <a href="https://github.com/NexTechArchitect/Sentinel-Insurance-Protocol" target="_blank" rel="noopener noreferrer" className="doc-footer-link">GitHub</a>
          <a href="https://faucet.circle.com/" target="_blank" rel="noopener noreferrer" className="doc-footer-link">Faucet</a>
        </nav>
        <span style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:'clamp(7px,1.2vw,9px)', color:'rgba(180,210,255,0.2)', letterSpacing:'0.1em' }}>Ethereum Sepolia</span>
      </footer>
    </>
  );
}

// helper for CSS clamp in JS template literals
function clamp(min: number, max: number): string {
  return `clamp(${min}px, ${(min + max) / 2 / 10}vw, ${max}px)`;
}