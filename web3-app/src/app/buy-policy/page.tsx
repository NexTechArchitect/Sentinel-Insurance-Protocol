'use client';

import React, { useEffect, useState, useCallback, useRef } from 'react';
import Link from 'next/link';
import * as THREE from 'three';
import {
  useAccount,
  useReadContract,
  useWriteContract,
  useWaitForTransactionReceipt,
  usePublicClient,
} from 'wagmi';
import { SENTINEL_ADDRESSES } from '@/constants/contracts';

// ─── ABIs ─────────────────────────────────────────────────────────────────────
const ERC20_ABI = [
  { name: 'approve',   type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'spender', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: [{ type: 'bool' }] },
  { name: 'allowance', type: 'function', stateMutability: 'view',       inputs: [{ name: 'owner', type: 'address' }, { name: 'spender', type: 'address' }], outputs: [{ type: 'uint256' }] },
  { name: 'balanceOf', type: 'function', stateMutability: 'view',       inputs: [{ name: 'account', type: 'address' }], outputs: [{ type: 'uint256' }] },
] as const;

const RISK_REGISTRY_ABI = [
  { name: 'getProtocolInfo', type: 'function', stateMutability: 'view', inputs: [{ name: 'protocol', type: 'address' }], outputs: [{ type: 'tuple', components: [{ name: 'riskScore', type: 'uint8' }, { name: 'audited', type: 'bool' }, { name: 'active', type: 'bool' }, { name: 'coverageCap', type: 'uint256' }, { name: 'registeredAt', type: 'uint256' }] }] },
  { name: 'isEligibleForCoverage', type: 'function', stateMutability: 'view', inputs: [{ name: 'protocol', type: 'address' }], outputs: [{ type: 'bool' }] },
] as const;

const POLICY_ENGINE_ABI = [
  { name: 'quotePremium', type: 'function', stateMutability: 'view', inputs: [{ name: 'protocol', type: 'address' }, { name: 'coverageAmount', type: 'uint256' }, { name: 'duration', type: 'uint256' }], outputs: [{ type: 'uint256' }] },
  { name: 'buyPolicy', type: 'function', stateMutability: 'payable', inputs: [{ name: 'protocol', type: 'address' }, { name: 'coverageAmount', type: 'uint256' }, { name: 'duration', type: 'uint256' }], outputs: [{ name: 'policyId', type: 'uint256' }] },
  { name: 'getPolicy', type: 'function', stateMutability: 'view', inputs: [{ name: 'policyId', type: 'uint256' }], outputs: [{ type: 'tuple', components: [{ name: 'holder', type: 'address' }, { name: 'protocol', type: 'address' }, { name: 'coverageAmount', type: 'uint256' }, { name: 'premium', type: 'uint256' }, { name: 'issuedAt', type: 'uint256' }, { name: 'expiresAt', type: 'uint256' }, { name: 'status', type: 'uint8' }] }] },
  { name: 'totalPolicies', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'event', name: 'PolicyIssued', inputs: [{ name: 'policyId', type: 'uint256', indexed: true }, { name: 'holder', type: 'address', indexed: true }, { name: 'protocol', type: 'address', indexed: true }, { name: 'coverageAmount', type: 'uint256', indexed: false }, { name: 'premium', type: 'uint256', indexed: false }, { name: 'expiresAt', type: 'uint256', indexed: false }] },
] as const;

// ─── Addresses ────────────────────────────────────────────────────────────────
const USDC_ADDR   = SENTINEL_ADDRESSES.USDC         as `0x${string}`;
const ENGINE_ADDR = SENTINEL_ADDRESSES.POLICY_ENGINE as `0x${string}`;
const REG_ADDR    = SENTINEL_ADDRESSES.RISK_REGISTRY as `0x${string}`;

// ─── Seed protocols (same as governance) ─────────────────────────────────────
const SEED_PROTOCOLS = [
  { address: '0x6Ae43d3271ff6888e7Fc43Fd7321a503ff738951', name: 'Aave V3' },
  { address: '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D', name: 'Uniswap V2 Pool' },
  { address: '0x3fC91A3afd70395Cd496C647d5a6CC9D4B2b7FAD', name: 'MemeFarm Protocol' },
  { address: '0x11111111254363B1a38403422974F1AE25723590', name: 'Beefy Finance Optimizer' },
  { address: '0xE592427A0AEce92De3Edee1F18E0157C05861564', name: 'Uniswap V3' },
];
const CACHE_KEY = 'sentinelshield:protocols_v9';

function loadCachedProtocols(): { address: string; name: string }[] {
  try {
    const r = localStorage.getItem(CACHE_KEY);
    const cached = r ? JSON.parse(r) : [];
    const m = new Map(SEED_PROTOCOLS.map(p => [p.address.toLowerCase(), p]));
    for (const p of cached) m.set(p.address.toLowerCase(), p);
    return Array.from(m.values());
  } catch { return SEED_PROTOCOLS; }
}

// ─── Constants ────────────────────────────────────────────────────────────────
const DAY = BigInt(86400);
const DURATION_OPTIONS = [
  { label: '7d',   value: BigInt(7)   * DAY },
  { label: '30d',  value: BigInt(30)  * DAY },
  { label: '90d',  value: BigInt(90)  * DAY },
  { label: '180d', value: BigInt(180) * DAY },
  { label: '1yr',  value: BigInt(365) * DAY },
];
const COVERAGE_PRESETS = [
  { label: '$500',  value: BigInt(500)   * BigInt(1_000_000) },
  { label: '$1K',   value: BigInt(1000)  * BigInt(1_000_000) },
  { label: '$5K',   value: BigInt(5000)  * BigInt(1_000_000) },
  { label: '$10K',  value: BigInt(10000) * BigInt(1_000_000) },
  { label: '$50K',  value: BigInt(50000) * BigInt(1_000_000) },
  { label: 'Custom', value: BigInt(0) },
];

// ─── Types ────────────────────────────────────────────────────────────────────
interface Protocol {
  address: string;
  name: string;
  riskScore: number;
  audited: boolean;
  coverageCap: bigint;
  active: boolean;
}
interface MyPolicy {
  id: number;
  protocol: string;
  coverageAmount: bigint;
  premium: bigint;
  expiresAt: bigint;
  status: number;
}
type Step = 'form' | 'quote' | 'approve' | 'buy' | 'success';
type Tab  = 'buy' | 'policies';

// ─── Helpers ─────────────────────────────────────────────────────────────────
const fmtUsdc   = (v: bigint) => { const n = Number(v) / 1e6; if (n >= 1e6) return `${(n/1e6).toFixed(2)}M`; if (n >= 1e3) return `${(n/1e3).toFixed(2)}K`; return n.toFixed(2); };
const shortAddr = (a: string) => `${a.slice(0,6)}…${a.slice(-4)}`;
const fmtDate   = (ts: bigint) => new Date(Number(ts) * 1000).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
const riskMeta  = (s: number) => s <= 30 ? { label: 'LOW',  color: '#00FF66', glow: 'rgba(0,255,102,0.3)' }
                                : s <= 60 ? { label: 'MED',  color: '#FFD700', glow: 'rgba(255,215,0,0.3)' }
                                :           { label: 'HIGH', color: '#FF003C', glow: 'rgba(255,0,60,0.3)' };
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

// ─── 3D WebGL Background ──────────────────────────────────────────────────────
function CinematicBg() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const mount = ref.current; if (!mount) return;
    const W = innerWidth, H = innerHeight;
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setClearColor(0, 0);
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.setSize(W, H);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.4;
    mount.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x000408, 0.00055);
    const cam = new THREE.PerspectiveCamera(50, W / H, 0.1, 4000);
    cam.position.set(0, 60, 700);

    scene.add(new THREE.AmbientLight(0x050a1a, 3));
    const pl1 = new THREE.PointLight(0x0088ff, 12, 1500); pl1.position.set(-200, 100, 200); scene.add(pl1);
    const pl2 = new THREE.PointLight(0x00ffaa, 8, 1000);  pl2.position.set(200, -80, 100);  scene.add(pl2);
    const pl3 = new THREE.PointLight(0xFFD700, 5, 800);   pl3.position.set(0, -150, -200);  scene.add(pl3);

    // Deep starfield
    const starGeo = new THREE.BufferGeometry();
    const starPos = new Float32Array(6000 * 3);
    const starCol = new Float32Array(6000 * 3);
    for (let i = 0; i < 6000; i++) {
      const r = 800 + Math.random() * 2000;
      const t = Math.random() * Math.PI * 2; const p = Math.acos(2 * Math.random() - 1);
      starPos[i*3]   = r * Math.sin(p) * Math.cos(t);
      starPos[i*3+1] = r * Math.cos(p) * 0.4;
      starPos[i*3+2] = r * Math.sin(p) * Math.sin(t);
      const c = Math.random() < 0.5 ? new THREE.Color('#0088ff') : new THREE.Color('#00ffaa');
      const b = 0.3 + Math.random() * 0.7;
      starCol[i*3]=c.r*b; starCol[i*3+1]=c.g*b; starCol[i*3+2]=c.b*b;
    }
    starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
    starGeo.setAttribute('color', new THREE.BufferAttribute(starCol, 3));
    const stars = new THREE.Points(starGeo, new THREE.PointsMaterial({
      size: 1.2, vertexColors: true, transparent: true, opacity: 0.7,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    scene.add(stars);

    // Floating hexagonal grid energy field
    const hexGroup = new THREE.Group();
    scene.add(hexGroup);
    for (let i = 0; i < 40; i++) {
      const size = 8 + Math.random() * 20;
      const geo = new THREE.RingGeometry(size * 0.85, size, 6);
      const hue = Math.random() < 0.5 ? '#0055aa' : '#004433';
      const mat = new THREE.MeshBasicMaterial({
        color: new THREE.Color(hue), transparent: true,
        opacity: 0.04 + Math.random() * 0.06,
        side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(
        (Math.random() - 0.5) * 1200,
        (Math.random() - 0.5) * 600,
        (Math.random() - 0.5) * 400 - 200,
      );
      mesh.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, 0);
      mesh.userData.spd = (Math.random() - 0.5) * 0.003;
      hexGroup.add(mesh);
    }

    // Orbiting data orbs
    const orbs: THREE.Mesh[] = [];
    const orbLights: THREE.PointLight[] = [];
    const orbData = [
      { r: 180, spd: 0.12, phase: 0,    col: 0x0088ff, size: 6 },
      { r: 260, spd: 0.08, phase: 2.1,  col: 0x00ffaa, size: 5 },
      { r: 340, spd: 0.055,phase: 4.2,  col: 0xFFD700, size: 4 },
      { r: 420, spd: 0.038,phase: 1.05, col: 0xff4488, size: 5.5 },
      { r: 500, spd: 0.025,phase: 3.1,  col: 0x44aaff, size: 4.5 },
    ];
    orbData.forEach(od => {
      const orb = new THREE.Mesh(
        new THREE.SphereGeometry(od.size, 32, 32),
        new THREE.MeshStandardMaterial({ color: od.col, emissive: od.col, emissiveIntensity: 1.2, roughness: 0.1, metalness: 0.9 }),
      );
      scene.add(orb); orbs.push(orb);
      const pl = new THREE.PointLight(od.col, 4, 200); scene.add(pl); orbLights.push(pl);
    });

    // Particle dust field
    const dustGeo = new THREE.BufferGeometry();
    const dustPos = new Float32Array(3000 * 3);
    for (let i = 0; i < 3000; i++) {
      dustPos[i*3]   = (Math.random()-0.5)*1400;
      dustPos[i*3+1] = (Math.random()-0.5)*700;
      dustPos[i*3+2] = (Math.random()-0.5)*600 - 100;
    }
    dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPos, 3));
    scene.add(new THREE.Points(dustGeo, new THREE.PointsMaterial({
      size: 0.7, color: 0x0066cc, transparent: true, opacity: 0.35,
      blending: THREE.AdditiveBlending, depthWrite: false,
    })));

    const mouse = { x: 0, y: 0 };
    const onMM = (e: MouseEvent) => { mouse.x = (e.clientX/innerWidth-0.5)*2; mouse.y = -(e.clientY/innerHeight-0.5)*2; };
    const onR  = () => { renderer.setSize(innerWidth,innerHeight); cam.aspect=innerWidth/innerHeight; cam.updateProjectionMatrix(); };
    window.addEventListener('mousemove', onMM, { passive: true });
    window.addEventListener('resize', onR, { passive: true });

    let raf = 0; let t = 0;
    const tick = () => {
      t += 0.008;
      stars.rotation.y = t * 0.004;
      hexGroup.children.forEach((m: THREE.Object3D) => { m.rotation.z += (m as THREE.Mesh).userData.spd; });
      orbData.forEach((od, i) => {
        const angle = od.phase + t * od.spd;
        const x = Math.cos(angle) * od.r;
        const z = Math.sin(angle) * od.r * 0.4;
        const y = Math.sin(angle * 1.5) * 30;
        orbs[i].position.set(x, y, z);
        orbLights[i].position.set(x, y, z);
        orbs[i].scale.setScalar(1 + Math.sin(t * 2 + i) * 0.08);
      });
      cam.position.x += (mouse.x * 60 - cam.position.x) * 0.02;
      cam.position.y += (60 + mouse.y * 30 - cam.position.y) * 0.02;
      cam.lookAt(0, 0, 0);
      renderer.render(scene, cam);
      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('mousemove', onMM);
      window.removeEventListener('resize', onR);
      if (mount.contains(renderer.domElement)) mount.removeChild(renderer.domElement);
      renderer.dispose();
    };
  }, []);
  return <div style={{ position:'fixed', inset:0, zIndex:0, pointerEvents:'none' }} ref={ref} aria-hidden />;
}

// ─── Protocol Card ────────────────────────────────────────────────────────────
function ProtocolCard({ p, selected, onSelect }: { p: Protocol; selected: boolean; onSelect: () => void }) {
  const rm = riskMeta(p.riskScore);
  return (
    <div
      onClick={onSelect}
      style={{
        padding: '18px', cursor: 'pointer', position: 'relative',
        border: selected ? `1px solid ${rm.color}` : '1px solid rgba(0,200,255,0.12)',
        background: selected ? `rgba(0,200,255,0.04)` : 'rgba(0,8,20,0.6)',
        borderRadius: '14px', backdropFilter: 'blur(20px)',
        boxShadow: selected ? `0 0 30px ${rm.glow}, inset 0 1px 0 rgba(255,255,255,0.06)` : '0 4px 20px rgba(0,0,0,0.5)',
        transition: 'all 0.25s ease',
        transform: selected ? 'translateY(-2px)' : 'none',
      }}
    >
      {selected && (
        <div style={{
          position:'absolute', top:10, right:10, width:20, height:20,
          borderRadius:'50%', background: rm.color, display:'flex',
          alignItems:'center', justifyContent:'center',
          fontSize:11, fontWeight:700, color:'#000',
        }}>✓</div>
      )}
      <div style={{ fontFamily:"'Space Grotesk',sans-serif", fontSize:15, fontWeight:700, color:'#fff', marginBottom:4 }}>{p.name}</div>
      <div style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:9, color:'rgba(255,255,255,0.4)', marginBottom:10 }}>{shortAddr(p.address)}</div>
      <div style={{ display:'flex', gap:6, flexWrap:'wrap', marginBottom:8 }}>
        <span style={{
          padding:'2px 8px', fontSize:9, fontWeight:700, letterSpacing:'0.1em',
          border:`1px solid ${rm.color}55`, borderRadius:4, color: rm.color,
          background:`${rm.color}11`,
        }}>{rm.label} {p.riskScore}/100</span>
        <span style={{
          padding:'2px 8px', fontSize:9, fontWeight:700, letterSpacing:'0.1em',
          border: p.audited ? '1px solid #00FF6655' : '1px solid rgba(255,255,255,0.1)',
          borderRadius:4,
          color: p.audited ? '#00FF66' : 'rgba(255,255,255,0.3)',
          background: p.audited ? 'rgba(0,255,102,0.08)' : 'transparent',
        }}>{p.audited ? '✓ AUDITED' : '✗ UNAUDITED'}</span>
      </div>
      <div style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:9, color:'rgba(255,255,255,0.35)' }}>
        CAP ${fmtUsdc(p.coverageCap)} USDC
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function BuyPolicyPage() {
  const { address, isConnected } = useAccount();
  const publicClient = usePublicClient();
  const [mounted, setMounted] = useState(false);
  const [tab, setTab] = useState<Tab>('buy');

  // Protocol state
  const [protocols, setProtocols]       = useState<Protocol[]>([]);
  const [protocolsLoading, setProtLoad] = useState(true);
  const [selected, setSelected]         = useState<Protocol | null>(null);

  // Coverage
  const [presetIdx, setPresetIdx]   = useState(1);
  const [isCustom,  setIsCustom]    = useState(false);
  const [customVal, setCustomVal]   = useState('');
  const [coverage,  setCoverage]    = useState<bigint>(BigInt(1000) * BigInt(1_000_000));
  const [duration,  setDuration]    = useState<bigint>(BigInt(30) * DAY);

  // Tx flow
  const [step,       setStep]       = useState<Step>('form');
  const [txError,    setTxError]    = useState<string | null>(null);
  const [successId,  setSuccessId]  = useState<number | null>(null);
  const [successMeta,setSuccessMeta]= useState<{ coverage: bigint; expires: bigint; protocol: string } | null>(null);

  // Policies
  const [policies,      setPolicies]      = useState<MyPolicy[]>([]);
  const [policiesLoading,setPoliciesLoad] = useState(false);

  // Reads
  const { data: usdcBalance }  = useReadContract({ address: USDC_ADDR, abi: ERC20_ABI, functionName: 'balanceOf', args: address ? [address as `0x${string}`] : undefined, query: { enabled: !!address } });
  const { data: allowance, refetch: refetchAllowance } = useReadContract({ address: USDC_ADDR, abi: ERC20_ABI, functionName: 'allowance', args: address ? [address as `0x${string}`, ENGINE_ADDR] : undefined, query: { enabled: !!address } });
  const { data: quotedPremium, isLoading: quoteLoading } = useReadContract({ address: ENGINE_ADDR, abi: POLICY_ENGINE_ABI, functionName: 'quotePremium', args: selected ? [selected.address as `0x${string}`, coverage, duration] : undefined, query: { enabled: !!selected && coverage > BigInt(0) } });

  // Writes
  const { writeContract: writeApprove, data: approveTxHash, isPending: approving, reset: resetApprove } = useWriteContract();
  const { isLoading: approveWaiting, isSuccess: approveOk } = useWaitForTransactionReceipt({ hash: approveTxHash });
  const { writeContract: writeBuy, data: buyTxHash, isPending: buying, reset: resetBuy } = useWriteContract();
  const { isLoading: buyWaiting, isSuccess: buyOk, data: buyReceipt } = useWaitForTransactionReceipt({ hash: buyTxHash });

  useEffect(() => setMounted(true), []);

  // Load active protocols from chain using governance cache
  useEffect(() => {
    if (!publicClient) return;
    (async () => {
      setProtLoad(true);
      const cached = loadCachedProtocols();
      const result: Protocol[] = [];
      for (const cp of cached) {
        try {
          const info = await publicClient.readContract({
            address: REG_ADDR, abi: RISK_REGISTRY_ABI, functionName: 'getProtocolInfo',
            args: [cp.address as `0x${string}`],
          }) as { riskScore: number; audited: boolean; active: boolean; coverageCap: bigint; registeredAt: bigint };
          if (info.registeredAt !== BigInt(0) && info.active) {
            result.push({ address: cp.address, name: cp.name, riskScore: info.riskScore, audited: info.audited, coverageCap: info.coverageCap, active: true });
          }
        } catch {}
      }
      setProtocols(result);
      setProtLoad(false);
    })();
  }, [publicClient]);

  // Fetch user policies
  const fetchPolicies = useCallback(async () => {
    if (!publicClient || !address) return;
    setPoliciesLoad(true);
    try {
      const total = await publicClient.readContract({ address: ENGINE_ADDR, abi: POLICY_ENGINE_ABI, functionName: 'totalPolicies' }) as bigint;
      const list: MyPolicy[] = [];
      for (let i = BigInt(0); i < total; i++) {
        try {
          const p = await publicClient.readContract({ address: ENGINE_ADDR, abi: POLICY_ENGINE_ABI, functionName: 'getPolicy', args: [i] }) as any;
          if (p.holder.toLowerCase() === address.toLowerCase()) {
            list.push({ id: Number(i), protocol: p.protocol, coverageAmount: p.coverageAmount, premium: p.premium, expiresAt: p.expiresAt, status: p.status });
          }
        } catch {}
      }
      setPolicies(list.reverse());
    } catch {}
    setPoliciesLoad(false);
  }, [publicClient, address]);

  useEffect(() => { if (approveOk) { refetchAllowance(); setStep('buy'); } }, [approveOk, refetchAllowance]);

  useEffect(() => {
    if (!buyOk || !buyReceipt) return;
    let pid: number | null = null;
    // decode PolicyIssued from receipt logs
    for (const log of buyReceipt.logs) {
      try {
        const topics = log.topics;
        if (topics[0] === '0x' + Buffer.from('PolicyIssued(uint256,address,address,uint256,uint256,uint256)').toString('hex').slice(0,8)) {
          pid = Number(BigInt(topics[1] as string));
          break;
        }
      } catch {}
    }
    if (pid === null && buyReceipt.logs.length > 0) {
      try { pid = Number(BigInt(buyReceipt.logs[0].topics[1] as string)); } catch {}
    }
    setSuccessId(pid ?? 0);
    if (selected) setSuccessMeta({ coverage, expires: BigInt(Math.floor(Date.now() / 1000)) + duration, protocol: selected.address });
    setStep('success');
  }, [buyOk, buyReceipt]);

  const needsApproval = !allowance || (quotedPremium && (allowance as bigint) < (quotedPremium as bigint));
  const busy = approving || approveWaiting || buying || buyWaiting;

  const handleReset = () => {
    setStep('form'); setSelected(null); setPresetIdx(1); setIsCustom(false);
    setCustomVal(''); setCoverage(BigInt(1000) * BigInt(1_000_000)); setDuration(BigInt(30) * DAY);
    setSuccessId(null); setSuccessMeta(null); setTxError(null); resetApprove(); resetBuy();
  };

  const durLabel = DURATION_OPTIONS.find(d => d.value === duration)?.label ?? `${Number(duration / DAY)}d`;

  if (!mounted) return <div suppressHydrationWarning style={{ minHeight: '100vh', background: '#000408' }} />;

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600;700&family=Cormorant+Garamond:ital,wght@1,600;1,700&display=swap');
        *,*::before,*::after{box-sizing:border-box;margin:0;padding:0;}
        html,body{background:#000408;overflow-x:hidden;}
        :root{--blue:#0088ff;--teal:#00ffaa;--gold:#FFD700;--red:#FF003C;--green:#00FF66;}
        .bp-root{position:relative;z-index:10;min-height:100vh;font-family:'Space Grotesk',sans-serif;color:#fff;}
        .bp-nav{position:sticky;top:0;z-index:50;display:flex;align-items:center;justify-content:space-between;height:52px;padding:0 24px;background:rgba(0,4,20,0.7);border-bottom:1px solid rgba(0,200,255,0.08);backdrop-filter:blur(24px);}
        .bp-brand{font-size:16px;font-weight:700;color:#fff;text-decoration:none;letter-spacing:-0.02em;}
        .bp-brand em{color:var(--teal);font-style:normal;}
        .bp-nav-links{display:flex;gap:4px;}
        .bp-nav-a{padding:0 12px;height:52px;display:flex;align-items:center;font-family:'JetBrains Mono',monospace;font-size:10px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:rgba(255,255,255,0.4);text-decoration:none;border-bottom:2px solid transparent;transition:all 0.2s;}
        .bp-nav-a:hover{color:rgba(255,255,255,0.8);}
        .bp-nav-a.on{color:var(--teal);border-bottom-color:var(--teal);}
        .bp-wallet{padding:4px 14px;border:1px solid rgba(0,200,255,0.2);border-radius:6px;font-family:'JetBrains Mono',monospace;font-size:10px;color:rgba(255,255,255,0.5);}
        .bp-hdr{padding:40px 28px 30px;border-bottom:1px solid rgba(0,200,255,0.06);}
        .bp-eyebrow{font-family:'JetBrains Mono',monospace;font-size:9px;font-weight:700;letter-spacing:0.2em;text-transform:uppercase;color:rgba(0,200,255,0.6);margin-bottom:10px;display:flex;align-items:center;gap:8px;}
        .bp-eyebrow::before{content:'';display:inline-block;width:6px;height:6px;border-radius:50%;background:var(--teal);box-shadow:0 0 12px rgba(0,255,170,0.8);}
        .bp-h1{font-family:'Cormorant Garamond',serif;font-size:clamp(44px,5.5vw,72px);font-style:italic;font-weight:700;line-height:0.9;background:linear-gradient(180deg,#fff 40%,rgba(0,200,255,0.7));-webkit-background-clip:text;-webkit-text-fill-color:transparent;margin-bottom:12px;}
        .bp-hdrsub{font-size:13px;color:rgba(255,255,255,0.45);max-width:520px;line-height:1.6;}
        .bp-tabs{display:flex;border-bottom:1px solid rgba(0,200,255,0.08);background:rgba(0,4,20,0.5);}
        .bp-tab{padding:0 22px;height:46px;display:flex;align-items:center;gap:8px;font-family:'JetBrains Mono',monospace;font-size:10px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:rgba(255,255,255,0.35);background:none;border:none;border-bottom:2px solid transparent;margin-bottom:-1px;cursor:pointer;transition:all 0.2s;}
        .bp-tab:hover{color:rgba(255,255,255,0.7);}
        .bp-tab.on{color:var(--teal);border-bottom-color:var(--teal);}
        .bp-tab-badge{min-width:18px;height:18px;padding:0 4px;display:flex;align-items:center;justify-content:center;font-size:9px;background:rgba(0,255,170,0.1);color:var(--teal);border:1px solid rgba(0,255,170,0.25);border-radius:4px;}
        .bp-layout{display:grid;grid-template-columns:1fr 340px;max-width:1380px;margin:0 auto;}
        @media(max-width:980px){.bp-layout{grid-template-columns:1fr;}}
        .bp-left{border-right:1px solid rgba(0,200,255,0.06);min-height:calc(100vh - 150px);}
        .bp-right{padding:22px;}
        .bp-section{padding:22px 26px;border-bottom:1px solid rgba(0,200,255,0.06);}
        .bp-slabel{font-family:'JetBrains Mono',monospace;font-size:9px;font-weight:700;letter-spacing:0.16em;text-transform:uppercase;color:rgba(0,200,255,0.55);margin-bottom:14px;display:flex;align-items:center;gap:10px;}
        .bp-snum{display:flex;align-items:center;justify-content:center;width:18px;height:18px;border:1px solid rgba(0,200,255,0.3);border-radius:4px;font-size:9px;color:var(--teal);flex-shrink:0;}
        .bp-proto-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:10px;margin-bottom:4px;}
        .bp-presets{display:grid;grid-template-columns:repeat(3,1fr);gap:7px;margin-bottom:10px;}
        .bp-preset{padding:11px 8px;text-align:center;cursor:pointer;border-radius:8px;border:1px solid rgba(0,200,255,0.1);background:rgba(0,8,20,0.7);font-family:'JetBrains Mono',monospace;font-size:10px;font-weight:700;color:rgba(255,255,255,0.4);transition:all 0.2s;}
        .bp-preset:hover{border-color:rgba(0,200,255,0.3);color:rgba(255,255,255,0.8);}
        .bp-preset.on{border-color:var(--teal);color:var(--teal);background:rgba(0,255,170,0.05);}
        .bp-custom{display:flex;border:1px solid rgba(0,200,255,0.12);border-radius:8px;background:rgba(0,8,20,0.7);overflow:hidden;transition:border-color 0.2s;}
        .bp-custom:focus-within{border-color:rgba(0,200,255,0.5);}
        .bp-custom-pre{padding:0 12px;height:42px;display:flex;align-items:center;font-size:13px;color:rgba(255,255,255,0.4);border-right:1px solid rgba(0,200,255,0.1);flex-shrink:0;}
        .bp-custom-inp{flex:1;height:42px;padding:0 12px;background:transparent;border:none;outline:none;font-family:'JetBrains Mono',monospace;font-size:13px;color:#fff;}
        .bp-custom-inp::placeholder{color:rgba(255,255,255,0.2);}
        .bp-custom-suf{padding:0 12px;height:42px;display:flex;align-items:center;font-size:9px;font-weight:700;color:rgba(255,255,255,0.25);border-left:1px solid rgba(0,200,255,0.1);flex-shrink:0;letter-spacing:0.1em;}
        .bp-durs{display:flex;gap:7px;flex-wrap:wrap;}
        .bp-dur{padding:8px 16px;cursor:pointer;border-radius:8px;border:1px solid rgba(0,200,255,0.1);background:rgba(0,8,20,0.7);font-family:'JetBrains Mono',monospace;font-size:10px;font-weight:700;color:rgba(255,255,255,0.4);transition:all 0.2s;}
        .bp-dur:hover{border-color:rgba(0,200,255,0.3);color:rgba(255,255,255,0.8);}
        .bp-dur.on{border-color:var(--teal);color:var(--teal);background:rgba(0,255,170,0.05);}
        .bp-stepbar{display:flex;align-items:center;padding:14px 0 20px;}
        .bp-sdot{display:flex;align-items:center;}
        .bp-sdot-c{width:24px;height:24px;border-radius:50%;border:1px solid rgba(0,200,255,0.2);background:rgba(0,8,20,0.9);display:flex;align-items:center;justify-content:center;font-family:'JetBrains Mono',monospace;font-size:9px;font-weight:700;color:rgba(255,255,255,0.3);flex-shrink:0;z-index:1;transition:all 0.3s;}
        .bp-sdot span{font-family:'JetBrains Mono',monospace;font-size:9px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:rgba(255,255,255,0.25);margin-left:7px;white-space:nowrap;transition:color 0.3s;}
        .bp-sdot-line{flex:1;height:1px;background:rgba(0,200,255,0.1);margin:0 10px;min-width:14px;}
        .bp-sdot.on .bp-sdot-c{border-color:var(--teal);color:var(--teal);box-shadow:0 0 16px rgba(0,255,170,0.3);}
        .bp-sdot.on span{color:var(--teal);}
        .bp-sdot.done .bp-sdot-c{border-color:var(--green);background:rgba(0,255,102,0.1);color:var(--green);}
        .bp-btn{padding:11px 20px;cursor:pointer;font-family:'JetBrains Mono',monospace;font-size:10px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;display:inline-flex;align-items:center;justify-content:center;gap:8px;border:1px solid;border-radius:8px;transition:all 0.2s;white-space:nowrap;}
        .bp-btn:disabled{opacity:0.3;cursor:not-allowed;}
        .bp-btn-teal{border-color:var(--teal);background:rgba(0,255,170,0.08);color:var(--teal);}
        .bp-btn-teal:hover:not(:disabled){background:rgba(0,255,170,0.15);box-shadow:0 0 20px rgba(0,255,170,0.2);}
        .bp-btn-white{border-color:rgba(255,255,255,0.7);background:rgba(255,255,255,0.9);color:#000;}
        .bp-btn-white:hover:not(:disabled){background:#fff;box-shadow:0 0 24px rgba(255,255,255,0.3);}
        .bp-btn-ghost{border-color:rgba(0,200,255,0.2);background:transparent;color:rgba(255,255,255,0.45);}
        .bp-btn-ghost:hover:not(:disabled){color:rgba(255,255,255,0.8);border-color:rgba(0,200,255,0.4);}
        .bp-btn-lg{padding:14px 24px;font-size:11px;}
        .bp-actions{display:flex;gap:10px;margin-top:26px;flex-wrap:wrap;}
        .bp-banner{padding:10px 14px;margin-bottom:14px;display:flex;align-items:center;gap:9px;font-family:'JetBrains Mono',monospace;font-size:10px;border-radius:8px;border:1px solid;}
        .bp-bi{border-color:rgba(0,200,255,0.3);background:rgba(0,200,255,0.06);color:rgba(0,200,255,0.9);}
        .bp-be{border-color:rgba(255,0,60,0.3);background:rgba(255,0,60,0.06);color:#FF003C;}
        .bp-bg{border-color:rgba(0,255,102,0.3);background:rgba(0,255,102,0.06);color:#00FF66;}
        .bp-spin{display:inline-block;width:12px;height:12px;border-radius:50%;flex-shrink:0;border:2px solid rgba(0,200,255,0.15);border-top-color:var(--teal);animation:bpspin 0.7s linear infinite;}
        @keyframes bpspin{to{transform:rotate(360deg);}}
        .bp-quote{border:1px solid rgba(0,200,255,0.12);border-radius:16px;background:rgba(0,8,20,0.7);overflow:hidden;backdrop-filter:blur(24px);}
        .bp-qhdr{padding:18px 20px;border-bottom:1px solid rgba(0,200,255,0.08);}
        .bp-qhdr-title{font-family:'Cormorant Garamond',serif;font-size:24px;font-style:italic;font-weight:700;color:#fff;margin-bottom:2px;}
        .bp-qhdr-sub{font-family:'JetBrains Mono',monospace;font-size:9px;letter-spacing:0.1em;text-transform:uppercase;color:rgba(0,200,255,0.5);}
        .bp-qrow{display:flex;justify-content:space-between;align-items:center;padding:9px 20px;border-bottom:1px solid rgba(0,200,255,0.06);}
        .bp-qrow:last-child{border-bottom:none;}
        .bp-qk{font-family:'JetBrains Mono',monospace;font-size:9px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:rgba(255,255,255,0.35);flex-shrink:0;}
        .bp-qv{font-family:'JetBrains Mono',monospace;font-size:10px;color:rgba(255,255,255,0.75);text-align:right;word-break:break-all;}
        .bp-premium{padding:22px 20px;text-align:center;border-top:1px solid rgba(255,215,0,0.12);border-bottom:1px solid rgba(255,215,0,0.12);background:rgba(255,215,0,0.03);}
        .bp-premium-lbl{font-family:'JetBrains Mono',monospace;font-size:9px;font-weight:700;letter-spacing:0.16em;text-transform:uppercase;color:rgba(255,215,0,0.6);margin-bottom:10px;}
        .bp-premium-amt{font-family:'Cormorant Garamond',serif;font-size:48px;font-style:italic;font-weight:700;color:var(--gold);line-height:1;}
        .bp-premium-sub{font-family:'JetBrains Mono',monospace;font-size:9px;color:rgba(255,255,255,0.3);margin-top:6px;}
        .bp-bal{display:flex;justify-content:space-between;padding:7px 12px;border:1px solid rgba(0,200,255,0.1);border-radius:8px;background:rgba(0,8,20,0.6);margin-bottom:12px;}
        .bp-bal-k{font-family:'JetBrains Mono',monospace;font-size:9px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:rgba(255,255,255,0.3);}
        .bp-bal-v{font-family:'JetBrains Mono',monospace;font-size:10px;font-weight:700;color:rgba(255,255,255,0.75);}
        .bp-empty{padding:52px 24px;text-align:center;border:1px dashed rgba(0,200,255,0.1);border-radius:12px;}
        .bp-empty-t{font-family:'Cormorant Garamond',serif;font-size:22px;font-style:italic;color:rgba(255,255,255,0.35);margin-bottom:8px;}
        .bp-empty-s{font-size:12px;color:rgba(255,255,255,0.25);line-height:1.6;}
        .bp-loading{display:flex;align-items:center;gap:10px;padding:24px 0;color:rgba(0,200,255,0.6);font-family:'JetBrains Mono',monospace;font-size:11px;}
        .bp-success{border:1px solid rgba(0,255,102,0.2);border-radius:16px;background:rgba(0,8,20,0.8);overflow:hidden;backdrop-filter:blur(24px);}
        .bp-success-hdr{padding:36px 28px;text-align:center;border-bottom:1px solid rgba(0,255,102,0.1);}
        .bp-success-icon{width:60px;height:60px;border-radius:50%;border:2px solid var(--green);background:rgba(0,255,102,0.1);display:flex;align-items:center;justify-content:center;font-size:26px;margin:0 auto 16px;animation:popin 0.5s cubic-bezier(0.175,0.885,0.32,1.275);}
        @keyframes popin{from{transform:scale(0.2);opacity:0}to{transform:scale(1);opacity:1}}
        .bp-success-title{font-family:'Cormorant Garamond',serif;font-size:34px;font-style:italic;color:#fff;margin-bottom:4px;}
        .bp-success-sub{font-size:12px;color:rgba(255,255,255,0.4);}
        .bp-nft{border:1px solid rgba(0,200,255,0.15);border-radius:12px;background:rgba(0,8,20,0.6);padding:18px;margin:20px 0;}
        .bp-nft-badge{font-family:'JetBrains Mono',monospace;font-size:8px;font-weight:700;letter-spacing:0.16em;text-transform:uppercase;color:rgba(0,200,255,0.5);margin-bottom:10px;}
        .bp-nft-id{font-family:'Cormorant Garamond',serif;font-size:56px;font-style:italic;font-weight:700;color:#fff;line-height:1;margin:8px 0 16px;}
        .bp-nft-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px;}
        .bp-nft-item label{font-family:'JetBrains Mono',monospace;font-size:8px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:rgba(255,255,255,0.25);display:block;margin-bottom:3px;}
        .bp-nft-item span{font-family:'JetBrains Mono',monospace;font-size:10px;color:rgba(255,255,255,0.8);}
        .bp-sbtn{padding:8px 14px;border:1px solid rgba(0,200,255,0.15);border-radius:7px;background:transparent;color:rgba(255,255,255,0.4);font-family:'JetBrains Mono',monospace;font-size:9px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;cursor:pointer;text-decoration:none;display:inline-flex;align-items:center;transition:all 0.2s;}
        .bp-sbtn:hover{color:var(--teal);border-color:rgba(0,255,170,0.3);}
        .bp-policy{padding:20px 26px;border-bottom:1px solid rgba(0,200,255,0.06);transition:background 0.2s;}
        .bp-policy:hover{background:rgba(0,200,255,0.03);}
        .bp-policy-top{display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;gap:10px;flex-wrap:wrap;}
        .bp-policy-id{font-family:'Cormorant Garamond',serif;font-size:20px;font-style:italic;color:#fff;}
        .bp-pill{padding:2px 8px;font-family:'JetBrains Mono',monospace;font-size:9px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;border-radius:4px;border:1px solid currentColor;}
        .bp-pmeta{display:flex;gap:20px;flex-wrap:wrap;}
        .bp-pmi{display:flex;flex-direction:column;gap:2px;}
        .bp-pmi-k{font-family:'JetBrains Mono',monospace;font-size:8px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:rgba(255,255,255,0.25);}
        .bp-pmi-v{font-family:'JetBrains Mono',monospace;font-size:10px;color:rgba(255,255,255,0.75);}
        .bp-nowallet{padding:64px 28px;text-align:center;}
        .bp-nowallet-t{font-family:'Cormorant Garamond',serif;font-size:28px;font-style:italic;color:rgba(255,255,255,0.4);}
        .bp-qnote{padding:12px 20px;font-family:'JetBrains Mono',monospace;font-size:9px;line-height:1.65;color:rgba(255,255,255,0.25);}
        .bp-refresh{padding:4px 10px;font-family:'JetBrains Mono',monospace;font-size:9px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;border:1px solid rgba(0,200,255,0.15);border-radius:6px;background:transparent;color:rgba(0,200,255,0.5);cursor:pointer;transition:all 0.2s;}
        .bp-refresh:hover{color:var(--teal);border-color:rgba(0,255,170,0.3);}
        @media(max-width:640px){.bp-presets{grid-template-columns:repeat(2,1fr);}.bp-proto-grid{grid-template-columns:1fr;}.bp-nav-a{padding:0 8px;font-size:9px;}.bp-right{border-top:1px solid rgba(0,200,255,0.06);}.bp-nft-grid{grid-template-columns:1fr;}}
      `}</style>

      <CinematicBg />

      <div className="bp-root">
        <nav className="bp-nav">
          <Link href="/" className="bp-brand">Sentinel<em>Shield</em></Link>
          <div className="bp-nav-links">
            <Link href="/buy-policy" className="bp-nav-a on">Coverage</Link>
            <Link href="/claims"     className="bp-nav-a">Claims</Link>
            <Link href="/governance" className="bp-nav-a">Governance</Link>
          </div>
          <span className="bp-wallet">{isConnected && address ? shortAddr(address) : 'No Wallet'}</span>
        </nav>

        <div className="bp-hdr">
          <div className="bp-eyebrow">Coverage Acquisition · Sepolia Testnet</div>
          <h1 className="bp-h1">Buy Coverage</h1>
          <p className="bp-hdrsub">
            Select an active protocol from the on-chain registry, configure your coverage parameters,
            and receive a live premium quote via PremiumMath. Only active protocols are shown.
          </p>
        </div>

        <div className="bp-tabs">
          <button className={`bp-tab ${tab === 'buy' ? 'on' : ''}`} onClick={() => setTab('buy')}>Buy Policy</button>
          <button className={`bp-tab ${tab === 'policies' ? 'on' : ''}`} onClick={() => { setTab('policies'); fetchPolicies(); }}>
            My Policies {policies.length > 0 && <span className="bp-tab-badge">{policies.length}</span>}
          </button>
        </div>

        {!isConnected ? (
          <div className="bp-nowallet"><div className="bp-nowallet-t">Connect wallet to continue</div></div>

        ) : tab === 'buy' ? (
          <div className="bp-layout">
            <div className="bp-left">

              {step === 'success' && successId !== null && successMeta ? (
                <div style={{ padding: 26 }}>
                  <div className="bp-success">
                    <div className="bp-success-hdr">
                      <div className="bp-success-icon">✓</div>
                      <div className="bp-success-title">Policy Secured</div>
                      <div className="bp-success-sub">Soulbound PolicyNFT (ERC-5484) minted to your wallet</div>
                    </div>
                    <div style={{ padding: '20px 26px' }}>
                      <div className="bp-nft">
                        <div className="bp-nft-badge">ERC-5484 Soulbound · SentinelShield Policy</div>
                        <div className="bp-nft-id">#{successId}</div>
                        <div className="bp-nft-grid">
                          <div className="bp-nft-item"><label>Protocol</label><span>{shortAddr(successMeta.protocol)}</span></div>
                          <div className="bp-nft-item"><label>Coverage</label><span>${fmtUsdc(successMeta.coverage)} USDC</span></div>
                          <div className="bp-nft-item"><label>Expires</label><span>{fmtDate(successMeta.expires)}</span></div>
                          <div className="bp-nft-item"><label>Status</label><span style={{ color: 'var(--green)' }}>ACTIVE</span></div>
                        </div>
                      </div>
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        <button className="bp-sbtn" onClick={handleReset}>Buy Another</button>
                        <button className="bp-sbtn" onClick={() => { setTab('policies'); fetchPolicies(); }}>View Policies</button>
                        {buyTxHash && <a className="bp-sbtn" href={`https://sepolia.etherscan.io/tx/${buyTxHash}`} target="_blank" rel="noreferrer">Etherscan ↗</a>}
                        <a className="bp-sbtn" href={`https://sepolia.etherscan.io/token/${SENTINEL_ADDRESSES.POLICY_NFT}?a=${successId}`} target="_blank" rel="noreferrer">View NFT ↗</a>
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="bp-section" style={{ borderBottom: 'none' }}>
                  {txError && <div className="bp-banner bp-be"><span>⚠</span> {txError}</div>}
                  {step === 'approve' && (approving || approveWaiting) && <div className="bp-banner bp-bi"><span className="bp-spin" />{approving ? 'Sign USDC approval in wallet…' : 'Confirming approval on-chain…'}</div>}
                  {step === 'buy' && (buying || buyWaiting) && <div className="bp-banner bp-bi"><span className="bp-spin" />{buying ? 'Sign policy purchase in wallet…' : 'Minting PolicyNFT on-chain…'}</div>}

                  {/* Stepbar */}
                  <div className="bp-stepbar">
                    {['Configure','Quote','Approve','Buy'].map((s, i) => {
                      const idx = { form:0, quote:1, approve:2, buy:3, success:4 }[step];
                      return (
                        <div key={s} className={`bp-sdot ${idx === i ? 'on' : ''} ${idx > i ? 'done' : ''}`}>
                          <div className="bp-sdot-c">{idx > i ? '✓' : i + 1}</div>
                          <span>{s}</span>
                          {i < 3 && <div className="bp-sdot-line" />}
                        </div>
                      );
                    })}
                  </div>

                  {/* USDC balance */}
                  {usdcBalance !== undefined && (
                    <div className="bp-bal" style={{ marginBottom: 18 }}>
                      <span className="bp-bal-k">USDC Balance</span>
                      <span className="bp-bal-v">${fmtUsdc(usdcBalance as bigint)}</span>
                    </div>
                  )}

                  {/* Step 1: Protocol */}
                  <div className="bp-slabel" style={{ marginTop: 8 }}>
                    <span className="bp-snum">1</span>Select Active Protocol
                    <button className="bp-refresh" onClick={() => {
                      setProtLoad(true);
                      (async () => {
                        if (!publicClient) { setProtLoad(false); return; }
                        const cached = loadCachedProtocols();
                        const result: Protocol[] = [];
                        for (const cp of cached) {
                          try {
                            const info = await publicClient.readContract({ address: REG_ADDR, abi: RISK_REGISTRY_ABI, functionName: 'getProtocolInfo', args: [cp.address as `0x${string}`] }) as any;
                            if (info.registeredAt !== BigInt(0) && info.active) result.push({ address: cp.address, name: cp.name, riskScore: info.riskScore, audited: info.audited, coverageCap: info.coverageCap, active: true });
                          } catch {}
                        }
                        setProtocols(result); setProtLoad(false);
                      })();
                    }}>↻</button>
                  </div>

                  {protocolsLoading ? (
                    <div className="bp-loading"><span className="bp-spin" style={{ width: 16, height: 16 }} />Fetching active protocols from RiskRegistry…</div>
                  ) : protocols.length === 0 ? (
                    <div className="bp-empty">
                      <div className="bp-empty-t">No active protocols found</div>
                      <div className="bp-empty-s">Register and activate protocols in Governance to appear here.<br />Only <strong>active</strong> (non-halted) protocols are eligible for coverage.</div>
                    </div>
                  ) : (
                    <div className="bp-proto-grid" style={{ marginBottom: 22 }}>
                      {protocols.map(p => (
                        <ProtocolCard key={p.address} p={p} selected={selected?.address === p.address}
                          onSelect={() => { setSelected(p); if (step === 'quote') setStep('form'); }} />
                      ))}
                    </div>
                  )}

                  {/* Step 2: Coverage */}
                  <div className="bp-slabel"><span className="bp-snum">2</span>Coverage Amount</div>
                  <div className="bp-presets" style={{ marginBottom: 0 }}>
                    {COVERAGE_PRESETS.map((c, i) => (
                      <button key={c.label} className={`bp-preset ${presetIdx === i ? 'on' : ''}`} onClick={() => {
                        setPresetIdx(i);
                        if (i === COVERAGE_PRESETS.length - 1) setIsCustom(true);
                        else { setIsCustom(false); setCustomVal(''); setCoverage(c.value); }
                      }}>{c.label}</button>
                    ))}
                  </div>
                  <div className="bp-custom" style={{ marginTop: 8 }}>
                    <div className="bp-custom-pre">$</div>
                    <input className="bp-custom-inp" type="number" min="100" max="1000000"
                      placeholder={isCustom ? 'Enter amount…' : `${fmtUsdc(coverage)} (select Custom to edit)`}
                      value={isCustom ? customVal : ''} readOnly={!isCustom}
                      style={!isCustom ? { cursor: 'default', color: 'rgba(255,255,255,0.3)' } : {}}
                      onChange={e => {
                        setCustomVal(e.target.value);
                        const n = parseFloat(e.target.value);
                        if (!isNaN(n) && n >= 100) setCoverage(BigInt(Math.round(n * 1_000_000)));
                      }} />
                    <div className="bp-custom-suf">USDC</div>
                  </div>
                  <div style={{ fontFamily:"'JetBrains Mono',monospace", fontSize: 9, color: 'rgba(255,255,255,0.25)', marginTop: 5, marginBottom: 22 }}>
                    {isCustom ? 'Min $100 · Max $1,000,000' : `Selected: $${fmtUsdc(coverage)} USDC`}
                  </div>

                  {/* Step 3: Duration */}
                  <div className="bp-slabel"><span className="bp-snum">3</span>Duration</div>
                  <div className="bp-durs" style={{ marginBottom: 26 }}>
                    {DURATION_OPTIONS.map(d => (
                      <button key={d.label} className={`bp-dur ${duration === d.value ? 'on' : ''}`} onClick={() => setDuration(d.value)}>{d.label}</button>
                    ))}
                  </div>

                  {/* Actions */}
                  <div className="bp-actions">
                    {step === 'form' && (
                      <button className="bp-btn bp-btn-white bp-btn-lg" disabled={!selected || coverage === BigInt(0)} onClick={() => { setTxError(null); setStep('quote'); }}>
                        Get Live Quote →
                      </button>
                    )}
                    {step === 'quote' && <>
                      <button className="bp-btn bp-btn-ghost" onClick={() => setStep('form')}>← Edit</button>
                      {needsApproval
                        ? <button className="bp-btn bp-btn-teal bp-btn-lg" disabled={!quotedPremium || approving} onClick={() => {
                            if (!quotedPremium) return;
                            setTxError(null); setStep('approve');
                            writeApprove({ address: USDC_ADDR, abi: ERC20_ABI, functionName: 'approve', args: [ENGINE_ADDR, (quotedPremium as bigint) * BigInt(2)] },
                              { onError: e => { setTxError(e.message.slice(0, 160)); setStep('quote'); } });
                          }}>
                            {approving ? <><span className="bp-spin" />Approving…</> : 'Approve USDC →'}
                          </button>
                        : <button className="bp-btn bp-btn-white bp-btn-lg" disabled={!quotedPremium || buying} onClick={() => {
                            if (!selected) return;
                            setTxError(null); setStep('buy');
                            writeBuy({ address: ENGINE_ADDR, abi: POLICY_ENGINE_ABI, functionName: 'buyPolicy', args: [selected.address as `0x${string}`, coverage, duration], value: BigInt(0) },
                              { onError: e => { setTxError(e.message.slice(0, 160)); setStep('quote'); } });
                          }}>
                            {buying ? <><span className="bp-spin" />Buying…</> : 'Buy Policy · Mint NFT →'}
                          </button>}
                    </>}
                    {(step === 'approve' || step === 'buy') && (
                      <button className="bp-btn bp-btn-teal bp-btn-lg" disabled>
                        <span className="bp-spin" />
                        {step === 'approve' ? (approveWaiting ? 'Confirming approval…' : 'Approving…') : (buyWaiting ? 'Minting NFT…' : 'Submitting…')}
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Right: Quote Panel */}
            <div className="bp-right">
              <div className="bp-quote">
                <div className="bp-qhdr">
                  <div className="bp-qhdr-title">Live Quote</div>
                  <div className="bp-qhdr-sub">On-chain · PremiumMath contract</div>
                </div>
                {!selected ? (
                  <div style={{ padding: '36px 20px', textAlign: 'center' }}>
                    <div style={{ fontFamily:"'Cormorant Garamond',serif", fontSize: 20, fontStyle:'italic', color:'rgba(255,255,255,0.3)', marginBottom: 8 }}>No protocol selected</div>
                    <div style={{ fontFamily:"'JetBrains Mono',monospace", fontSize: 10, color:'rgba(255,255,255,0.2)', lineHeight:1.6 }}>Choose an active protocol above to see a real-time on-chain premium quote.</div>
                  </div>
                ) : (() => {
                  const rm = riskMeta(selected.riskScore);
                  return (
                    <>
                      <div className="bp-qrow"><span className="bp-qk">Protocol</span><span className="bp-qv">{selected.name}</span></div>
                      <div className="bp-qrow"><span className="bp-qk">Address</span><span className="bp-qv" style={{ fontSize: 9 }}>{shortAddr(selected.address)}</span></div>
                      <div className="bp-qrow"><span className="bp-qk">Risk</span><span className="bp-qv" style={{ color: rm.color }}>{selected.riskScore}/100 — {rm.label}</span></div>
                      <div className="bp-qrow"><span className="bp-qk">Audit</span><span className="bp-qv" style={{ color: selected.audited ? 'var(--green)' : 'var(--red)' }}>{selected.audited ? '✓ Verified' : '✗ None'}</span></div>
                      <div className="bp-qrow"><span className="bp-qk">Coverage</span><span className="bp-qv">${fmtUsdc(coverage)} USDC</span></div>
                      <div className="bp-qrow"><span className="bp-qk">Duration</span><span className="bp-qv">{durLabel}</span></div>
                      <div className="bp-qrow"><span className="bp-qk">Expires</span><span className="bp-qv" style={{ fontSize: 9 }}>{fmtDate(BigInt(Math.floor(Date.now() / 1000)) + duration)}</span></div>
                      <div className="bp-premium">
                        <div className="bp-premium-lbl">Premium (one-time)</div>
                        {quoteLoading ? (
                          <div style={{ display:'flex',alignItems:'center',justifyContent:'center',gap:8,padding:'10px 0' }}>
                            <span className="bp-spin" /><span style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:10, color:'rgba(255,255,255,0.4)' }}>Calculating…</span>
                          </div>
                        ) : quotedPremium ? (
                          <>
                            <div className="bp-premium-amt">${fmtUsdc(quotedPremium as bigint)}</div>
                            <div className="bp-premium-sub">USDC · paid at issuance</div>
                          </>
                        ) : <div style={{ color:'rgba(255,255,255,0.3)', fontSize:12, padding:'8px 0' }}>—</div>}
                      </div>
                      {allowance !== undefined && quotedPremium && (
                        <div className="bp-qrow">
                          <span className="bp-qk">Allowance</span>
                          <span className="bp-qv" style={{ color: (allowance as bigint) >= (quotedPremium as bigint) ? 'var(--green)' : 'var(--red)' }}>
                            {(allowance as bigint) >= (quotedPremium as bigint) ? '✓ Sufficient' : '✗ Approval needed'}
                          </span>
                        </div>
                      )}
                      <div className="bp-qnote">Audited protocols get 20% discount. A soulbound PolicyNFT (ERC-5484) is minted to your wallet. Backed by CoveragePool on Aave V3 Sepolia.</div>
                    </>
                  );
                })()}
              </div>
            </div>
          </div>

        ) : (
          /* Policies Tab */
          <div style={{ maxWidth: 1380, margin: '0 auto' }}>
            <div style={{ padding:'18px 26px', borderBottom:'1px solid rgba(0,200,255,0.06)', display:'flex', alignItems:'center', justifyContent:'space-between' }}>
              <div>
                <div style={{ fontFamily:"'Space Grotesk',sans-serif", fontSize:16, fontWeight:700, color:'#fff' }}>My Coverage Policies</div>
                <div style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:10, color:'rgba(255,255,255,0.3)', marginTop:3 }}>{policies.length} total on this wallet</div>
              </div>
              <button className="bp-refresh" onClick={fetchPolicies}>↻ Refresh</button>
            </div>
            {policiesLoading ? (
              <div className="bp-loading" style={{ padding:'36px 26px' }}><span className="bp-spin" style={{ width:16, height:16 }} />Fetching policies from chain…</div>
            ) : policies.length === 0 ? (
              <div style={{ padding:26 }}>
                <div className="bp-empty">
                  <div className="bp-empty-t">No policies yet</div>
                  <div className="bp-empty-s">Buy your first coverage policy to protect your DeFi positions.<br />Policies appear here after purchase.</div>
                </div>
              </div>
            ) : policies.map(p => {
              const statusMap: Record<number,{label:string;color:string}> = {
                0:{ label:'ACTIVE',    color:'var(--green)' },
                1:{ label:'EXPIRED',   color:'rgba(255,255,255,0.3)' },
                2:{ label:'CLAIMED',   color:'var(--blue)' },
                3:{ label:'CANCELLED', color:'var(--red)' },
              };
              const st = statusMap[p.status] ?? { label:'UNKNOWN', color:'rgba(255,255,255,0.3)' };
              const exp = BigInt(Math.floor(Date.now() / 1000)) > p.expiresAt;
              const disp = exp && p.status === 0 ? { label:'EXPIRED', color:'rgba(255,255,255,0.3)' } : st;
              return (
                <div key={p.id} className="bp-policy">
                  <div className="bp-policy-top">
                    <span className="bp-policy-id">Policy #{p.id}</span>
                    <span className="bp-pill" style={{ color:disp.color, borderColor:`${disp.color}44` }}>{disp.label}</span>
                  </div>
                  <div className="bp-pmeta">
                    <div className="bp-pmi"><span className="bp-pmi-k">Protocol</span><span className="bp-pmi-v">{shortAddr(p.protocol)}</span></div>
                    <div className="bp-pmi"><span className="bp-pmi-k">Coverage</span><span className="bp-pmi-v">${fmtUsdc(p.coverageAmount)}</span></div>
                    <div className="bp-pmi"><span className="bp-pmi-k">Premium</span><span className="bp-pmi-v">${fmtUsdc(p.premium)}</span></div>
                    <div className="bp-pmi"><span className="bp-pmi-k">Expires</span><span className="bp-pmi-v" style={{ color: exp ? 'var(--red)' : undefined }}>{fmtDate(p.expiresAt)}</span></div>
                    <div className="bp-pmi"><span className="bp-pmi-k">NFT</span><span className="bp-pmi-v"><a href={`https://sepolia.etherscan.io/token/${SENTINEL_ADDRESSES.POLICY_NFT}?a=${p.id}`} target="_blank" rel="noreferrer" style={{ color:'var(--teal)', textDecoration:'none' }}>#{p.id} ↗</a></span></div>
                  </div>
                  {p.status === 0 && !exp && (
                    <div style={{ marginTop: 12 }}>
                      <Link href={`/claims?policyId=${p.id}`} style={{ padding:'5px 14px', border:'1px solid rgba(255,0,60,0.3)', color:'var(--red)', textDecoration:'none', fontFamily:"'JetBrains Mono',monospace", fontSize:9, fontWeight:700, letterSpacing:'0.1em', textTransform:'uppercase', display:'inline-flex', borderRadius:6 }}>
                        File Claim →
                      </Link>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}
