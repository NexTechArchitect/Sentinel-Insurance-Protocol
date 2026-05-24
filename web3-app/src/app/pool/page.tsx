'use client';
import React, { useEffect, useRef, useState, useCallback } from 'react';
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

const ERC20_ABI = [
  { name: 'approve',   type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'spender', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: [{ type: 'bool' }] },
  { name: 'allowance', type: 'function', stateMutability: 'view',       inputs: [{ name: 'owner', type: 'address' }, { name: 'spender', type: 'address' }], outputs: [{ type: 'uint256' }] },
  { name: 'balanceOf', type: 'function', stateMutability: 'view',       inputs: [{ name: 'account', type: 'address' }], outputs: [{ type: 'uint256' }] },
] as const;

const POOL_DEPOSIT_ABI = [
  { name: 'deposit', type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'usdcAmount', type: 'uint256' }], outputs: [] },
] as const;

const POOL_WITHDRAW_ABI = [
  { name: 'withdraw', type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'shares', type: 'uint256' }], outputs: [] },
] as const;

const POOL_READ_ABI = [
  { name: 'totalLiquidity',       type: 'function', stateMutability: 'view', inputs: [],                                     outputs: [{ type: 'uint256' }] },
  { name: 'freeLiquidity',        type: 'function', stateMutability: 'view', inputs: [],                                     outputs: [{ type: 'uint256' }] },
  { name: 'totalLockedLiquidity', type: 'function', stateMutability: 'view', inputs: [],                                     outputs: [{ type: 'uint256' }] },
  { name: 'sharesOf',             type: 'function', stateMutability: 'view', inputs: [{ name: 'lp',      type: 'address' }], outputs: [{ type: 'uint256' }] },
  { name: 'sharesToUsdc',         type: 'function', stateMutability: 'view', inputs: [{ name: 'shares',  type: 'uint256' }], outputs: [{ type: 'uint256' }] },
  { name: 'totalSupply',          type: 'function', stateMutability: 'view', inputs: [],                                     outputs: [{ type: 'uint256' }] },
  { name: 'paused',               type: 'function', stateMutability: 'view', inputs: [],                                     outputs: [{ type: 'bool'    }] },
  { name: 'maxWithdraw',          type: 'function', stateMutability: 'view', inputs: [{ name: 'account', type: 'address' }], outputs: [{ type: 'uint256' }] },
] as const;

const USDC_ADDR = SENTINEL_ADDRESSES.USDC.toLowerCase() as `0x${string}`;
const POOL_ADDR = SENTINEL_ADDRESSES.COVERAGE_POOL.toLowerCase() as `0x${string}`;

const fmtUsdc = (v: bigint | undefined, decimals = 2) => {
  if (v === undefined) return '—';
  const n = Number(v) / 1e6;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000)     return `${(n / 1_000).toFixed(2)}K`;
  return n.toFixed(decimals);
};

const fmtShares = (v: bigint | undefined) => {
  if (v === undefined) return '—';
  const n = Number(v) / 1e12;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(3)}M`;
  if (n >= 1_000)     return `${(n / 1_000).toFixed(3)}K`;
  return n.toFixed(4);
};

const shortAddr = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

const pct = (a: bigint | undefined, b: bigint | undefined) => {
  if (!a || !b || b === 0n) return 0;
  return Math.min(100, Math.round(Number(a * 10000n / b) / 100));
};

type Tab = 'deposit' | 'withdraw';

function LiquidityScene() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const mount = ref.current;
    if (!mount) return;
    let cancelled = false;
    const W = window.innerWidth, H = window.innerHeight;
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
    renderer.setClearColor(0, 0);
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.setSize(W, H);
    mount.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x000510, 0.001);
    const cam = new THREE.PerspectiveCamera(40, W / H, 1, 10000);
    cam.position.set(0, 150, 400);
    scene.add(new THREE.AmbientLight(0x0a0a1a, 2.0));
    const pl1 = new THREE.PointLight(0xff0077, 20, 1400); pl1.position.set(-200, 100, 150); scene.add(pl1);
    const pl2 = new THREE.PointLight(0x00f0ff, 20, 1100); pl2.position.set(200, -80, 120);  scene.add(pl2);
    const pl3 = new THREE.PointLight(0x7000ff, 15,  900); pl3.position.set(0, -120, -280);  scene.add(pl3);
    const SEPARATION = 40, AMOUNTX = 70, AMOUNTY = 70;
    const numParticles = AMOUNTX * AMOUNTY;
    const positions = new Float32Array(numParticles * 3);
    const colors    = new Float32Array(numParticles * 3);
    const scales    = new Float32Array(numParticles);
    const c1 = new THREE.Color('#ff0055');
    const c2 = new THREE.Color('#00f0ff');
    const c3 = new THREE.Color('#7000ff');
    let i = 0;
    for (let ix = 0; ix < AMOUNTX; ix++) {
      for (let iy = 0; iy < AMOUNTY; iy++) {
        positions[i * 3]     = ix * SEPARATION - (AMOUNTX * SEPARATION) / 2;
        positions[i * 3 + 1] = 0;
        positions[i * 3 + 2] = iy * SEPARATION - (AMOUNTY * SEPARATION) / 2;
        const mix = ix / AMOUNTX;
        const finalColor = mix < 0.5 ? c1.clone().lerp(c3, mix * 2) : c3.clone().lerp(c2, (mix - 0.5) * 2);
        colors[i * 3]     = finalColor.r;
        colors[i * 3 + 1] = finalColor.g;
        colors[i * 3 + 2] = finalColor.b;
        scales[i] = 1;
        i++;
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color',    new THREE.BufferAttribute(colors, 3));
    geometry.setAttribute('scale',    new THREE.BufferAttribute(scales, 1));
    const material = new THREE.ShaderMaterial({
      uniforms: { color: { value: new THREE.Color(0xffffff) } },
      vertexShader: `attribute float scale;varying vec3 vColor;void main(){vColor=color;vec4 mvPosition=modelViewMatrix*vec4(position,1.0);gl_PointSize=scale*(300.0/-mvPosition.z);gl_Position=projectionMatrix*mvPosition;}`,
      fragmentShader: `varying vec3 vColor;void main(){float d=distance(gl_PointCoord,vec2(0.5,0.5));if(d>0.5)discard;float alpha=smoothstep(0.5,0.1,d)*0.9;gl_FragColor=vec4(vColor,alpha);}`,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      vertexColors: true,
    });
    const particles = new THREE.Points(geometry, material);
    scene.add(particles);
    const mouse = { x: 0, y: 0, tx: 0, ty: 0 };
    const onMM = (e: MouseEvent) => { mouse.tx = (e.clientX - W / 2) * 0.05; mouse.ty = (e.clientY - H / 2) * 0.05; };
    const onR  = () => { renderer.setSize(window.innerWidth, window.innerHeight); cam.aspect = window.innerWidth / window.innerHeight; cam.updateProjectionMatrix(); };
    window.addEventListener('mousemove', onMM, { passive: true });
    window.addEventListener('resize',    onR,  { passive: true });
    let raf = 0, count = 0;
    const tick = () => {
      if (cancelled) return;
      mouse.x += (mouse.tx - mouse.x) * 0.03;
      mouse.y += (mouse.ty - mouse.y) * 0.03;
      cam.position.x += (mouse.x - cam.position.x) * 0.01;
      cam.position.y += (150 + mouse.y * -1 - cam.position.y) * 0.01;
      cam.lookAt(0, 0, 0);
      const posAttr = geometry.attributes.position;
      const scaleAttr = geometry.attributes.scale;
      let idx = 0;
      for (let ix = 0; ix < AMOUNTX; ix++) {
        for (let iy = 0; iy < AMOUNTY; iy++) {
          posAttr.setY(idx, (Math.sin((ix + count) * 0.3) * 35) + (Math.sin((iy + count) * 0.5) * 35));
          scaleAttr.setX(idx, (Math.sin((ix + count) * 0.3) + 1) * 2.5 + (Math.sin((iy + count) * 0.5) + 1) * 2.5);
          idx++;
        }
      }
      posAttr.needsUpdate = true;
      scaleAttr.needsUpdate = true;
      count += 0.008;
      particles.rotation.y = count * 0.004;
      renderer.render(scene, cam);
      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      window.removeEventListener('mousemove', onMM);
      window.removeEventListener('resize', onR);
      if (mount.contains(renderer.domElement)) mount.removeChild(renderer.domElement);
      renderer.dispose();
    };
  }, []);
  return <div style={{ position: 'fixed', inset: 0, zIndex: 0, pointerEvents: 'none' }} ref={ref} aria-hidden />;
}

function Counter({ value, prefix = '' }: { value: string; prefix?: string }) {
  const [display, setDisplay] = useState('—');
  useEffect(() => {
    if (value === '—') { setDisplay('—'); return; }
    let frame = 0;
    const total = 28;
    const chars = '0123456789.,KMB';
    const iv = setInterval(() => {
      if (frame >= total) { setDisplay(value); clearInterval(iv); return; }
      setDisplay(Array.from(value).map(c => (c.match(/[0-9]/) && Math.random() > frame / total) ? chars[Math.floor(Math.random() * 10)] : c).join(''));
      frame++;
    }, 28);
    return () => clearInterval(iv);
  }, [value]);
  return <>{prefix}{display}</>;
}

function MetricCard({ label, value, sub, accent, glow }: { label: string; value: string; sub?: string; accent: string; glow: string }) {
  return (
    <div style={{ padding: '22px 20px', position: 'relative', overflow: 'hidden', border: `1px solid ${accent}33`, background: 'linear-gradient(135deg, rgba(0,5,15,0.8), rgba(0,5,15,0.4))', backdropFilter: 'blur(24px)', boxShadow: `0 0 30px ${glow}`, borderRadius: '16px' }}>
      <div style={{ position: 'absolute', top: 0, right: 0, width: 80, height: 80, background: `radial-gradient(circle at top right, ${accent}25, transparent 70%)`, pointerEvents: 'none' }} />
      <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 9, fontWeight: 800, letterSpacing: '0.18em', textTransform: 'uppercase', color: `${accent}99`, marginBottom: 10 }}>{label}</div>
      <div style={{ fontFamily: "'Cormorant Garamond', Georgia, serif", fontSize: 'clamp(24px, 2.4vw, 36px)', fontStyle: 'italic', fontWeight: 700, color: '#fff', lineHeight: 1 }}>
        <Counter value={value} prefix="$" />
      </div>
      {sub && <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 9, color: 'rgba(255,255,255,0.3)', marginTop: 7, letterSpacing: '0.1em' }}>{sub}</div>}
    </div>
  );
}

// ── NEW: Wallet Balance Card — prominently shows on-chain USDC ──
function WalletBalanceCard({ balance, address }: { balance: bigint | undefined; address: string | undefined }) {
  const isLoading = balance === undefined;
  const isEmpty   = !isLoading && balance === 0n;
  const usdcAmt   = fmtUsdc(balance, 4);

  return (
    <div style={{
      padding: '18px 20px',
      position: 'relative',
      overflow: 'hidden',
      border: isEmpty ? '1px solid rgba(255,165,0,0.35)' : '1px solid rgba(255,215,0,0.35)',
      background: isEmpty
        ? 'linear-gradient(135deg, rgba(255,100,0,0.08), rgba(0,5,15,0.6))'
        : 'linear-gradient(135deg, rgba(255,215,0,0.09), rgba(0,5,15,0.6))',
      backdropFilter: 'blur(24px)',
      boxShadow: isEmpty ? '0 0 24px rgba(255,100,0,0.08)' : '0 0 28px rgba(255,215,0,0.10)',
      borderRadius: '16px',
      marginBottom: 22,
    }}>
      {/* Corner glow */}
      <div style={{ position: 'absolute', top: 0, right: 0, width: 100, height: 100, background: 'radial-gradient(circle at top right, rgba(255,215,0,0.18), transparent 70%)', pointerEvents: 'none' }} />

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {/* Animated dot */}
          <span style={{
            display: 'inline-block', width: 8, height: 8, borderRadius: '50%',
            background: isLoading ? 'rgba(255,255,255,0.3)' : isEmpty ? '#ff8c00' : '#FFD700',
            boxShadow: isLoading ? 'none' : isEmpty ? '0 0 10px rgba(255,140,0,0.8)' : '0 0 12px rgba(255,215,0,0.9)',
            animation: 'glow 2s ease-in-out infinite',
            flexShrink: 0,
          }} />
          <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 9, fontWeight: 800, letterSpacing: '0.2em', textTransform: 'uppercase', color: 'rgba(255,215,0,0.75)' }}>
            Wallet USDC Balance
          </span>
        </div>
        {address && (
          <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 9, color: 'rgba(255,255,255,0.3)', letterSpacing: '0.08em' }}>
            {shortAddr(address)}
          </span>
        )}
      </div>

      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 12 }}>
        <div style={{ fontFamily: "'Cormorant Garamond', Georgia, serif", fontSize: 'clamp(32px, 3.5vw, 48px)', fontStyle: 'italic', fontWeight: 700, color: isLoading ? 'rgba(255,255,255,0.25)' : isEmpty ? '#ff8c00' : '#FFD700', lineHeight: 1 }}>
          {isLoading ? '···' : `$${usdcAmt}`}
        </div>
        <div style={{ paddingBottom: 4 }}>
          <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, fontWeight: 600, color: 'rgba(255,255,255,0.5)', letterSpacing: '0.1em' }}>USDC</span>
          <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 8, color: 'rgba(255,255,255,0.25)', marginTop: 2, letterSpacing: '0.08em' }}>Sepolia Testnet</div>
        </div>
      </div>

      {!isLoading && isEmpty && (
        <div style={{ marginTop: 10, padding: '8px 12px', borderRadius: 8, background: 'rgba(255,140,0,0.1)', border: '1px solid rgba(255,140,0,0.25)', fontSize: 9, color: 'rgba(255,165,0,0.9)', letterSpacing: '0.08em', lineHeight: 1.6 }}>
          💧 Zero USDC detected. Get test tokens →{' '}
          <a href="https://staging.aave.com/faucet/" target="_blank" rel="noreferrer" style={{ color: '#FFD700', textDecoration: 'underline' }}>
            Aave Sepolia Faucet ↗
          </a>
        </div>
      )}

      {!isLoading && !isEmpty && balance !== undefined && Number(balance) > 0 && (
        <div style={{ marginTop: 10, display: 'flex', gap: 16 }}>
          <div>
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 8, color: 'rgba(255,215,0,0.45)', letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 2 }}>Raw (6 dec)</div>
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: 'rgba(255,255,255,0.55)' }}>{balance.toString()}</div>
          </div>
          <div>
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 8, color: 'rgba(255,215,0,0.45)', letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 2 }}>Exact</div>
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: 'rgba(255,255,255,0.55)' }}>{(Number(balance) / 1e6).toFixed(6)} USDC</div>
          </div>
        </div>
      )}
    </div>
  );
}

function UtilBar({ locked, total }: { locked: bigint | undefined; total: bigint | undefined }) {
  const utilPct = pct(locked, total);
  const color = utilPct > 80 ? '#FF003C' : utilPct > 55 ? '#FFD700' : '#00ffaa';
  return (
    <div style={{ padding: '22px 24px', border: '1px solid rgba(0,255,170,0.15)', borderRadius: 16, background: 'rgba(0,5,15,0.7)', backdropFilter: 'blur(24px)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
        <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 9, fontWeight: 800, letterSpacing: '0.18em', textTransform: 'uppercase', color: 'rgba(0,255,170,0.6)' }}>Pool Utilization</span>
        <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, fontWeight: 700, color }}>{utilPct}%</span>
      </div>
      <div style={{ height: 8, borderRadius: 4, background: 'rgba(255,255,255,0.06)', overflow: 'hidden' }}>
        <div style={{ width: `${utilPct}%`, background: `linear-gradient(90deg, ${color}aa, ${color})`, height: '100%', transition: 'width 0.8s ease', boxShadow: `0 0 12px ${color}66` }} />
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8 }}>
        <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 9, color: 'rgba(255,255,255,0.35)', letterSpacing: '0.1em' }}>LOCKED · {fmtUsdc(locked)} USDC</span>
        <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 9, color: 'rgba(255,255,255,0.35)', letterSpacing: '0.1em' }}>FREE · {fmtUsdc(total && locked ? total - locked : undefined)} USDC</span>
      </div>
      <div style={{ display: 'flex', gap: 4, marginTop: 10 }}>
        {Array.from({ length: 10 }, (_, idx) => (
          <div key={idx} style={{ flex: 1, height: 3, borderRadius: 2, background: idx < utilPct / 10 ? color : 'rgba(255,255,255,0.06)', boxShadow: idx < utilPct / 10 ? `0 0 6px ${color}55` : 'none' }} />
        ))}
      </div>
    </div>
  );
}

export default function PoolPage() {
  const { address, isConnected } = useAccount();
  const publicClient = usePublicClient();
  const [mounted, setMounted]       = useState(false);
  const [tab, setTab]               = useState<Tab>('deposit');
  const [amount, setAmount]         = useState('');
  const [txError, setTxError]       = useState<string | null>(null);
  const [txSuccess, setTxSuccess]   = useState<string | null>(null);
  const [approveConfirmed, setApproveConfirmed] = useState(false);

  useEffect(() => setMounted(true), []);

  const { data: totalLiquidity, refetch: refetchTotal  } = useReadContract({ address: POOL_ADDR, abi: POOL_READ_ABI, functionName: 'totalLiquidity',       query: { refetchInterval: 4000 } });
  const { data: freeLiquidity,  refetch: refetchFree   } = useReadContract({ address: POOL_ADDR, abi: POOL_READ_ABI, functionName: 'freeLiquidity',        query: { refetchInterval: 4000 } });
  const { data: totalLocked,    refetch: refetchLocked } = useReadContract({ address: POOL_ADDR, abi: POOL_READ_ABI, functionName: 'totalLockedLiquidity', query: { refetchInterval: 4000 } });
  const { data: totalShareSupply }                       = useReadContract({ address: POOL_ADDR, abi: POOL_READ_ABI, functionName: 'totalSupply',          query: { refetchInterval: 4000 } });
  const { data: poolPaused      }                        = useReadContract({ address: POOL_ADDR, abi: POOL_READ_ABI, functionName: 'paused',               query: { refetchInterval: 8000 } });

  const { data: usdcBalance, refetch: refetchUsdcBal } = useReadContract({
    address: USDC_ADDR,
    abi: ERC20_ABI,
    functionName: 'balanceOf',
    args: address ? [address] : undefined,
    query: { enabled: !!address, refetchInterval: 3000 },
  });

  const { data: myShares,    refetch: refetchShares   } = useReadContract({ address: POOL_ADDR, abi: POOL_READ_ABI, functionName: 'sharesOf',    args: address ? [address] : undefined, query: { enabled: !!address, refetchInterval: 4000 } });
  const { data: myUsdcValue }                           = useReadContract({ address: POOL_ADDR, abi: POOL_READ_ABI, functionName: 'sharesToUsdc', args: myShares ? [myShares as bigint] : undefined, query: { enabled: !!myShares && (myShares as bigint) > 0n, refetchInterval: 4000 } });
  const { data: maxWithdraw }                           = useReadContract({ address: POOL_ADDR, abi: POOL_READ_ABI, functionName: 'maxWithdraw',  args: address ? [address] : undefined, query: { enabled: !!address, refetchInterval: 4000 } });
  const { data: allowance, refetch: refetchAllowance  } = useReadContract({ address: USDC_ADDR, abi: ERC20_ABI, functionName: 'allowance', args: address ? [address, POOL_ADDR] : undefined, query: { enabled: !!address, refetchInterval: 2000 } });

  const amountBig = (() => { try { const n = parseFloat(amount); if (isNaN(n) || n <= 0) return 0n; return BigInt(Math.floor(n * 1_000_000)); } catch { return 0n; } })();
  const sharesBig = (() => { try { const n = parseFloat(amount); if (isNaN(n) || n <= 0) return 0n; return BigInt(Math.floor(n * 1e12));     } catch { return 0n; } })();

  const usdcBal       = (usdcBalance as bigint | undefined) ?? 0n;
  const hasEnough     = amountBig === 0n || usdcBal >= amountBig;
  const needsApproval = tab === 'deposit' && amountBig > 0n && ((allowance as bigint) ?? 0n) < amountBig && !approveConfirmed;

  const { writeContract: writeApprove,  data: approveTxHash,  isPending: approving      } = useWriteContract();
  const { isLoading: approveWaiting,    isSuccess: approveOk }                            = useWaitForTransactionReceipt({ hash: approveTxHash });
  const { writeContract: writeDeposit,  data: depositTxHash,  isPending: depositPending  } = useWriteContract();
  const { isLoading: depositWaiting,    isSuccess: depositOk }                            = useWaitForTransactionReceipt({ hash: depositTxHash });
  const { writeContract: writeWithdraw, data: withdrawTxHash, isPending: withdrawPending } = useWriteContract();
  const { isLoading: withdrawWaiting,   isSuccess: withdrawOk }                           = useWaitForTransactionReceipt({ hash: withdrawTxHash });

  const busy = approving || approveWaiting || depositPending || depositWaiting || withdrawPending || withdrawWaiting;

  const refetchAll = useCallback(() => {
    refetchTotal(); refetchFree(); refetchLocked(); refetchShares(); refetchAllowance(); refetchUsdcBal();
  }, [refetchTotal, refetchFree, refetchLocked, refetchShares, refetchAllowance, refetchUsdcBal]);

  const decodeErr = (e: any): string => {
    const msg  = e?.shortMessage ?? e?.message ?? String(e);
    const full = (msg + ' ' + (e?.cause?.reason ?? '')).toLowerCase();
    if (full.includes('user rejected') || full.includes('user denied')) return 'Transaction rejected by user.';
    if (full.includes('enforcedpause') || full.includes('poolpaused'))  return 'Pool is paused.';
    if (full.includes('zerodeposit'))                                   return 'Amount cannot be zero.';
    if (full.includes('insufficientfreeliquidity'))                     return 'Not enough free liquidity in pool.';
    if (full.includes('insufficientshares'))                            return 'Insufficient shares to withdraw.';
    if (full.includes('erc20insufficientallowance'))                    return 'Insufficient allowance — approve first.';
    if (full.includes('erc20insufficientbalance'))                      return 'Insufficient USDC balance.';
    return msg.split('\n')[0].slice(0, 240);
  };

  useEffect(() => {
    if (!approveOk) return;
    setApproveConfirmed(true);
    refetchAllowance();
    setTxSuccess('✓ USDC Approved! Click "Deposit & Mint" to complete.');
    setTimeout(() => setTxSuccess(null), 6000);
  }, [approveOk, refetchAllowance]);

  useEffect(() => {
    if (!depositOk) return;
    setTxSuccess(`✓ Deposited ${amount} USDC — ssUSDC shares minted!`);
    setAmount(''); setApproveConfirmed(false);
    refetchAll();
    setTimeout(() => setTxSuccess(null), 9000);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [depositOk]);

  useEffect(() => {
    if (!withdrawOk) return;
    setTxSuccess('✓ Withdrawn — USDC returned to your wallet!');
    setAmount('');
    refetchAll();
    setTimeout(() => setTxSuccess(null), 9000);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [withdrawOk]);

  const onErr = (e: any) => { setTxError(decodeErr(e)); setTimeout(() => setTxError(null), 9000); };

  const handleApprove = () => {
    if (!amountBig) return;
    setTxError(null); setTxSuccess(null); setApproveConfirmed(false);
    writeApprove({ address: USDC_ADDR, abi: ERC20_ABI, functionName: 'approve', args: [POOL_ADDR, amountBig * 10n] }, { onError: onErr });
  };

  const handleDeposit = () => {
    if (!amountBig || !address) return;
    setTxError(null); setTxSuccess(null);
    writeDeposit({ address: POOL_ADDR, abi: POOL_DEPOSIT_ABI, functionName: 'deposit', args: [amountBig] }, { onError: onErr });
  };

  const handleWithdraw = () => {
    if (!sharesBig || !address) return;
    setTxError(null); setTxSuccess(null);
    writeWithdraw({ address: POOL_ADDR, abi: POOL_WITHDRAW_ABI, functionName: 'withdraw', args: [sharesBig] }, { onError: onErr });
  };

  const setMax = () => {
    if (!usdcBal || usdcBal === 0n) return;
    setAmount((Number(usdcBal) / 1e6).toFixed(6));
    setTxError(null); setApproveConfirmed(false);
  };

  const switchTab = (t: Tab) => { setTab(t); setAmount(''); setTxError(null); setTxSuccess(null); setApproveConfirmed(false); };

  const mySharePct = (() => {
    if (!myShares || !totalShareSupply || (totalShareSupply as bigint) === 0n) return '0.00';
    return (Number((myShares as bigint) * 10000n / (totalShareSupply as bigint)) / 100).toFixed(2);
  })();

  if (!mounted) return <div suppressHydrationWarning style={{ minHeight: '100vh', background: '#000510' }} />;

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,500;0,600;0,700;1,600;1,700&family=DM+Mono:ital,wght@0,400;0,500;1,400&family=JetBrains+Mono:wght@400;500;700&display=swap');
        *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
        html,body{background:#000510;overflow-x:hidden}
        :root{--g:#00ffaa;--r:#FF003C;--b:#0088ff;--pur:#7000ff;--gold:#FFD700;--border:rgba(0,255,170,0.15)}
        .lp-root{position:relative;z-index:10;min-height:100vh;color:#fff;font-family:'DM Mono',monospace}
        .lp-hdr{padding:48px 32px 32px;border-bottom:1px solid rgba(0,255,170,0.08)}
        .lp-eyebrow{font-size:9px;font-weight:500;letter-spacing:0.22em;text-transform:uppercase;color:rgba(0,255,170,0.7);margin-bottom:12px;display:flex;align-items:center;gap:9px}
        .lp-eyebrow::before{content:'';width:6px;height:6px;border-radius:50%;background:var(--g);box-shadow:0 0 14px rgba(0,255,170,0.9);flex-shrink:0;animation:glow 2s ease-in-out infinite}
        @keyframes glow{0%,100%{opacity:1;box-shadow:0 0 14px rgba(0,255,170,0.9)}50%{opacity:0.5;box-shadow:0 0 6px rgba(0,255,170,0.4)}}
        .lp-h1{font-family:'Cormorant Garamond',serif;font-size:clamp(42px,5.5vw,78px);font-style:italic;font-weight:700;line-height:0.88;background:linear-gradient(160deg,#fff 30%,rgba(0,255,170,0.8));-webkit-background-clip:text;-webkit-text-fill-color:transparent;margin-bottom:14px}
        .lp-hdrsub{font-size:11px;color:rgba(255,255,255,0.42);max-width:540px;line-height:1.65}
        .lp-body{display:grid;grid-template-columns:1fr 400px;max-width:1420px;margin:0 auto}
        @media(max-width:1020px){.lp-body{grid-template-columns:1fr}}
        .lp-left{padding:28px 32px;border-right:1px solid rgba(0,255,170,0.08)}
        .lp-right{padding:28px 24px}
        .lp-metrics{display:grid;grid-template-columns:repeat(3,1fr);gap:14px;margin-bottom:24px}
        @media(max-width:700px){.lp-metrics{grid-template-columns:1fr}}
        .lp-position{padding:24px;margin-bottom:22px;border:1px solid rgba(0,255,170,0.18);background:linear-gradient(135deg,rgba(0,255,170,0.06),rgba(0,8,22,0.6));border-radius:18px;backdrop-filter:blur(24px);position:relative;overflow:hidden}
        .lp-position::before{content:'';position:absolute;top:-40px;right:-40px;width:140px;height:140px;border-radius:50%;background:radial-gradient(circle,rgba(0,255,170,0.12),transparent 70%);pointer-events:none}
        .lp-pos-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin-top:16px}
        @media(max-width:700px){.lp-pos-grid{grid-template-columns:repeat(2,1fr)}}
        .lp-pos-item label{display:block;font-size:8px;font-weight:500;letter-spacing:0.16em;text-transform:uppercase;color:rgba(255,255,255,0.3);margin-bottom:5px}
        .lp-pos-item span{font-family:'Cormorant Garamond',serif;font-size:24px;font-style:italic;font-weight:700;color:#fff}
        .lp-panel{border:1px solid var(--border);background:rgba(0,5,15,0.8);border-radius:18px;backdrop-filter:blur(28px);overflow:hidden;box-shadow:0 20px 60px rgba(0,0,0,0.5),inset 0 1px 0 rgba(255,255,255,0.05)}
        .lp-tabs{display:flex;border-bottom:1px solid rgba(0,255,170,0.1)}
        .lp-tab{flex:1;height:50px;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:500;letter-spacing:0.14em;text-transform:uppercase;color:rgba(255,255,255,0.3);background:none;border:none;border-bottom:2px solid transparent;margin-bottom:-1px;cursor:pointer;transition:all 0.2s;font-family:'DM Mono',monospace}
        .lp-tab:hover{color:rgba(255,255,255,0.7)}
        .lp-tab.on{color:var(--g);border-bottom-color:var(--g);background:rgba(0,255,170,0.03)}
        .lp-form{padding:22px}
        .lp-bal-box{padding:14px 16px;border-radius:12px;background:rgba(0,255,170,0.06);border:1px solid rgba(0,255,170,0.2);margin-bottom:14px}
        .lp-bal-row{display:flex;justify-content:space-between;align-items:center}
        .lp-bal-label{font-size:9px;font-weight:500;letter-spacing:0.14em;text-transform:uppercase;color:rgba(255,255,255,0.4)}
        .lp-bal-amount{font-family:'Cormorant Garamond',serif;font-size:22px;font-style:italic;font-weight:700;color:var(--g)}
        .lp-bal-sub{font-size:9px;color:rgba(255,255,255,0.3);margin-top:3px;letter-spacing:0.08em}
        .lp-bal-zero{font-size:9px;color:var(--r);margin-top:4px;letter-spacing:0.08em}
        .lp-input-wrap{display:flex;border:1px solid rgba(0,255,170,0.15);border-radius:10px;background:rgba(0,0,0,0.6);overflow:hidden;transition:border-color 0.2s;margin-bottom:6px}
        .lp-input-wrap:focus-within{border-color:rgba(0,255,170,0.5);box-shadow:0 0 15px rgba(0,255,170,0.1)}
        .lp-input-wrap.warn{border-color:rgba(255,0,60,0.5)!important}
        .lp-input-pre{padding:0 13px;height:50px;display:flex;align-items:center;font-size:14px;color:rgba(255,255,255,0.4);border-right:1px solid rgba(0,255,170,0.1);flex-shrink:0}
        .lp-input{flex:1;height:50px;padding:0 13px;background:transparent;border:none;outline:none;font-family:'DM Mono',monospace;font-size:16px;color:#fff}
        .lp-input::placeholder{color:rgba(255,255,255,0.2)}
        .lp-input-suf{padding:0 13px;height:50px;display:flex;align-items:center;font-size:10px;font-weight:500;color:rgba(255,255,255,0.3);border-left:1px solid rgba(0,255,170,0.1);flex-shrink:0;letter-spacing:0.1em}
        .lp-input-hint{display:flex;justify-content:space-between;margin-bottom:14px;font-size:9px;letter-spacing:0.08em;padding:0 2px}
        .lp-hint-avail{color:rgba(255,255,255,0.35)}
        .lp-hint-warn{color:var(--r)}
        .lp-quick{display:flex;gap:6px;margin-bottom:18px;flex-wrap:wrap}
        .lp-q{padding:6px 10px;font-size:9px;font-weight:500;letter-spacing:0.1em;text-transform:uppercase;border:1px solid rgba(0,255,170,0.15);border-radius:6px;background:rgba(0,0,0,0.4);color:rgba(255,255,255,0.4);cursor:pointer;transition:all 0.2s;font-family:'DM Mono',monospace}
        .lp-q:hover{color:var(--g);border-color:rgba(0,255,170,0.4);background:rgba(0,255,170,0.05)}
        .lp-q:disabled{opacity:0.25;cursor:not-allowed}
        .lp-q-max{color:var(--g)!important;border-color:rgba(0,255,170,0.4)!important;background:rgba(0,255,170,0.08)!important;font-weight:700!important}
        .lp-q-max:hover{background:rgba(0,255,170,0.18)!important}
        .lp-btn{width:100%;padding:16px 20px;border:none;border-radius:10px;font-family:'DM Mono',monospace;font-size:11px;font-weight:500;letter-spacing:0.14em;text-transform:uppercase;cursor:pointer;transition:all 0.25s;display:flex;align-items:center;justify-content:center;gap:9px}
        .lp-btn:disabled{opacity:0.3;cursor:not-allowed}
        .lp-btn-emerald{background:rgba(0,255,170,0.12);color:var(--g);border:1px solid rgba(0,255,170,0.4)}
        .lp-btn-emerald:hover:not(:disabled){background:rgba(0,255,170,0.2);box-shadow:0 0 24px rgba(0,255,170,0.25)}
        .lp-btn-white{background:rgba(255,255,255,0.9);color:#000}
        .lp-btn-white:hover:not(:disabled){background:#fff;box-shadow:0 0 28px rgba(255,255,255,0.25)}
        .lp-btn-red{background:rgba(255,0,60,0.12);color:var(--r);border:1px solid rgba(255,0,60,0.4)}
        .lp-btn-red:hover:not(:disabled){background:rgba(255,0,60,0.2);box-shadow:0 0 24px rgba(255,0,60,0.25)}
        .lp-spin{display:inline-block;width:14px;height:14px;border-radius:50%;border:2px solid rgba(0,255,170,0.15);border-top-color:var(--g);animation:lpspin 0.75s linear infinite;flex-shrink:0}
        @keyframes lpspin{to{transform:rotate(360deg)}}
        .lp-banner{padding:12px 16px;border-radius:10px;font-size:10px;display:flex;align-items:flex-start;gap:9px;margin-bottom:16px;line-height:1.55}
        .lp-bi{background:rgba(0,136,255,0.1);color:rgba(0,200,255,0.95);border:1px solid rgba(0,136,255,0.3)}
        .lp-be{background:rgba(255,0,60,0.1);color:var(--r);border:1px solid rgba(255,0,60,0.3)}
        .lp-bs{background:rgba(0,255,170,0.1);color:var(--g);border:1px solid rgba(0,255,170,0.3)}
        .lp-inforow{display:flex;justify-content:space-between;padding:10px 0;border-bottom:1px solid rgba(255,255,255,0.05)}
        .lp-inforow:last-child{border-bottom:none}
        .lp-ik{font-size:9px;font-weight:500;letter-spacing:0.12em;text-transform:uppercase;color:rgba(255,255,255,0.3)}
        .lp-iv{font-size:10px;color:rgba(255,255,255,0.8)}
        .lp-section-hdr{font-size:10px;font-weight:500;letter-spacing:0.18em;text-transform:uppercase;color:rgba(0,255,170,0.6);margin-bottom:16px;display:flex;align-items:center;gap:10px}
        .lp-section-hdr::after{content:'';flex:1;height:1px;background:linear-gradient(90deg,rgba(0,255,170,0.25),transparent)}
        .lp-how{margin-top:24px}
        .lp-step{display:flex;gap:16px;padding:16px 0;border-bottom:1px solid rgba(255,255,255,0.05)}
        .lp-step:last-child{border-bottom:none}
        .lp-step-num{width:30px;height:30px;flex-shrink:0;border-radius:8px;border:1px solid rgba(0,255,170,0.3);display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:500;color:var(--g);background:rgba(0,255,170,0.05)}
        .lp-step-body h4{font-family:'Cormorant Garamond',serif;font-size:20px;font-style:italic;color:#fff;margin-bottom:4px}
        .lp-step-body p{font-size:11px;color:rgba(255,255,255,0.45);line-height:1.6}
        .lp-nowallet{padding:72px 32px;text-align:center}
        .lp-nowallet-t{font-family:'Cormorant Garamond',serif;font-size:32px;font-style:italic;color:rgba(255,255,255,0.4)}
        .lp-aave{display:flex;align-items:center;gap:8px;padding:12px 16px;border:1px solid rgba(178,98,255,0.25);border-radius:12px;background:rgba(178,98,255,0.08);margin-bottom:18px;box-shadow:0 0 20px rgba(178,98,255,0.05)}
        .lp-aave-dot{width:8px;height:8px;border-radius:50%;background:#b262ff;box-shadow:0 0 12px rgba(178,98,255,0.9);flex-shrink:0;animation:glow2 2.5s ease-in-out infinite}
        @keyframes glow2{0%,100%{box-shadow:0 0 12px rgba(178,98,255,0.9)}50%{box-shadow:0 0 4px rgba(178,98,255,0.3)}}
        .lp-aave span{font-size:9px;font-weight:500;letter-spacing:0.1em;text-transform:uppercase;color:rgba(178,98,255,0.9)}
        .lp-aave strong{font-size:9px;font-weight:500;color:rgba(255,255,255,0.6);margin-left:auto;letter-spacing:0.08em}
        .lp-steps-ind{display:flex;gap:8px;margin-bottom:16px}
        .lp-step-pill{flex:1;padding:8px 10px;border-radius:8px;font-size:9px;font-weight:500;letter-spacing:0.1em;text-transform:uppercase;text-align:center;border:1px solid;transition:all 0.3s;font-family:'DM Mono',monospace}
        .sp-done{border-color:rgba(0,255,170,0.4);background:rgba(0,255,170,0.08);color:var(--g)}
        .sp-act{border-color:rgba(255,255,255,0.3);background:rgba(255,255,255,0.06);color:rgba(255,255,255,0.9)}
        .sp-idle{border-color:rgba(255,255,255,0.08);background:transparent;color:rgba(255,255,255,0.2)}
        .lp-faucet{margin-top:10px;padding:10px 14px;border-radius:8px;background:rgba(255,165,0,0.08);border:1px solid rgba(255,165,0,0.25);font-size:9px;color:rgba(255,165,0,0.9);letter-spacing:0.08em;line-height:1.6}
        .lp-faucet a{color:#FFD700;text-decoration:underline}
      `}</style>
      <LiquidityScene />
      <div className="lp-root">
        <div className="lp-hdr">
          <div className="lp-eyebrow">Coverage Pool · Aave V3 Integrated · Sepolia</div>
          <h1 className="lp-h1">Liquidity<br />Vault</h1>
          <p className="lp-hdrsub">
            Deposit USDC to earn yield from Aave V3 while backing protocol coverage. Premium flow boosts LP returns.
            Capital is locked only when active policies require collateral — the rest earns passively.
          </p>
        </div>

        {!isConnected ? (
          <div className="lp-nowallet">
            <div className="lp-nowallet-t">Connect wallet to provide liquidity</div>
          </div>
        ) : (
          <div className="lp-body">
            {/* ══ LEFT ══ */}
            <div className="lp-left">
              <div className="lp-section-hdr" style={{ marginBottom: 16 }}>Protocol Telemetry</div>

              {/* ── WALLET BALANCE CARD (prominent, always visible) ── */}
              <WalletBalanceCard
                balance={usdcBalance as bigint | undefined}
                address={address}
              />

              <div className="lp-metrics">
                <MetricCard label="Total Liquidity"   value={fmtUsdc(totalLiquidity as bigint | undefined)} sub="USDC in vault"          accent="#00ffaa" glow="rgba(0,255,170,0.08)" />
                <MetricCard label="Free Capacity"     value={fmtUsdc(freeLiquidity  as bigint | undefined)} sub="Available for policies"  accent="#00ddff" glow="rgba(0,221,255,0.08)" />
                <MetricCard label="Locked Collateral" value={fmtUsdc(totalLocked    as bigint | undefined)} sub="Backing active coverage" accent="#ff0055" glow="rgba(255,0,85,0.08)"  />
              </div>

              <UtilBar locked={totalLocked as bigint | undefined} total={totalLiquidity as bigint | undefined} />

              <div className="lp-position" style={{ marginTop: 22 }}>
                <div className="lp-section-hdr" style={{ marginBottom: 0 }}>My Position</div>
                <div className="lp-pos-grid">
                  <div className="lp-pos-item"><label>USDC Value</label><span>${fmtUsdc(myUsdcValue as bigint | undefined)}</span></div>
                  <div className="lp-pos-item"><label>ssUSDC Shares</label><span>{fmtShares(myShares as bigint | undefined)}</span></div>
                  <div className="lp-pos-item"><label>Pool Share</label><span>{mySharePct}%</span></div>
                  <div className="lp-pos-item"><label>Max Withdraw</label><span>${fmtUsdc(maxWithdraw as bigint | undefined)}</span></div>
                </div>
                {parseFloat(mySharePct) > 0 && (
                  <div style={{ marginTop: 20 }}>
                    <div style={{ height: 4, borderRadius: 2, background: 'rgba(255,255,255,0.08)', overflow: 'hidden' }}>
                      <div style={{ width: `${Math.min(100, parseFloat(mySharePct) * 4)}%`, background: 'linear-gradient(90deg,rgba(0,255,170,0.6),#00ffaa)', height: '100%', transition: 'width 0.8s ease' }} />
                    </div>
                    <div style={{ marginTop: 8, fontSize: 9, color: 'rgba(255,255,255,0.35)', letterSpacing: '0.12em', fontFamily: "'JetBrains Mono', monospace" }}>YOUR SHARE OF POOL · {mySharePct}%</div>
                  </div>
                )}
              </div>

              <div className="lp-how">
                <div className="lp-section-hdr">How It Works</div>
                {[
                  { n: '01', t: 'Deposit USDC',        b: 'Your USDC enters the vault and is supplied to Aave V3, earning base yield from the lending market immediately.' },
                  { n: '02', t: 'Receive ssUSDC',       b: 'ERC-4626 shares track your proportional claim. Share price grows as Aave yield and premiums accumulate.' },
                  { n: '03', t: 'Back Active Policies', b: 'When a policyholder buys coverage, a portion of the pool is locked as collateral — the rest remains productive.' },
                  { n: '04', t: 'Earn Premium Flow',    b: 'Every premium paid by insured protocols is routed back into the vault, increasing the share price for all LPs.' },
                  { n: '05', t: 'Withdraw Anytime',     b: 'Redeem your shares for USDC + yield at any time, provided liquidity is not fully locked against active policies.' },
                ].map(s => (
                  <div key={s.n} className="lp-step">
                    <div className="lp-step-num">{s.n}</div>
                    <div className="lp-step-body"><h4>{s.t}</h4><p>{s.b}</p></div>
                  </div>
                ))}
              </div>
            </div>

            {/* ══ RIGHT ══ */}
            <div className="lp-right">
              <div className="lp-aave">
                <div className="lp-aave-dot" />
                <span>Yield Powered by Aave V3</span>
                <strong>Sepolia Testnet</strong>
              </div>

              {poolPaused && <div className="lp-banner lp-be">⚠ Pool is currently paused.</div>}
              {txError    && <div className="lp-banner lp-be"><span style={{ flexShrink: 0 }}>⚠</span><span>{txError}</span></div>}
              {txSuccess  && <div className="lp-banner lp-bs"><span style={{ flexShrink: 0 }}>✓</span><span>{txSuccess}</span></div>}
              {(approving || approveWaiting)   && <div className="lp-banner lp-bi"><span className="lp-spin" />{approving ? 'Sign approval in wallet…' : 'Confirming approval…'}</div>}
              {(depositPending || depositWaiting)   && <div className="lp-banner lp-bi"><span className="lp-spin" />{depositPending ? 'Sign deposit in wallet…' : 'Minting ssUSDC shares…'}</div>}
              {(withdrawPending || withdrawWaiting) && <div className="lp-banner lp-bi"><span className="lp-spin" />{withdrawPending ? 'Sign withdrawal in wallet…' : 'Redeeming shares…'}</div>}

              <div className="lp-panel">
                <div className="lp-tabs">
                  <button className={`lp-tab ${tab === 'deposit'  ? 'on' : ''}`} onClick={() => switchTab('deposit')}>Deposit</button>
                  <button className={`lp-tab ${tab === 'withdraw' ? 'on' : ''}`} onClick={() => switchTab('withdraw')}>Withdraw</button>
                </div>
                <div className="lp-form">

                  {/* ── TWO-STEP INDICATOR ── */}
                  {tab === 'deposit' && amountBig > 0n && (
                    <div className="lp-steps-ind">
                      <div className={`lp-step-pill ${!needsApproval ? 'sp-done' : 'sp-act'}`}>{!needsApproval ? '✓ ' : '1 · '}Approve USDC</div>
                      <div className={`lp-step-pill ${!needsApproval ? 'sp-act' : 'sp-idle'}`}>2 · Deposit & Mint</div>
                    </div>
                  )}

                  {/* ── BALANCE BOX ── */}
                  {tab === 'deposit' ? (
                    <div className="lp-bal-box">
                      <div className="lp-bal-row">
                        <span className="lp-bal-label">Your Wallet USDC</span>
                        <span className="lp-bal-amount">
                          {usdcBalance === undefined ? '...' : `${fmtUsdc(usdcBalance as bigint, 4)} USDC`}
                        </span>
                      </div>
                      {usdcBalance !== undefined && (usdcBalance as bigint) === 0n ? (
                        <div className="lp-bal-zero">⚠ No USDC — get test tokens from faucet below</div>
                      ) : (
                        <div className="lp-bal-sub">≈ ${fmtUsdc(usdcBalance as bigint | undefined, 2)} · click MAX to fill</div>
                      )}
                    </div>
                  ) : (
                    <div className="lp-bal-box">
                      <div className="lp-bal-row">
                        <span className="lp-bal-label">Your ssUSDC Shares</span>
                        <span className="lp-bal-amount">{fmtShares(myShares as bigint | undefined)} ssUSDC</span>
                      </div>
                      <div className="lp-bal-sub">≈ ${fmtUsdc(myUsdcValue as bigint | undefined, 4)} USDC value</div>
                    </div>
                  )}

                  {/* ── INPUT ── */}
                  <div className={`lp-input-wrap ${tab === 'deposit' && amountBig > 0n && !hasEnough ? 'warn' : ''}`}>
                    <div className="lp-input-pre">{tab === 'deposit' ? '$' : '≋'}</div>
                    <input
                      className="lp-input"
                      type="number" min="0" step="any"
                      placeholder={tab === 'deposit' ? 'Enter USDC amount…' : 'Enter shares to redeem…'}
                      value={amount}
                      onChange={e => { setAmount(e.target.value); setTxError(null); setApproveConfirmed(false); }}
                      disabled={busy || !!poolPaused}
                    />
                    <div className="lp-input-suf">{tab === 'deposit' ? 'USDC' : 'ssUSDC'}</div>
                  </div>

                  {/* ── INPUT HINT ── */}
                  {tab === 'deposit' && (
                    <div className="lp-input-hint">
                      <span className="lp-hint-avail">
                        Available: {fmtUsdc(usdcBalance as bigint | undefined, 4)} USDC
                      </span>
                      {amountBig > 0n && !hasEnough && (
                        <span className="lp-hint-warn">⚠ Insufficient balance</span>
                      )}
                    </div>
                  )}

                  {/* ── QUICK BUTTONS ── */}
                  <div className="lp-quick">
                    {tab === 'deposit' ? (
                      <>
                        {['10','100','500','1000'].map(v => (
                          <button key={v} className="lp-q" disabled={busy}
                            onClick={() => { setAmount(v); setTxError(null); setApproveConfirmed(false); }}>
                            ${v}
                          </button>
                        ))}
                        <button
                          className="lp-q lp-q-max"
                          disabled={busy || usdcBal === 0n}
                          onClick={setMax}
                        >
                          MAX
                        </button>
                      </>
                    ) : (
                      ['25%','50%','75%','MAX'].map((v, idx) => {
                        const sh = myShares as bigint | undefined;
                        const fr = [0.25, 0.5, 0.75, 1];
                        return (
                          <button key={v} className="lp-q" disabled={busy || !sh}
                            onClick={() => { if (!sh) return; setTxError(null); setAmount((Number(sh * BigInt(Math.round(fr[idx] * 1000)) / 1000n) / 1e12).toFixed(4)); }}>
                            {v}
                          </button>
                        );
                      })
                    )}
                  </div>

                  {/* ── INFO ROWS ── */}
                  {amount && parseFloat(amount) > 0 && (
                    <div style={{ marginBottom: 18 }}>
                      <div className="lp-inforow">
                        <span className="lp-ik">{tab === 'deposit' ? 'You Deposit' : 'You Redeem'}</span>
                        <span className="lp-iv">{tab === 'deposit' ? `$${parseFloat(amount).toLocaleString()} USDC` : `${parseFloat(amount).toLocaleString()} ssUSDC`}</span>
                      </div>
                      {tab === 'deposit' && (
                        <>
                          <div className="lp-inforow">
                            <span className="lp-ik">Wallet Balance</span>
                            <span className="lp-iv" style={{ color: hasEnough ? 'rgba(255,255,255,0.8)' : 'var(--r)' }}>
                              {fmtUsdc(usdcBalance as bigint | undefined, 4)} USDC {!hasEnough && '— insufficient'}
                            </span>
                          </div>
                          <div className="lp-inforow">
                            <span className="lp-ik">Allowance</span>
                            <span className="lp-iv" style={{ color: needsApproval ? 'var(--r)' : 'var(--g)' }}>
                              {needsApproval ? '✗ Approval needed' : '✓ Sufficient'}
                            </span>
                          </div>
                        </>
                      )}
                    </div>
                  )}

                  {/* ── CTA BUTTONS ── */}
                  {tab === 'deposit' ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                      {needsApproval && (
                        <button className="lp-btn lp-btn-emerald"
                          disabled={busy || !amount || !parseFloat(amount) || !!poolPaused || !hasEnough}
                          onClick={handleApprove}>
                          {(approving || approveWaiting)
                            ? <><span className="lp-spin" />{approving ? 'Confirm in wallet…' : 'Approving…'}</>
                            : '① Approve USDC →'
                          }
                        </button>
                      )}
                      {!needsApproval && (
                        <button className="lp-btn lp-btn-white"
                          disabled={busy || !amount || !parseFloat(amount) || !!poolPaused || !hasEnough}
                          onClick={handleDeposit}>
                          {(depositPending || depositWaiting)
                            ? <><span className="lp-spin" style={{ borderTopColor: '#000' }} />{depositPending ? 'Confirm in wallet…' : 'Minting ssUSDC…'}</>
                            : approveConfirmed ? '② Deposit USDC · Mint ssUSDC →' : 'Deposit USDC · Mint ssUSDC →'
                          }
                        </button>
                      )}
                    </div>
                  ) : (
                    <button className="lp-btn lp-btn-red"
                      disabled={busy || !amount || !parseFloat(amount) || !!poolPaused || !(myShares as bigint)}
                      onClick={handleWithdraw}>
                      {(withdrawPending || withdrawWaiting)
                        ? <><span className="lp-spin" style={{ borderTopColor: 'var(--r)' }} />{withdrawPending ? 'Confirm in wallet…' : 'Redeeming…'}</>
                        : 'Redeem Shares · Withdraw USDC →'
                      }
                    </button>
                  )}

                  {/* ── FAUCET LINK ── */}
                  {tab === 'deposit' && usdcBalance !== undefined && (usdcBalance as bigint) === 0n && (
                    <div className="lp-faucet">
                      💧 No test USDC? Get some free from the{' '}
                      <a href="https://staging.aave.com/faucet/" target="_blank" rel="noreferrer">
                        Aave Sepolia Faucet ↗
                      </a>
                      {' '}— connect wallet, select USDC, click "Faucet".
                    </div>
                  )}
                </div>
              </div>

              {/* Pool Details */}
              <div style={{ marginTop: 22, padding: '20px 24px', border: '1px solid rgba(0,255,170,0.1)', borderRadius: 16, background: 'rgba(0,5,15,0.6)', backdropFilter: 'blur(20px)' }}>
                <div className="lp-section-hdr">Pool Details</div>
                {[
                  { k: 'Pool Contract',  v: shortAddr(POOL_ADDR) },
                  { k: 'Share Token',    v: 'ssUSDC (ERC-4626)' },
                  { k: 'Underlying',     v: 'USDC (6 decimals)' },
                  { k: 'Yield Strategy', v: 'Aave V3 Sepolia' },
                  { k: 'Share Decimals', v: '12 (6 + offset)' },
                  { k: 'Status',         v: poolPaused ? '⏸ PAUSED' : '● ACTIVE' },
                ].map(({ k, v }) => (
                  <div key={k} className="lp-inforow">
                    <span className="lp-ik">{k}</span>
                    <span className="lp-iv" style={v.includes('ACTIVE') ? { color: 'var(--g)' } : v.includes('PAUSED') ? { color: 'var(--r)' } : {}}>{v}</span>
                  </div>
                ))}
                <div style={{ marginTop: 16 }}>
                  <a href={`https://sepolia.etherscan.io/address/${POOL_ADDR}`} target="_blank" rel="noreferrer"
                    style={{ fontSize: 9, letterSpacing: '0.12em', textTransform: 'uppercase' as const, color: 'rgba(0,255,170,0.6)', textDecoration: 'none' }}>
                    View on Etherscan ↗
                  </a>
                </div>
              </div>

              {/* Risk notice */}
              <div style={{ marginTop: 16, padding: '16px 20px', border: '1px dashed rgba(255,0,85,0.25)', borderRadius: 12, background: 'rgba(255,0,85,0.03)' }}>
                <div style={{ fontSize: 9, fontWeight: 500, letterSpacing: '0.14em', textTransform: 'uppercase' as const, color: 'rgba(255,0,85,0.6)', marginBottom: 8 }}>⚠ Risk Notice</div>
                <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)', lineHeight: 1.6 }}>
                  Deposited capital may be used to pay out approved claims. If a major exploit is approved by DAO governance, LP positions may be partially drawn down.
                </div>
              </div>
            </div>
          </div>
        )}

        <footer style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '18px 32px', borderTop: '1px solid rgba(0,255,170,0.06)', background: 'rgba(0,5,15,0.5)' }}>
          <span style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 15, textTransform: 'uppercase', color: 'rgba(255,255,255,0.28)' }}>SentinelShield</span>
          <nav style={{ display: 'flex', gap: 16 }}>
            <a href={`https://sepolia.etherscan.io/address/${POOL_ADDR}`} target="_blank" rel="noreferrer" style={{ fontSize: 9, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.25)', textDecoration: 'none' }}>Etherscan</a>
            <Link href="/governance" style={{ fontSize: 9, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.25)', textDecoration: 'none' }}>Governance</Link>
          </nav>
          <span style={{ fontSize: 9, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.18)' }}>Sepolia Testnet</span>
        </footer>
      </div>
    </>
  );
}