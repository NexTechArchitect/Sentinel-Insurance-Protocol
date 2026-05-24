'use client';

import React, { useEffect, useState, useCallback, useRef } from 'react';
import * as THREE from 'three';
import {
  useAccount,
  useReadContract,
  useWriteContract,
  useWaitForTransactionReceipt,
  usePublicClient,
} from 'wagmi';
import { SENTINEL_ADDRESSES } from '@/constants/contracts';

const ADMIN_ADDRESS = '0x023C6911C69b6C0E70a76C27b23fE1a32b08bf98';
const CACHE_KEY = 'sentinelshield:protocols_v9';
const CACHE_KEY_GUARDIANS = 'sentinelshield:guardians_v9';

// ─── ABIs ────────────────────────────────────────────────────────────────────
const RISK_REGISTRY_ABI = [
  { name: 'registerProtocol',    type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'protocol', type: 'address' }, { name: 'name', type: 'string' }, { name: 'riskScore', type: 'uint8' }, { name: 'audited', type: 'bool' }, { name: 'coverageCap', type: 'uint256' }], outputs: [] },
  { name: 'updateRiskScore',     type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'protocol', type: 'address' }, { name: 'newScore', type: 'uint8' }], outputs: [] },
  { name: 'blacklistProtocol',   type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'protocol', type: 'address' }], outputs: [] },
  { name: 'unblacklistProtocol', type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'protocol', type: 'address' }], outputs: [] },
  { name: 'getProtocolInfo',     type: 'function', stateMutability: 'view',       inputs: [{ name: 'protocol', type: 'address' }], outputs: [{ type: 'tuple', components: [{ name: 'riskScore', type: 'uint8' }, { name: 'audited', type: 'bool' }, { name: 'active', type: 'bool' }, { name: 'coverageCap', type: 'uint256' }, { name: 'registeredAt', type: 'uint256' }] }] },
] as const;

const VETO_COUNCIL_ABI = [
  { name: 'addGuardian',        type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'guardian', type: 'address' }], outputs: [] },
  { name: 'removeGuardian',     type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'guardian', type: 'address' }], outputs: [] },
  { name: 'setThreshold',       type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'newThreshold', type: 'uint256' }], outputs: [] },
  { name: 'signVeto',           type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'claimId', type: 'uint256' }, { name: 'reason', type: 'string' }], outputs: [] },
  { name: 's_threshold',        type: 'function', stateMutability: 'view',       inputs: [], outputs: [{ type: 'uint256' }] },
  { name: 'isGuardian',         type: 'function', stateMutability: 'view',       inputs: [{ name: 'addr', type: 'address' }], outputs: [{ type: 'bool' }] },
  { name: 'guardianCount',      type: 'function', stateMutability: 'view',       inputs: [], outputs: [{ type: 'uint256' }] },
] as const;

const CLAIMS_GOVERNOR_ABI = [
  { name: 'getClaim',        type: 'function', stateMutability: 'view',       inputs: [{ name: 'claimId', type: 'uint256' }], outputs: [{ type: 'tuple', components: [{ name: 'policyId', type: 'uint256' }, { name: 'claimant', type: 'address' }, { name: 'protocol', type: 'address' }, { name: 'evidenceUri', type: 'string' }, { name: 'snapshotBlock', type: 'uint256' }, { name: 'votingEndsAt', type: 'uint256' }, { name: 'yesVotes', type: 'uint256' }, { name: 'noVotes', type: 'uint256' }, { name: 'status', type: 'uint8' }] }] },
  { name: 'totalClaims',     type: 'function', stateMutability: 'view',       inputs: [], outputs: [{ type: 'uint256' }] },
  { name: 'castVote',        type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'claimId', type: 'uint256' }, { name: 'support', type: 'bool' }], outputs: [] },
  { name: 'finalizeClaim',   type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'claimId', type: 'uint256' }], outputs: [] },
  { name: 's_votingPeriod',  type: 'function', stateMutability: 'view',       inputs: [], outputs: [{ type: 'uint256' }] },
  { name: 'setVotingPeriod', type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'newPeriod', type: 'uint256' }], outputs: [] },
] as const;

const SHIELD_TOKEN_ABI = [
  { name: 'balanceOf',   type: 'function', stateMutability: 'view', inputs: [{ name: 'account', type: 'address' }], outputs: [{ type: 'uint256' }] },
  { name: 'getVotes',    type: 'function', stateMutability: 'view', inputs: [{ name: 'account', type: 'address' }], outputs: [{ type: 'uint256' }] },
  { name: 'delegate',    type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'delegatee', type: 'address' }], outputs: [] },
  { name: 'totalSupply', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
] as const;

const REG_ADDR    = SENTINEL_ADDRESSES.RISK_REGISTRY   as `0x${string}`;
const VETO_ADDR   = SENTINEL_ADDRESSES.VETO_COUNCIL    as `0x${string}`;
const GOV_ADDR    = SENTINEL_ADDRESSES.CLAIMS_GOVERNOR as `0x${string}`;
const SHIELD_ADDR = SENTINEL_ADDRESSES.SHIELD_TOKEN    as `0x${string}`;

// ─── Types ────────────────────────────────────────────────────────────────────
interface ProtocolEntry { address: string; name: string; riskScore: number; audited: boolean; active: boolean; coverageCap: bigint; registeredAt: bigint; }
interface CachedProtocol { address: string; name: string; }
interface ClaimEntry { id: number; policyId: bigint; claimant: string; protocol: string; evidenceUri: string; votingEndsAt: bigint; yesVotes: bigint; noVotes: bigint; status: number; }
type GovTab = 'protocols' | 'claims' | 'veto' | 'shield';
type TxMeta = { type: 'register'; address: string; name: string } | { type: 'halt'; address: string } | { type: 'reactivate'; address: string; name: string } | { type: 'update_score'; address: string } | { type: 'guardian_add'; address: string } | { type: 'guardian_remove'; address: string } | { type: 'claim' | 'shield' | 'other' };

// ─── Cache helpers (WITH SEED LIST) ───────────────────────────────────────────
const SEED_PROTOCOLS: CachedProtocol[] = [
  { address: '0x6Ae43d3271ff6888e7Fc43Fd7321a503ff738951', name: 'Aave V3' },
  { address: '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D', name: 'Uniswap V2 Pool' },
  { address: '0x3fC91A3afd70395Cd496C647d5a6CC9D4B2b7FAD', name: 'MemeFarm Protocol' },
  { address: '0x11111111254363B1a38403422974F1AE25723590', name: 'Beefy Finance Optimizer' },
  { address: '0xE592427A0AEce92De3Edee1F18E0157C05861564', name: 'Uniswap V3' }
];

function loadCache(): CachedProtocol[] { 
  try { 
    const r = localStorage.getItem(CACHE_KEY); 
    const cached = r ? JSON.parse(r) : []; 
    const m = new Map(SEED_PROTOCOLS.map(p => [p.address.toLowerCase(), p])); 
    for (const p of cached) m.set(p.address.toLowerCase(), p); 
    const merged = Array.from(m.values());
    localStorage.setItem(CACHE_KEY, JSON.stringify(merged));
    return merged;
  } catch { 
    return SEED_PROTOCOLS; 
  } 
}
function saveCache(list: CachedProtocol[]) { try { localStorage.setItem(CACHE_KEY, JSON.stringify(list)); } catch {} }
function mergeCache(existing: CachedProtocol[], newOnes: CachedProtocol[]): CachedProtocol[] { const m = new Map(existing.map(p => [p.address.toLowerCase(), p])); for (const p of newOnes) m.set(p.address.toLowerCase(), p); return Array.from(m.values()); }
function loadGuardians(): string[] { try { const r = localStorage.getItem(CACHE_KEY_GUARDIANS); return r ? JSON.parse(r) : []; } catch { return []; } }
function saveGuardians(list: string[]) { try { localStorage.setItem(CACHE_KEY_GUARDIANS, JSON.stringify(list)); } catch {} }

// ─── Helpers ─────────────────────────────────────────────────────────────────
const sleep     = (ms: number) => new Promise(r => setTimeout(r, ms));
const shortAddr = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const fmtUsdc   = (v: bigint) => { const n = Number(v)/1e6; if(n>=1e6) return `$${(n/1e6).toFixed(2)}M`; if(n>=1e3) return `$${(n/1e3).toFixed(1)}K`; return `$${n.toFixed(2)}`; };
const fmtShield = (v: bigint) => { const n = Number(v)/1e18; if(n>=1e6) return `${(n/1e6).toFixed(2)}M`; if(n>=1e3) return `${(n/1e3).toFixed(1)}K`; return n.toFixed(2); };
const timeLeft  = (ts: bigint) => { const d=Number(ts)-Math.floor(Date.now()/1e3); if(d<=0) return 'Ended'; const h=Math.floor(d/3600),m=Math.floor((d%3600)/60); if(d>=86400) return `${Math.floor(d/86400)}d ${h%24}h`; if(h>0) return `${h}h ${m}m`; return `${m}m`; };
const claimStatus = (s: number) => ({0:{l:'PENDING',c:'var(--c-gold)'},1:{l:'APPROVED',c:'var(--c-emerald)'},2:{l:'REJECTED',c:'var(--c-ruby)'},3:{l:'VETOED',c:'#888'},4:{l:'EXECUTED',c:'#00FFFF'}}[s] ?? {l:'UNKNOWN',c:'#888'});
const riskMeta  = (s: number) => s<=30?{l:'LOW',c:'var(--c-emerald)'}:s<=60?{l:'MED',c:'var(--c-gold)'}:{l:'HIGH',c:'var(--c-ruby)'};
const isAlreadyRegistered = (msg: string) => msg.toLowerCase().includes('alreadyregistered') || msg.includes('0x9eb4cee7');

// ─── Direct chain read (no event scanning) ───────────────────────────────────
async function readOnChain(
  client: NonNullable<ReturnType<typeof usePublicClient>>,
  addr: string,
  name: string,
  maxRetries = 4,
  delayMs = 2500,
): Promise<ProtocolEntry | null> {
  for (let i = 0; i < maxRetries; i++) {
    try {
      const info = await client.readContract({
        address: REG_ADDR, abi: RISK_REGISTRY_ABI, functionName: 'getProtocolInfo',
        args: [addr as `0x${string}`],
      }) as { riskScore: number; audited: boolean; active: boolean; coverageCap: bigint; registeredAt: bigint };
      if (info.registeredAt !== 0n) return { address: addr, name, ...info };
    } catch {}
    if (i < maxRetries - 1) await sleep(delayMs);
  }
  return null;
}

// ─── Poll until confirmed ─────────────────────────────────────────────────────
async function pollChain(
  client: NonNullable<ReturnType<typeof usePublicClient>>,
  addr: string, name: string,
  onFound: (e: ProtocolEntry) => void,
  onStatus: (msg: string) => void,
  sig: { cancelled: boolean },
) {
  for (let i = 0; i < 20; i++) {
    if (sig.cancelled) return;
    onStatus(`⏳ Confirming on-chain... (${i+1}/20)`);
    const e = await readOnChain(client, addr, name, 1, 0);
    if (e) { onFound(e); onStatus('✓ Confirmed on-chain!'); setTimeout(() => onStatus(''), 3000); return; }
    await sleep(2500);
  }
  onStatus('⚠ Timeout — use Recover Protocol below to reload.'); setTimeout(() => onStatus(''), 6000);
}

// ─── 3D Background ────────────────────────────────────────────────────────────
function CinematicScene() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!ref.current) return;
    const mount = ref.current;
    const R = new THREE.WebGLRenderer({ antialias:true, alpha:true, powerPreference:'high-performance' });
    R.setClearColor(0,0); R.setPixelRatio(Math.min(devicePixelRatio,2)); R.setSize(innerWidth,innerHeight);
    R.toneMapping=THREE.ReinhardToneMapping; R.toneMappingExposure=1.8;
    mount.appendChild(R.domElement);
    const scene=new THREE.Scene(); scene.fog=new THREE.FogExp2(0,0.0007);
    const cam=new THREE.PerspectiveCamera(45,innerWidth/innerHeight,0.1,5000); cam.position.set(0,50,800);
    scene.add(new THREE.AmbientLight(0x1a0500,2));
    const fl=new THREE.PointLight(0xFF003C,10,1200); fl.position.set(-100,50,100); scene.add(fl);
    const gl=new THREE.PointLight(0xFFD700,8,1000); gl.position.set(100,-50,100); scene.add(gl);
    const root=new THREE.Group(); scene.add(root);
    const g=new THREE.BufferGeometry(), pos=new Float32Array(4000*3), col=new Float32Array(4000*3);
    for(let i=0;i<4000;i++){pos[i*3]=(Math.random()-.5)*4000;pos[i*3+1]=(Math.random()-.5)*4000;pos[i*3+2]=-500-Math.random()*2000;const c=Math.random()>.5?new THREE.Color('#FF003C'):new THREE.Color('#FFD700');col[i*3]=c.r;col[i*3+1]=c.g;col[i*3+2]=c.b;}
    g.setAttribute('position',new THREE.BufferAttribute(pos,3)); g.setAttribute('color',new THREE.BufferAttribute(col,3));
    const stars=new THREE.Points(g,new THREE.PointsMaterial({size:2,vertexColors:true,transparent:true,opacity:.6,blending:THREE.AdditiveBlending})); scene.add(stars);
    const orbs:THREE.Mesh[]=[];
    for(let i=0;i<5;i++){const o=new THREE.Mesh(new THREE.SphereGeometry(15,32,32),new THREE.MeshStandardMaterial({color:0xFFD700,emissive:0xFF5E00,emissiveIntensity:.8,roughness:.1}));const a=(i/5)*Math.PI*2;o.position.set(Math.cos(a)*300,Math.sin(a*2)*50,Math.sin(a)*300);root.add(o);orbs.push(o);}
    const mouse={x:0,y:0,tx:0,ty:0};
    const mm=(e:MouseEvent)=>{mouse.tx=(e.clientX/innerWidth)*2-1;mouse.ty=-(e.clientY/innerHeight)*2+1;};
    window.addEventListener('mousemove',mm,{passive:true});
    const onR=()=>{R.setPixelRatio(Math.min(devicePixelRatio,2));R.setSize(innerWidth,innerHeight);cam.aspect=innerWidth/innerHeight;cam.updateProjectionMatrix();};
    window.addEventListener('resize',onR,{passive:true});
    let raf=0,prev=performance.now(),el=0;
    const animate=()=>{const now=performance.now();el+=(now-prev)/1000;prev=now;mouse.x+=(mouse.tx-mouse.x)*.05;mouse.y+=(mouse.ty-mouse.y)*.05;cam.position.x+=(mouse.x*-100-cam.position.x)*.02;cam.position.y+=(mouse.y*-60-cam.position.y)*.02;cam.lookAt(0,0,0);root.rotation.y=el*.05;stars.rotation.y=el*.01;orbs.forEach((o,i)=>{o.position.y+=Math.sin(el*2+i)*.5;});R.render(scene,cam);raf=requestAnimationFrame(animate);};
    animate();
    return ()=>{cancelAnimationFrame(raf);window.removeEventListener('mousemove',mm);window.removeEventListener('resize',onR);if(mount.contains(R.domElement))mount.removeChild(R.domElement);R.dispose();};
  },[]);
  return <div className="fixed inset-0 z-0 pointer-events-none" ref={ref} aria-hidden/>;
}

// ─── Main ─────────────────────────────────────────────────────────────────────
export default function GovernancePage() {
  const { address } = useAccount();
  const publicClient = usePublicClient();
  const [mounted, setMounted] = useState(false);
  const [tab, setTab] = useState<GovTab>('protocols');
  const isAdmin = address?.toLowerCase() === ADMIN_ADDRESS.toLowerCase();

  const [protocols,  setProtocols]  = useState<ProtocolEntry[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [claims,     setClaims]     = useState<ClaimEntry[]>([]);
  const [claimsLoad, setClaimsLoad] = useState(true);
  const [guardians,  setGuardians]  = useState<string[]>([]);
  const [status,     setStatus]     = useState('');

  // Forms
  const [regAddr,    setRegAddr]    = useState('');
  const [regName,    setRegName]    = useState('');
  const [regRisk,    setRegRisk]    = useState('15');
  const [regAudited, setRegAudited] = useState(true);
  const [regCap,     setRegCap]     = useState('1000000');

  const [recAddr,  setRecAddr]  = useState('');
  const [recName,  setRecName]  = useState('');
  const [recBusy,  setRecBusy]  = useState(false);
  const [recErr,   setRecErr]   = useState('');
  const [recOk,    setRecOk]    = useState('');

  const [updAddr,  setUpdAddr]  = useState('');
  const [updScore, setUpdScore] = useState('');
  const [grdAddr,  setGrdAddr]  = useState('');
  const [vetoId,   setVetoId]   = useState('');
  const [vetoR,    setVetoR]    = useState('');
  const [thresh,   setThresh]   = useState('');
  const [vperiod,  setVperiod]  = useState('');
  const [delTo,    setDelTo]    = useState('');

  const pollSig = useRef<{cancelled:boolean}>({cancelled:false});
  const pendingMeta = useRef<TxMeta|null>(null);

  const { data: threshold }    = useReadContract({ address:VETO_ADDR,   abi:VETO_COUNCIL_ABI,    functionName:'s_threshold' });
  const { data: votPeriod }    = useReadContract({ address:GOV_ADDR,    abi:CLAIMS_GOVERNOR_ABI, functionName:'s_votingPeriod' });
  const { data: shieldBal }    = useReadContract({ address:SHIELD_ADDR, abi:SHIELD_TOKEN_ABI,    functionName:'balanceOf',  args:address?[address as `0x${string}`]:undefined, query:{enabled:!!address} });
  const { data: shieldVotes }  = useReadContract({ address:SHIELD_ADDR, abi:SHIELD_TOKEN_ABI,    functionName:'getVotes',   args:address?[address as `0x${string}`]:undefined, query:{enabled:!!address} });
  const { data: isGuardian }   = useReadContract({ address:VETO_ADDR,   abi:VETO_COUNCIL_ABI,    functionName:'isGuardian', args:address?[address as `0x${string}`]:undefined, query:{enabled:!!address} });

  const { writeContract, isPending, data: txHash, reset: resetWrite } = useWriteContract();
  const { isLoading: txWait, isSuccess: txOk } = useWaitForTransactionReceipt({ hash: txHash });
  const [txLabel, setTxLabel] = useState('');
  const [txErr,   setTxErr]   = useState<string|null>(null);

  useEffect(() => { setMounted(true); }, []);

  // ─── On mount: hydrate from cache ─────────────────────────────────────────
  useEffect(() => {
    if (!publicClient) return;
    const cached = loadCache();
    if (cached.length === 0) { setLoading(false); return; }
    setStatus('Loading saved protocols...');
    (async () => {
      const entries: ProtocolEntry[] = [];
      for (const cp of cached) {
        const e = await readOnChain(publicClient, cp.address, cp.name, 3, 2000);
        if (e) entries.push(e);
      }
      setProtocols(entries);
      setLoading(false);
      setStatus('');
    })();
  }, [publicClient]);

  // ─── Fetch claims & guardians ─────────────────────────────────────────────
  useEffect(() => {
    if (publicClient) { fetchClaims(); setGuardians(loadGuardians()); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [publicClient]);

  const fetchClaims = useCallback(async () => {
    if (!publicClient) return;
    setClaimsLoad(true);
    try {
      const total = await publicClient.readContract({ address:GOV_ADDR, abi:CLAIMS_GOVERNOR_ABI, functionName:'totalClaims' }) as bigint;
      const list: ClaimEntry[] = [];
      for (let i=BigInt(1); i<=total; i++) {
        try { const c=await publicClient.readContract({address:GOV_ADDR,abi:CLAIMS_GOVERNOR_ABI,functionName:'getClaim',args:[i]}) as any; list.push({id:Number(i),...c}); } catch {}
      }
      setClaims(list.reverse());
    } catch {} finally { setClaimsLoad(false); }
  }, [publicClient]);

  // ─── TX success ───────────────────────────────────────────────────────────
  useEffect(() => {
    if (!txOk || !publicClient) return;
    setTxErr(null);
    const meta = pendingMeta.current;
    if (!meta) return;
    pendingMeta.current = null;

    pollSig.current.cancelled = true;
    const sig = { cancelled: false };
    pollSig.current = sig;

    (async () => {
      if (meta.type === 'register') {
        upsertProtocol({
          address: meta.address, name: meta.name,
          riskScore: parseInt(regRisk)||15, audited: regAudited, active: true,
          coverageCap: BigInt(Math.round(parseFloat(regCap||'0')*1_000_000)),
          registeredAt: BigInt(Math.floor(Date.now()/1000)),
        });
        saveCache(mergeCache(loadCache(), [{address:meta.address,name:meta.name}]));
        setRegAddr(''); setRegName('');
        await pollChain(publicClient, meta.address, meta.name, upsertProtocol, setStatus, sig);
      }
      else if (meta.type === 'halt') {
        setProtocols(p=>p.map(x=>x.address.toLowerCase()===meta.address.toLowerCase()?{...x,active:false}:x));
        // Force sync from chain slightly delayed to ensure state updates
        setTimeout(async () => {
          const cp=loadCache().find(c=>c.address.toLowerCase()===meta.address.toLowerCase());
          if(cp){const e=await readOnChain(publicClient,cp.address,cp.name,3,2000);if(e)upsertProtocol(e);}
        }, 3000);
      }
      else if (meta.type === 'reactivate') {
        setProtocols(p=>p.map(x=>x.address.toLowerCase()===meta.address.toLowerCase()?{...x,active:true}:x));
        setTimeout(async () => {
          const cp=loadCache().find(c=>c.address.toLowerCase()===meta.address.toLowerCase());
          if(cp){const e=await readOnChain(publicClient,cp.address,cp.name,3,2000);if(e)upsertProtocol(e);}
        }, 3000);
      }
      else if (meta.type === 'update_score') {
        setStatus('Refreshing...'); await sleep(3000);
        const cp=loadCache().find(c=>c.address.toLowerCase()===meta.address.toLowerCase());
        if(cp){const e=await readOnChain(publicClient,cp.address,cp.name,5,2000);if(e)upsertProtocol(e);}
        setStatus('');
      }
      else if (meta.type === 'guardian_add') {
        const g=mergeCache(loadGuardians().map(x=>({address:x,name:''})),[{address:meta.address,name:''}]).map(x=>x.address);
        saveGuardians(g); setGuardians(g);
      }
      else if (meta.type === 'guardian_remove') {
        const g=loadGuardians().filter(x=>x.toLowerCase()!==meta.address.toLowerCase());
        saveGuardians(g); setGuardians(g);
      }
      else if (meta.type==='claim'||meta.type==='other') { fetchClaims(); }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [txOk]);

  const upsertProtocol = (entry: ProtocolEntry) => {
    setProtocols(prev => {
      const m = new Map(prev.map(p=>[p.address.toLowerCase(),p]));
      m.set(entry.address.toLowerCase(), entry);
      return Array.from(m.values());
    });
  };

  // ─── Full sync ────────────────────────────────────────────────────────────
  const fullSync = useCallback(async () => {
    if (!publicClient) return;
    setLoading(true); setStatus('Syncing from chain...');
    const entries: ProtocolEntry[] = [];
    for (const cp of loadCache()) {
      const e=await readOnChain(publicClient,cp.address,cp.name,3,2000);
      if(e) entries.push(e);
    }
    setProtocols(entries); setLoading(false); setStatus('');
  }, [publicClient]);

  // ─── Recover ──────────────────────────────────────────────────────────────
  const recover = useCallback(async () => {
    if (!publicClient || !recAddr || !recName) return;
    setRecBusy(true); setRecErr(''); setRecOk('');
    setStatus('Reading from chain...');
    const e = await readOnChain(publicClient, recAddr.trim(), recName.trim(), 8, 2500);
    if (e) {
      saveCache(mergeCache(loadCache(),[{address:e.address,name:e.name}]));
      upsertProtocol(e);
      setRecOk(`✓ "${e.name}" loaded successfully!`);
      setStatus(''); setRecAddr(''); setRecName('');
      setTimeout(()=>setRecOk(''), 5000);
    } else {
      setRecErr('Not found on-chain. Verify the address and try again.');
      setStatus('');
    }
    setRecBusy(false);
  }, [publicClient, recAddr, recName]);

  // ─── Write wrapper ────────────────────────────────────────────────────────
  const write = (label: string, args: Parameters<typeof writeContract>[0], meta: TxMeta) => {
    setTxLabel(label); setTxErr(null); resetWrite();
    pendingMeta.current = meta;
    writeContract(args, {
      onError: (e) => {
        const msg = e.message;
        if (isAlreadyRegistered(msg) && meta.type === 'register') {
          pendingMeta.current = null;
          setStatus('⚠ Already registered — loading from chain...');
          const addr = meta.address, name = meta.name;
          if (publicClient) {
            readOnChain(publicClient, addr, name, 8, 2500).then(e => {
              if (e) {
                saveCache(mergeCache(loadCache(), [{address:addr,name}]));
                upsertProtocol(e);
                setStatus(`✓ "${name}" already on-chain — now visible!`);
                setTimeout(()=>setStatus(''), 4000);
                setRegAddr(''); setRegName('');
              } else {
                setStatus('Could not load. Use Recover Protocol below.');
                setTxErr(`"${name}" is already registered. Use Recover Protocol to display it.`);
                setTimeout(()=>setTxErr(null),8000);
                setRecAddr(addr); setRecName(name);
              }
            });
          }
          return;
        }
        pendingMeta.current = null;
        // Clean error display logic
        const clean = msg.includes('User rejected') ? 'Transaction rejected by user.' : msg.split('\n')[0].slice(0,200);
        setTxErr(clean);
        // Auto hide after 4.5 seconds
        setTimeout(()=>setTxErr(null), 4500);
      }
    });
  };

  const busy = isPending || txWait;
  if (!mounted) return <main suppressHydrationWarning style={{minHeight:'100vh',background:'#000'}}/>;

  const active  = protocols.filter(p=>p.active);
  const halted  = protocols.filter(p=>!p.active);

  // ─── Styles ───────────────────────────────────────────────────────────────
  return (
    <>
      <style>{`
        :root{--c-gold:#FFD700;--c-ruby:#FF003C;--c-emerald:#00FF66;--c-panel:rgba(10,5,0,0.65);--c-border:rgba(255,215,0,0.15);}
        body{background:#000;color:#fff;margin:0;font-family:'Inter',sans-serif;overflow-x:hidden;}
        body::after{content:"";position:fixed;inset:0;background-image:url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");opacity:.05;pointer-events:none;z-index:9999;}
        .pg{position:relative;z-index:10;min-height:calc(100vh - 80px);padding:100px 4vw 60px;max-width:1400px;margin:0 auto;}
        .h1{font-family:'Cormorant Garamond',serif;font-size:clamp(45px,5vw,75px);font-style:italic;font-weight:700;margin:0 0 10px;text-align:center;background:linear-gradient(180deg,#fff 0%,var(--c-gold) 100%);-webkit-background-clip:text;-webkit-text-fill-color:transparent;}
        .hsub{font-family:'JetBrains Mono',monospace;font-size:11px;color:rgba(255,255,255,.6);letter-spacing:.2em;text-transform:uppercase;text-align:center;margin-bottom:50px;}
        .statusbar{text-align:center;font-family:'JetBrains Mono',monospace;font-size:12px;color:var(--c-gold);margin-bottom:16px;padding:10px 20px;background:rgba(255,215,0,.06);border:1px solid rgba(255,215,0,.2);border-radius:10px;display:flex;align-items:center;justify-content:center;gap:8px;}
        .tabs{display:flex;gap:15px;margin-bottom:40px;justify-content:center;flex-wrap:wrap;}
        .tb{padding:14px 35px;border:1px solid rgba(255,255,255,.05);background:rgba(0,0,0,.4);color:rgba(255,255,255,.4);border-radius:12px;font-family:'JetBrains Mono',monospace;font-size:12px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;cursor:pointer;transition:all .3s;backdrop-filter:blur(10px);}
        .tb:hover{color:#fff;border-color:rgba(255,255,255,.2);}
        .tb.on{background:rgba(255,215,0,.1);color:var(--c-gold);box-shadow:0 0 20px rgba(255,215,0,.15);border:1px solid rgba(255,215,0,.3);}
        .gp{background:var(--c-panel);border:1px solid var(--c-border);border-radius:24px;padding:40px;backdrop-filter:blur(40px);box-shadow:0 30px 60px rgba(0,0,0,.9),inset 0 1px 0 rgba(255,255,255,.05);margin-bottom:30px;}
        .gp h3{font-family:'Cormorant Garamond',serif;font-size:32px;font-style:italic;color:var(--c-gold);margin:0 0 20px;}
        .ig{margin-bottom:25px;}
        .il{display:flex;justify-content:space-between;margin-bottom:12px;font-family:'JetBrains Mono',monospace;font-size:11px;color:rgba(255,255,255,.5);text-transform:uppercase;letter-spacing:.1em;}
        .ci{width:100%;background:rgba(0,0,0,.6);border:1px solid rgba(255,255,255,.08);color:#fff;font-family:'JetBrains Mono',monospace;font-size:16px;padding:18px 20px;border-radius:12px;transition:all .3s;outline:none;box-sizing:border-box;}
        .ci:focus{border-color:var(--c-gold);box-shadow:0 0 20px rgba(255,215,0,.15);}
        .cb{display:flex;align-items:center;gap:10px;margin-bottom:25px;}
        .btn{width:100%;padding:20px;border:none;border-radius:12px;font-family:'JetBrains Mono',monospace;font-size:14px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;background:linear-gradient(90deg,#FF5E00,#FF003C);color:#fff;cursor:pointer;transition:all .3s;box-shadow:0 10px 30px rgba(255,0,60,.4);}
        .btn:hover:not(:disabled){transform:translateY(-3px);box-shadow:0 15px 40px rgba(255,94,0,.6);}
        .btn:disabled{background:rgba(255,255,255,.05);color:rgba(255,255,255,.2);cursor:not-allowed;box-shadow:none;}
        .sm{padding:10px 20px;font-size:10px;border-radius:8px;width:auto;min-width:90px;}
        .gr{background:rgba(0,255,102,.1);color:var(--c-emerald);border:1px solid var(--c-emerald);box-shadow:none;}
        .rd{background:rgba(255,0,60,.1);color:var(--c-ruby);border:1px solid var(--c-ruby);box-shadow:none;}
        .gd{background:rgba(255,215,0,.1);color:var(--c-gold);border:1px solid var(--c-gold);box-shadow:none;}
        .lr{display:flex;justify-content:space-between;align-items:center;padding:20px 0;border-bottom:1px solid rgba(255,255,255,.05);}
        .lr:last-child{border-bottom:none;padding-bottom:0;}
        .lt{font-family:'JetBrains Mono',monospace;font-size:15px;font-weight:700;color:#fff;margin-bottom:6px;}
        .ls{font-size:11px;color:rgba(255,255,255,.45);}
        .sp{display:inline-block;width:13px;height:13px;border-radius:50%;border:2px solid rgba(255,255,255,.1);border-top-color:var(--c-gold);animation:spin .8s linear infinite;flex-shrink:0;}
        @keyframes spin{to{transform:rotate(360deg);}}
        .bn{padding:15px 20px;border-radius:12px;font-family:'JetBrains Mono',monospace;font-size:12px;display:flex;align-items:center;gap:10px;margin-bottom:20px;}
        .bi{background:rgba(255,215,0,.1);color:var(--c-gold);border:1px solid rgba(255,215,0,.3);}
        .be{background:rgba(255,0,60,.1);color:var(--c-ruby);border:1px solid rgba(255,0,60,.3);}
        .bs{background:rgba(0,255,102,.1);color:var(--c-emerald);border:1px solid rgba(0,255,102,.3);}
        .rbox{margin-top:28px;padding:24px;border:1px dashed rgba(255,215,0,.25);border-radius:16px;background:rgba(255,215,0,.02);}
        .rbox h4{font-family:'Cormorant Garamond',serif;font-size:22px;font-style:italic;color:rgba(255,215,0,.8);margin:0 0 6px;}
        .rbox p{font-size:11px;color:rgba(255,255,255,.4);margin:0 0 18px;font-family:'JetBrains Mono',monospace;line-height:1.6;}
        .empty{padding:40px;text-align:center;color:rgba(255,255,255,.35);border:1px dashed rgba(255,255,255,.1);border-radius:16px;line-height:2;}
        .proto{animation:slideIn .35s ease;}
        @keyframes slideIn{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}
        .tag{font-size:10px;padding:3px 8px;border-radius:4px;background:rgba(255,255,255,.08);}
      `}</style>

      <CinematicScene />

      <div className="pg">
        <h1 className="h1">Governance Engine</h1>
        <div className="hsub">Protocol Command &amp; Adjudication</div>

        {isAdmin   && <div className="bn bi" style={{justifyContent:'center'}}>⚡ ADMIN WALLET DETECTED ⚡</div>}
        {isGuardian && !isAdmin && <div className="bn bi" style={{justifyContent:'center',borderColor:'var(--c-emerald)',color:'var(--c-emerald)',background:'rgba(0,255,102,.1)'}}>🛡 VETO GUARDIAN</div>}
        {txOk      && <div className="bn bs" style={{justifyContent:'center'}}>✓ Transaction confirmed on-chain.</div>}
        {busy      && <div className="bn bi"><span className="sp"/>  {txLabel}... waiting for block</div>}
        {txErr     && <div className="bn be">⚠ {txErr}</div>}
        {status    && <div className="statusbar"><span className="sp"/> {status}</div>}

        <div className="tabs">
          {(['protocols','claims','veto','shield'] as GovTab[]).map(t=>(
            <button key={t} className={`tb ${tab===t?'on':''}`} onClick={()=>setTab(t)}>
              {t==='protocols'?'Registry':t==='claims'?'Claims':t==='veto'?'Veto Council':'SHIELD Token'}
            </button>
          ))}
        </div>

        {/* ═══ PROTOCOLS ═══ */}
        {tab==='protocols' && (
          <div style={{display:'grid',gridTemplateColumns:isAdmin?'1fr 1fr':'1fr',gap:'30px'}}>

            {isAdmin && (
              <div className="gp">
                <h3>Register Protocol</h3>
                <p style={{color:'rgba(255,255,255,.5)',fontSize:'13px',marginBottom:'20px'}}>
                  Inject a new DeFi protocol into the RiskRegistry.
                </p>

                <div className="ig"><div className="il"><span>Protocol Address</span></div>
                  <input className="ci" placeholder="0x..." value={regAddr} onChange={e=>setRegAddr(e.target.value)} disabled={busy}/>
                </div>
                <div className="ig"><div className="il"><span>Name</span></div>
                  <input className="ci" placeholder="e.g. Aave V3" value={regName} onChange={e=>setRegName(e.target.value)} disabled={busy}/>
                </div>
                <div style={{display:'flex',gap:'20px'}}>
                  <div className="ig" style={{flex:1}}><div className="il"><span>Risk Score (0-100)</span></div>
                    <input className="ci" type="number" min="0" max="100" value={regRisk} onChange={e=>setRegRisk(e.target.value)} disabled={busy}/>
                  </div>
                  <div className="ig" style={{flex:1}}><div className="il"><span>Max Cap (USDC)</span></div>
                    <input className="ci" type="number" value={regCap} onChange={e=>setRegCap(e.target.value)} disabled={busy}/>
                  </div>
                </div>
                <div className="cb">
                  <input type="checkbox" checked={regAudited} onChange={e=>setRegAudited(e.target.checked)} style={{width:'18px',height:'18px',accentColor:'var(--c-emerald)'}}/>
                  <span style={{fontSize:'13px',color:'rgba(255,255,255,.7)'}}>Audited protocol (20% premium discount)</span>
                </div>
                <button className="btn" disabled={busy}
                  onClick={()=>{
                    const addr=regAddr.trim();
                    const name=regName.trim();
                    
                    // Add loud validation
                    if (!addr || !name) {
                      setTxErr('Please fill in both Protocol Address and Name.');
                      setTimeout(() => setTxErr(null), 4500);
                      return;
                    }
                    if (!addr.startsWith('0x') || addr.length !== 42) {
                      setTxErr('Invalid Ethereum address format. Must be 42 characters starting with 0x.');
                      setTimeout(() => setTxErr(null), 4500);
                      return;
                    }

                    write(`Registering ${name}`,{
                      address:REG_ADDR,abi:RISK_REGISTRY_ABI,functionName:'registerProtocol',
                      args:[addr as `0x${string}`,name,parseInt(regRisk) as unknown as number,regAudited,BigInt(Math.round(parseFloat(regCap||'0')*1_000_000))],
                    },{type:'register',address:addr,name});
                  }}>
                  {busy&&txLabel.startsWith('Registering')?<><span className="sp"/> Confirming...</>:'Register Protocol'}
                </button>

                {/* Update Score */}
                <div style={{marginTop:'28px',paddingTop:'24px',borderTop:'1px solid rgba(255,255,255,.08)'}}>
                  <h3 style={{fontSize:'22px',marginBottom:'14px'}}>Update Risk Score</h3>
                  <div className="ig"><div className="il"><span>Protocol Address</span></div>
                    <input className="ci" placeholder="0x..." value={updAddr} onChange={e=>setUpdAddr(e.target.value)} disabled={busy}/>
                  </div>
                  <div className="ig"><div className="il"><span>New Score (0-100)</span></div>
                    <input className="ci" type="number" min="0" max="100" value={updScore} onChange={e=>setUpdScore(e.target.value)} disabled={busy}/>
                  </div>
                  <button className="btn gd" disabled={busy||!updAddr||!updScore}
                    onClick={()=>write('Updating risk score',{address:REG_ADDR,abi:RISK_REGISTRY_ABI,functionName:'updateRiskScore',args:[updAddr as `0x${string}`,parseInt(updScore) as unknown as number]},{type:'update_score',address:updAddr})}>
                    Update Score
                  </button>
                </div>

                {/* Recover */}
                <div className="rbox">
                  <h4>↩ Recover Existing Protocol</h4>
                  <p>
                    Protocol already on-chain but not showing? Happens when cache is cleared or on a new device.<br/>
                    <strong style={{color:'rgba(255,215,0,.7)'}}>MemeFarm already registered?</strong> Enter its address + name here.
                  </p>
                  <div className="ig"><div className="il"><span>Protocol Address</span></div>
                    <input className="ci" placeholder="0x..." value={recAddr} onChange={e=>{setRecAddr(e.target.value);setRecErr('');}} disabled={recBusy}/>
                  </div>
                  <div className="ig"><div className="il"><span>Protocol Name</span></div>
                    <input className="ci" placeholder="e.g. MemeFarm Protocol" value={recName} onChange={e=>{setRecName(e.target.value);setRecErr('');}} disabled={recBusy}/>
                  </div>
                  {recErr && <div style={{color:'var(--c-ruby)',fontSize:'12px',fontFamily:'JetBrains Mono',marginBottom:'12px'}}>⚠ {recErr}</div>}
                  {recOk  && <div style={{color:'var(--c-emerald)',fontSize:'12px',fontFamily:'JetBrains Mono',marginBottom:'12px'}}>{recOk}</div>}
                  <button className="btn gd" disabled={recBusy||!recAddr||!recName} onClick={recover}>
                    {recBusy?<><span className="sp"/> Checking chain...</>:'↩ Recover Protocol'}
                  </button>
                </div>
              </div>
            )}

            {/* Active Network Index */}
            <div className="gp" style={{height:'fit-content'}}>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'20px'}}>
                <h3>Active Network Index</h3>
                <button className="btn sm gd" style={{width:'auto'}} onClick={fullSync} disabled={loading}>
                  {loading?<><span className="sp"/> Syncing</>:'↻ Full Sync'}
                </button>
              </div>

              {/* Empty state — guide user */}
              {!loading && active.length===0 && (
                <div className="empty">
                  No active protocols in registry.
                  {isAdmin && (
                    <div style={{marginTop:'12px',fontSize:'11px',color:'rgba(255,215,0,.6)'}}>
                      Already registered protocols? Use<br/>
                      <strong>↩ Recover Existing Protocol</strong> on the left.<br/>
                      <span style={{opacity:.6}}>e.g. MemeFarm: 0x3fC9...7FAD</span>
                    </div>
                  )}
                </div>
              )}
              {loading && protocols.length===0 && (
                <div style={{padding:'40px',textAlign:'center',color:'var(--c-gold)'}}>
                  <span className="sp"/> Loading...
                </div>
              )}

              {active.map(p=>{
                const rm=riskMeta(p.riskScore);
                return (
                  <div key={p.address} className="lr proto">
                    <div style={{flex:1}}>
                      <div className="lt">
                        {p.name}
                        <span style={{color:'var(--c-emerald)',fontSize:'11px',marginLeft:'10px'}}>● ACTIVE</span>
                      </div>
                      <div className="ls" style={{marginBottom:'8px'}}>{p.address}</div>
                      <div style={{display:'flex',gap:'6px',flexWrap:'wrap'}}>
                        <span className="tag" style={{color:rm.c}}>RISK {p.riskScore}/100 · {rm.l}</span>
                        <span className="tag" style={{color:'rgba(255,255,255,.6)'}}>CAP {fmtUsdc(p.coverageCap)}</span>
                        <span className="tag" style={{color:p.audited?'var(--c-emerald)':'rgba(255,255,255,.3)'}}>{p.audited?'✓ AUDITED':'✗ UNAUDITED'}</span>
                      </div>
                    </div>
                    {isAdmin && (
                      <div style={{display:'flex',flexDirection:'column',gap:'8px',marginLeft:'15px',flexShrink:0,alignItems:'flex-end'}}>
                        <button className="btn sm rd action-btn" disabled={busy}
                          onClick={()=>write(`Halting ${p.name}`,{address:REG_ADDR,abi:RISK_REGISTRY_ABI,functionName:'blacklistProtocol',args:[p.address as `0x${string}`]},{type:'halt',address:p.address})}>
                          Halt
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}

              {halted.length>0 && (
                <div style={{marginTop:'36px',borderTop:'1px solid rgba(255,255,255,.1)',paddingTop:'18px'}}>
                  <h4 style={{color:'var(--c-ruby)',marginBottom:'14px',fontFamily:'Cormorant Garamond',fontSize:'22px',fontStyle:'italic'}}>Archived / Halted</h4>
                  {halted.map(p=>(
                    <div key={p.address} className="lr proto" style={{opacity:.5, filter:'grayscale(100%)'}}>
                      <div style={{flex:1}}>
                        <div className="lt">{p.name}<span style={{color:'var(--c-ruby)',fontSize:'11px',marginLeft:'8px'}}>● HALTED</span></div>
                        <div className="ls">{shortAddr(p.address)}</div>
                      </div>
                      {isAdmin && (
                        <div style={{display:'flex',flexDirection:'column',gap:'8px',marginLeft:'15px',flexShrink:0,alignItems:'flex-end'}}>
                          <button className="btn sm gr action-btn" disabled={busy}
                            onClick={()=>write(`Reactivating ${p.name}`,{address:REG_ADDR,abi:RISK_REGISTRY_ABI,functionName:'unblacklistProtocol',args:[p.address as `0x${string}`]},{type:'reactivate',address:p.address,name:p.name})}>
                            Reactivate
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ═══ VETO ═══ */}
        {tab==='veto' && (
          <div style={{display:'grid',gridTemplateColumns:isAdmin?'1fr 1fr':'1fr',gap:'30px'}}>
            {isAdmin && (
              <div className="gp">
                <h3>Council Administration</h3>
                <div className="ig"><div className="il"><span>Add Guardian</span></div>
                  <input className="ci" placeholder="0x..." value={grdAddr} onChange={e=>setGrdAddr(e.target.value)} disabled={busy}/>
                </div>
                <button className="btn gd" style={{marginBottom:'28px'}} disabled={busy||!grdAddr}
                  onClick={()=>write('Adding guardian',{address:VETO_ADDR,abi:VETO_COUNCIL_ABI,functionName:'addGuardian',args:[grdAddr as `0x${string}`]},{type:'guardian_add',address:grdAddr})}>
                  Add to Council
                </button>
                <div className="ig"><div className="il"><span>Threshold</span><span>Current: {threshold!==undefined?Number(threshold):'-'}</span></div>
                  <input className="ci" type="number" min="1" value={thresh} onChange={e=>setThresh(e.target.value)} placeholder="Required signatures" disabled={busy}/>
                </div>
                <button className="btn gd" disabled={busy||!thresh}
                  onClick={()=>write('Setting threshold',{address:VETO_ADDR,abi:VETO_COUNCIL_ABI,functionName:'setThreshold',args:[BigInt(parseInt(thresh))]},{type:'other'})}>
                  Update Threshold
                </button>
              </div>
            )}
            <div className="gp" style={{height:'fit-content'}}>
              <h3>Active Guardians</h3>
              {guardians.length===0
                ? <div className="empty" style={{padding:'30px'}}>No guardians cached. Add one to see them here.</div>
                : guardians.map(g=>(
                  <div key={g} className="lr">
                    <div className="lt" style={{fontSize:'12px',wordBreak:'break-all'}}>
                      {g}{g.toLowerCase()===address?.toLowerCase()&&<span style={{color:'var(--c-gold)',fontSize:'10px',marginLeft:'8px'}}>(YOU)</span>}
                    </div>
                    {isAdmin && <button className="btn sm rd" style={{marginLeft:'12px',flexShrink:0}} disabled={busy}
                      onClick={()=>write('Removing guardian',{address:VETO_ADDR,abi:VETO_COUNCIL_ABI,functionName:'removeGuardian',args:[g as `0x${string}`]},{type:'guardian_remove',address:g})}>
                      Revoke
                    </button>}
                  </div>
                ))
              }
              {(isGuardian||isAdmin) && (
                <div style={{marginTop:'36px',paddingTop:'28px',borderTop:'1px solid rgba(255,255,255,.1)'}}>
                  <h3 style={{fontSize:'24px',color:'var(--c-ruby)'}}>Execute Veto</h3>
                  <div className="ig" style={{marginTop:'18px'}}>
                    <input className="ci" type="number" placeholder="Claim ID" value={vetoId} onChange={e=>setVetoId(e.target.value)} disabled={busy} style={{marginBottom:'14px'}}/>
                    <input className="ci" placeholder="Reason (stored on-chain)" value={vetoR} onChange={e=>setVetoR(e.target.value)} disabled={busy}/>
                  </div>
                  <button className="btn" style={{background:'var(--c-ruby)'}} disabled={busy||!vetoId||!vetoR}
                    onClick={()=>write(`Signing Veto #${vetoId}`,{address:VETO_ADDR,abi:VETO_COUNCIL_ABI,functionName:'signVeto',args:[BigInt(vetoId),vetoR]},{type:'other'})}>
                    Sign Veto Directive
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ═══ CLAIMS ═══ */}
        {tab==='claims' && (
          <div className="gp">
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'20px'}}>
              <h3>Active Adjudications</h3>
              <button className="btn sm gd" onClick={fetchClaims} style={{width:'auto'}}>↻ Sync</button>
            </div>
            {isAdmin && (
              <div style={{display:'flex',gap:'15px',alignItems:'flex-end',marginBottom:'28px',padding:'18px',background:'rgba(0,0,0,.4)',borderRadius:'12px'}}>
                <div className="ig" style={{marginBottom:0,flex:1}}>
                  <div className="il"><span>Voting Window (Days)</span><span>Current: {votPeriod?Number(votPeriod)/86400:'-'}d</span></div>
                  <input className="ci" type="number" value={vperiod} onChange={e=>setVperiod(e.target.value)} disabled={busy}/>
                </div>
                <button className="btn sm gd" style={{width:'auto',padding:'18px 28px'}} disabled={busy||!vperiod}
                  onClick={()=>write('Setting period',{address:GOV_ADDR,abi:CLAIMS_GOVERNOR_ABI,functionName:'setVotingPeriod',args:[BigInt(parseInt(vperiod)*86400)]},{type:'claim'})}>
                  Set
                </button>
              </div>
            )}
            {claimsLoad
              ? <div style={{padding:'40px',textAlign:'center',color:'var(--c-gold)'}}><span className="sp"/> Loading Claims...</div>
              : claims.length===0
                ? <div className="empty">No claims filed yet.</div>
                : claims.map(c=>{
                  const st=claimStatus(c.status);
                  const tot=c.yesVotes+c.noVotes;
                  const yp=tot>0n?Math.round(Number(c.yesVotes*100n)/Number(tot)):0;
                  const act=c.status===0&&BigInt(Math.floor(Date.now()/1000))<c.votingEndsAt;
                  const fin=c.status===0&&BigInt(Math.floor(Date.now()/1000))>=c.votingEndsAt;
                  return (
                    <div key={c.id} className="lr proto" style={{flexDirection:'column',alignItems:'flex-start',background:'rgba(0,0,0,.3)',padding:'24px',borderRadius:'16px',marginBottom:'18px'}}>
                      <div style={{display:'flex',justifyContent:'space-between',width:'100%',marginBottom:'14px'}}>
                        <div>
                          <div className="lt" style={{fontSize:'20px'}}>Claim #{c.id}
                            <span style={{color:st!.c,fontSize:'11px',padding:'3px 8px',border:`1px solid ${st!.c}55`,borderRadius:'5px',marginLeft:'10px'}}>{st!.l}</span>
                          </div>
                          <div className="ls">Policy #{Number(c.policyId)} · {shortAddr(c.claimant)}</div>
                        </div>
                        {act&&<div style={{color:'var(--c-gold)',fontFamily:'JetBrains Mono',fontSize:'11px'}}>{timeLeft(c.votingEndsAt)} left</div>}
                      </div>
                      <div style={{width:'100%',height:'5px',background:'var(--c-ruby)',borderRadius:'3px',overflow:'hidden',marginBottom:'8px',display:'flex'}}>
                        <div style={{width:`${yp}%`,background:'var(--c-emerald)',height:'100%'}}/>
                      </div>
                      <div style={{display:'flex',justifyContent:'space-between',width:'100%',fontFamily:'JetBrains Mono',fontSize:'11px'}}>
                        <span style={{color:'var(--c-emerald)'}}>YES {yp}% ({fmtShield(c.yesVotes)})</span>
                        <span style={{color:'var(--c-ruby)'}}>NO {100-yp}% ({fmtShield(c.noVotes)})</span>
                      </div>
                      <div style={{display:'flex',gap:'12px',marginTop:'20px'}}>
                        {act&&(shieldVotes as bigint)>0n&&<>
                          <button className="btn sm gr" disabled={busy} onClick={()=>write(`YES #${c.id}`,{address:GOV_ADDR,abi:CLAIMS_GOVERNOR_ABI,functionName:'castVote',args:[BigInt(c.id),true]},{type:'claim'})}>Vote YES</button>
                          <button className="btn sm rd" disabled={busy} onClick={()=>write(`NO #${c.id}`,{address:GOV_ADDR,abi:CLAIMS_GOVERNOR_ABI,functionName:'castVote',args:[BigInt(c.id),false]},{type:'claim'})}>Vote NO</button>
                        </>}
                        {fin&&<button className="btn sm gd" disabled={busy} onClick={()=>write(`Finalize #${c.id}`,{address:GOV_ADDR,abi:CLAIMS_GOVERNOR_ABI,functionName:'finalizeClaim',args:[BigInt(c.id)]},{type:'claim'})}>Finalize</button>}
                      </div>
                    </div>
                  );
                })
            }
          </div>
        )}

        {/* ═══ SHIELD ═══ */}
        {tab==='shield' && (
          <div className="gp" style={{maxWidth:'800px',margin:'0 auto'}}>
            <h3>Voting Power Dashboard</h3>
            <p style={{color:'rgba(255,255,255,.5)',fontSize:'13px',marginBottom:'32px'}}>Delegate to yourself to activate voting power for claims.</p>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'20px',marginBottom:'36px'}}>
              <div style={{padding:'28px',background:'rgba(0,0,0,.5)',border:'1px solid var(--c-border)',borderRadius:'16px',textAlign:'center'}}>
                <div style={{color:'rgba(255,255,255,.4)',fontSize:'11px',fontFamily:'JetBrains Mono',marginBottom:'10px'}}>RAW BALANCE</div>
                <div style={{color:'var(--c-gold)',fontSize:'34px',fontFamily:'Cormorant Garamond',fontWeight:700}}>{shieldBal!==undefined?fmtShield(shieldBal as bigint):'-'}</div>
              </div>
              <div style={{padding:'28px',background:'rgba(0,0,0,.5)',border:`1px solid ${(shieldVotes as bigint)>0n?'var(--c-emerald)':'var(--c-ruby)'}`,borderRadius:'16px',textAlign:'center'}}>
                <div style={{color:'rgba(255,255,255,.4)',fontSize:'11px',fontFamily:'JetBrains Mono',marginBottom:'10px'}}>ACTIVE VOTES</div>
                <div style={{color:(shieldVotes as bigint)>0n?'var(--c-emerald)':'var(--c-ruby)',fontSize:'34px',fontFamily:'Cormorant Garamond',fontWeight:700}}>{shieldVotes!==undefined?fmtShield(shieldVotes as bigint):'-'}</div>
              </div>
            </div>
            <div className="ig"><div className="il"><span>Delegate To</span></div>
              <input className="ci" placeholder="Blank = self-delegate" value={delTo} onChange={e=>setDelTo(e.target.value)} disabled={busy}/>
            </div>
            <div style={{display:'flex',gap:'18px'}}>
              <button className="btn gd" disabled={busy} onClick={()=>write('Self-delegating',{address:SHIELD_ADDR,abi:SHIELD_TOKEN_ABI,functionName:'delegate',args:[address as `0x${string}`]},{type:'other'})}>Self-Delegate</button>
              {delTo&&delTo!==address&&<button className="btn" style={{background:'var(--c-emerald)',color:'#000'}} disabled={busy} onClick={()=>write(`Delegating to ${shortAddr(delTo)}`,{address:SHIELD_ADDR,abi:SHIELD_TOKEN_ABI,functionName:'delegate',args:[delTo as `0x${string}`]},{type:'other'})}>Delegate Remote</button>}
            </div>
          </div>
        )}
      </div>
    </>
  );
}
