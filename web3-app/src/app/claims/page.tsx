'use client';

import React, { useEffect, useRef, useState, useMemo } from 'react';
import Link from 'next/link';
import * as THREE from 'three';
import {
  useAccount,
  useReadContract,
  useWriteContract,
  useWaitForTransactionReceipt,
} from 'wagmi';
import { SENTINEL_ABIS, SENTINEL_ADDRESSES } from '@/constants/contracts';

const GOV_ADDR = SENTINEL_ADDRESSES.CLAIMS_GOVERNOR.toLowerCase() as `0x${string}`;
const ENGINE_ADDR = SENTINEL_ADDRESSES.POLICY_ENGINE.toLowerCase() as `0x${string}`;

// ─── UTILS ───────────────────────────────────────────────────────────────────
const shortAddr = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const fmtUsdc = (v: bigint | undefined) => {
  if (v === undefined) return '0.00';
  const n = Number(v) / 1e6;
  return n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}K` : n.toFixed(2);
};

// ─── THREE.JS "INCIDENT VORTEX" SCENE ────────────────────────────────────────
function IncidentVortexScene() {
  const mountRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    let cancelled = false;

    const W = window.innerWidth;
    const H = window.innerHeight;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(W, H);
    mount.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x000208, 0.0018);

    const camera = new THREE.PerspectiveCamera(45, W / H, 1, 2000);
    camera.position.set(0, 80, 600);

    // Lights
    scene.add(new THREE.AmbientLight(0x0a0f0a, 2.0));
    const pl1 = new THREE.PointLight(0xff003c, 15, 800); pl1.position.set(-150, 100, 50); scene.add(pl1);
    const pl2 = new THREE.PointLight(0x00ffaa, 8, 800);  pl2.position.set(150, -50, -50); scene.add(pl2);

    const vortexGroup = new THREE.Group();
    scene.add(vortexGroup);

    // 1. Shattered Core (Icosahedron)
    const coreGeo = new THREE.IcosahedronGeometry(40, 1);
    const coreMat = new THREE.MeshStandardMaterial({
      color: 0x110000, emissive: 0xff003c, emissiveIntensity: 0.4,
      wireframe: true, transparent: true, opacity: 0.4
    });
    const coreMesh = new THREE.Mesh(coreGeo, coreMat);
    vortexGroup.add(coreMesh);

    // 2. Data Debris (Particles in a funnel)
    const pCount = W > 768 ? 1200 : 500;
    const pGeo = new THREE.BufferGeometry();
    const pPos = new Float32Array(pCount * 3);
    const pCol = new Float32Array(pCount * 3);
    const pMeta = new Float32Array(pCount); // Stores vertical phase

    const cRed = new THREE.Color('#ff003c');
    const cEmerald = new THREE.Color('#00ffaa');

    for (let i = 0; i < pCount; i++) {
      const radius = 60 + Math.random() * 300;
      const theta = Math.random() * Math.PI * 2;
      const y = (Math.random() - 0.5) * 600;
      
      pPos[i * 3] = radius * Math.cos(theta);
      pPos[i * 3 + 1] = y;
      pPos[i * 3 + 2] = radius * Math.sin(theta);
      pMeta[i] = radius; // Store radius for funnel effect calculation

      const mix = Math.random();
      const col = mix > 0.8 ? cEmerald : cRed; // 20% Emerald, 80% Red for incident vibe
      pCol[i * 3] = col.r;
      pCol[i * 3 + 1] = col.g;
      pCol[i * 3 + 2] = col.b;
    }

    pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3));
    pGeo.setAttribute('color', new THREE.BufferAttribute(pCol, 3));

    const pMat = new THREE.PointsMaterial({
      size: 2.5, vertexColors: true, transparent: true, opacity: 0.6,
      blending: THREE.AdditiveBlending, depthWrite: false
    });
    const particles = new THREE.Points(pGeo, pMat);
    vortexGroup.add(particles);

    // Mouse Interaction
    const mouse = { x: 0, y: 0, tx: 0, ty: 0 };
    const onMM = (e: MouseEvent) => { 
      mouse.tx = (e.clientX - W / 2) * 0.05; 
      mouse.ty = (e.clientY - H / 2) * 0.05; 
    };
    window.addEventListener('mousemove', onMM, { passive: true });

    const onResize = () => {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
    };
    window.addEventListener('resize', onResize, { passive: true });

    let raf = 0, clock = 0;
    const tick = () => {
      if (cancelled) return;
      clock += 0.005;

      mouse.x += (mouse.tx - mouse.x) * 0.05;
      mouse.y += (mouse.ty - mouse.y) * 0.05;

      camera.position.x += (mouse.x - camera.position.x) * 0.05;
      camera.position.y += (-mouse.y + 80 - camera.position.y) * 0.05;
      camera.lookAt(0, 0, 0);

      // Vortex Rotation
      vortexGroup.rotation.y = clock * 0.3;
      coreMesh.rotation.x = clock * 0.5;
      coreMesh.rotation.z = clock * 0.2;

      // Pulse Core
      coreMat.emissiveIntensity = 0.3 + Math.sin(clock * 4) * 0.2;

      renderer.render(scene, camera);
      raf = requestAnimationFrame(tick);
    };
    tick();

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      window.removeEventListener('mousemove', onMM);
      window.removeEventListener('resize', onResize);
      if (mount.contains(renderer.domElement)) mount.removeChild(renderer.domElement);
      renderer.dispose();
    };
  }, []);

  return <div style={{ position: 'fixed', inset: 0, zIndex: 0, pointerEvents: 'none' }} ref={mountRef} aria-hidden />;
}

// ─── PAGE COMPONENT ──────────────────────────────────────────────────────────
export default function ClaimsPage() {
  const { address, isConnected } = useAccount();
  const [mounted, setMounted] = useState(false);
  
  // Form State
  const [policyIdStr, setPolicyIdStr] = useState('');
  const [evidenceUri, setEvidenceUri] = useState('');
  const [txError, setTxError] = useState<string | null>(null);
  const [txSuccess, setTxSuccess] = useState<string | null>(null);

  const policyId = useMemo(() => {
    const parsed = parseInt(policyIdStr);
    return isNaN(parsed) ? undefined : BigInt(parsed);
  }, [policyIdStr]);

  useEffect(() => setMounted(true), []);

  // Read: Governor Metrics
  const { data: totalClaims, refetch: refetchTotal } = useReadContract({
    address: GOV_ADDR, abi: SENTINEL_ABIS.CLAIMS_GOVERNOR, functionName: 'totalClaims',
  });

  // Read: Live Policy Validation
  const { data: policyData, isFetching: policyLoading } = useReadContract({
    address: ENGINE_ADDR, abi: SENTINEL_ABIS.POLICY_ENGINE, functionName: 'getPolicy',
    args: policyId !== undefined ? [policyId] : undefined,
    query: { enabled: policyId !== undefined }
  });

  // Write: File Claim
  const { writeContract, isPending: txPending, data: txHash } = useWriteContract();
  const { isLoading: txConfirming, isSuccess: txConfirmed } = useWaitForTransactionReceipt({ hash: txHash });

  useEffect(() => {
    if (!txConfirmed) return;
    setTxSuccess(`✓ Incident log submitted. DAO Adjudication started.`);
    setPolicyIdStr('');
    setEvidenceUri('');
    refetchTotal();
    setTimeout(() => setTxSuccess(null), 8000);
  }, [txConfirmed, refetchTotal]);

  // Validation Flags based on live chain data
  const isHolder = policyData && address && (policyData as any).holder.toLowerCase() === address.toLowerCase();
  const isActive = policyData && (policyData as any).status === 0; // 0 = ACTIVE
  const uriValid = evidenceUri.trim().length >= 10;
  
  const canSubmit = isConnected && policyId !== undefined && isHolder && isActive && uriValid;

  const handleFileClaim = (e: React.FormEvent) => {
    e.preventDefault();
    setTxError(null); setTxSuccess(null);

    if (!canSubmit) {
      setTxError('System Invariant Error: Pre-flight checks failed. Verify policy ID and ownership.');
      return;
    }

    writeContract({
      address: GOV_ADDR,
      abi: SENTINEL_ABIS.CLAIMS_GOVERNOR,
      functionName: 'fileClaim',
      args: [policyId, evidenceUri.trim()]
    }, {
      onError: (err: any) => {
        const msg = err?.shortMessage ?? err?.message ?? String(err);
        if (msg.toLowerCase().includes('claimalreadyexists')) {
          setTxError('Adjudication Error: A claim workflow has already been generated for this specific Policy ID.');
        } else if (msg.toLowerCase().includes('claimantnotholder')) {
          setTxError('Authorization Error: Connected wallet does not match the on-chain Policy holder.');
        } else if (msg.toLowerCase().includes('policynotactive')) {
          setTxError('Lifecycle Error: Target policy is not in an ACTIVE status envelope.');
        } else if (msg.toLowerCase().includes('evidencetooshort')) {
          setTxError('Validation Error: Evidence URI must be at least 10 characters.');
        } else {
          setTxError(msg.split('\n')[0].slice(0, 180));
        }
      }
    });
  };

  if (!mounted) return <main suppressHydrationWarning style={{ minHeight: '100vh', background: '#000208' }} />;

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,600;0,700;1,600;1,700&family=JetBrains+Mono:wght@400;600;800&family=Space+Grotesk:wght@400;700&display=swap');
        
        body { background: #000208; color: #fff; margin: 0; font-family: 'JetBrains Mono', monospace; }
        
        .cl-wrapper { position: relative; z-index: 10; min-height: 100vh; padding: 140px 24px 80px; max-width: 1200px; margin: 0 auto; display: grid; grid-template-columns: 1.3fr 0.7fr; gap: 40px; }
        @media(max-width: 960px) { .cl-wrapper { grid-template-columns: 1fr; padding-top: 110px; } }
        
        .cl-h1 { font-family: 'Cormorant Garamond', Georgia, serif; font-size: clamp(42px, 6vw, 76px); font-style: italic; font-weight: 700; line-height: 0.95; margin-bottom: 16px; background: linear-gradient(180deg, #fff 0%, #ff003c 100%); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
        .cl-lead { color: rgba(255, 255, 255, 0.55); font-family: 'Space Grotesk', sans-serif; font-size: 15px; line-height: 1.6; margin-bottom: 34px; max-width: 580px; }
        
        .cl-panel { background: rgba(5, 8, 15, 0.6); border: 1px solid rgba(255, 0, 60, 0.2); border-radius: 24px; padding: 36px; backdrop-filter: blur(24px); -webkit-backdrop-filter: blur(24px); box-shadow: 0 20px 80px rgba(0,0,0,0.8), inset 0 1px 0 rgba(255,255,255,0.05); }
        .cl-input-group { margin-bottom: 24px; }
        .cl-label { display: flex; justify-content: space-between; font-size: 10px; font-weight: 800; letter-spacing: 0.15em; text-transform: uppercase; color: rgba(255, 0, 60, 0.8); margin-bottom: 12px; }
        .cl-input { width: 100%; background: rgba(0, 0, 0, 0.5); border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 12px; padding: 16px 20px; color: #fff; font-family: 'JetBrains Mono', monospace; font-size: 16px; outline: none; transition: all 0.3s ease; box-sizing: border-box; }
        .cl-input:focus { border-color: #ff003c; box-shadow: 0 0 24px rgba(255, 0, 60, 0.15); }
        
        .cl-btn { width: 100%; padding: 20px; border: none; border-radius: 12px; font-family: 'JetBrains Mono', monospace; font-size: 13px; font-weight: 800; letter-spacing: 0.12em; text-transform: uppercase; color: #fff; background: linear-gradient(90deg, #ff003c, #cc0030); cursor: pointer; transition: all 0.3s ease; box-shadow: 0 8px 30px rgba(255, 0, 60, 0.35); display: flex; align-items: center; justify-content: center; gap: 10px; margin-top: 10px; }
        .cl-btn:hover:not(:disabled) { transform: translateY(-2px); box-shadow: 0 12px 40px rgba(255, 0, 60, 0.5); }
        .cl-btn:disabled { opacity: 0.25; cursor: not-allowed; box-shadow: none; filter: grayscale(100%); }
        
        .cl-banner { padding: 16px 20px; border-radius: 12px; font-size: 12px; line-height: 1.5; margin-bottom: 24px; display: flex; align-items: center; gap: 12px; }
        .cl-banner.err { background: rgba(255, 0, 60, 0.1); color: #ff003c; border: 1px solid rgba(255, 0, 60, 0.3); }
        .cl-banner.succ { background: rgba(0, 255, 170, 0.1); color: #00ffaa; border: 1px solid rgba(0, 255, 170, 0.3); }
        .cl-banner.info { background: rgba(255, 215, 0, 0.1); color: #FFD700; border: 1px solid rgba(255, 215, 0, 0.3); }
        
        .cl-spin { width: 16px; height: 16px; border-radius: 50%; border: 2px solid rgba(255,255,255,0.2); border-top-color: currentColor; animation: clspin 0.8s linear infinite; }
        @keyframes clspin { to { transform: rotate(360deg); } }
        
        .cl-sidebar-card { background: rgba(5, 8, 15, 0.6); border: 1px solid rgba(255,255,255,0.06); border-radius: 20px; padding: 28px; margin-bottom: 20px; backdrop-filter: blur(20px); }
        .cl-sidebar-title { font-family: 'Cormorant Garamond', serif; font-size: 24px; font-style: italic; font-weight: 700; color: #fff; margin-bottom: 16px; }
        .cl-inforow { display: flex; justify-content: space-between; padding: 12px 0; border-bottom: 1px solid rgba(255,255,255,0.04); font-size: 11px; letter-spacing: 0.05em; }
        .cl-inforow:last-child { border-bottom: none; }
        .cl-ik { color: rgba(255,255,255,0.4); text-transform: uppercase; font-weight: 600; }
        .cl-iv { color: rgba(255,255,255,0.9); font-weight: 800; text-align: right; }
        
        .cl-policy-check { padding: 16px; border-radius: 12px; background: rgba(0,0,0,0.4); border: 1px solid rgba(255,255,255,0.05); margin-bottom: 24px; }
        .cl-check-row { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; font-size: 11px; }
        .cl-check-row:last-child { margin-bottom: 0; }
        .cl-tag-pass { color: #00ffaa; background: rgba(0,255,170,0.1); padding: 2px 8px; border-radius: 4px; }
        .cl-tag-fail { color: #ff003c; background: rgba(255,0,60,0.1); padding: 2px 8px; border-radius: 4px; }
      `}</style>

      <IncidentVortexScene />

      <div className="cl-wrapper">
        {/* LEFT COMPONENT: CLAIM SUBMISSION ENGINE */}
        <div>
          <div style={{ display: 'inline-block', padding: '4px 12px', background: 'rgba(255,0,60,0.1)', border: '1px solid rgba(255,0,60,0.3)', borderRadius: '100px', color: '#ff003c', fontSize: '10px', fontWeight: 800, letterSpacing: '0.15em', marginBottom: '16px' }}>
            <span style={{ display: 'inline-block', width: '6px', height: '6px', background: '#ff003c', borderRadius: '50%', marginRight: '8px', boxShadow: '0 0 10px #ff003c' }} />
            INCIDENT RESPONSE PROTOCOL
          </div>
          <h1 className="cl-h1">File Exploit Claim</h1>
          <p className="cl-lead">
            Initiate a cryptographic resolution log if a protected protocol has suffered a structural exploit. 
            Submissions lock an immutable snapshot block (`block.number - 1`) for DAO adjudication.
          </p>

          {!isConnected ? (
            <div className="cl-panel" style={{ textAlign: 'center', padding: '60px 40px' }}>
              <div style={{ color: 'rgba(255, 255, 255, 0.4)', fontSize: '14px', fontFamily: "'Space Grotesk', sans-serif" }}>
                Awaiting connection matrix. Connect wallet to resolve on-chain assets.
              </div>
            </div>
          ) : (
            <div className="cl-panel">
              <h3 style={{ fontFamily: "'Cormorant Garamond', serif", fontStyle: 'italic', fontSize: '32px', color: '#fff', marginBottom: '24px', marginTop: 0 }}>
                Adjudication Gateway
              </h3>

              {txError && <div className="cl-banner err">⚠ {txError}</div>}
              {txSuccess && <div className="cl-banner succ">✓ {txSuccess}</div>}
              {(txPending || txConfirming) && (
                <div className="cl-banner info">
                  <span className="cl-spin" />
                  {txPending ? 'Awaiting cryptographic signature in wallet...' : 'Synchronizing claim onto EVM blocks...'}
                </div>
              )}

              <form onSubmit={handleFileClaim}>
                <div className="cl-input-group">
                  <div className="cl-label">
                    <span>Target Policy ID</span>
                    <span style={{ color: policyIdStr ? '#00ffaa' : '' }}>{policyIdStr ? 'Found' : 'Required *'}</span>
                  </div>
                  <input
                    className="cl-input"
                    type="number"
                    min="0"
                    placeholder="e.g. 0, 1, 2"
                    value={policyIdStr}
                    onChange={e => setPolicyIdStr(e.target.value)}
                    disabled={txPending || txConfirming}
                  />
                </div>

                {/* DYNAMIC POLICY VALIDATION BOX */}
                {policyIdStr !== '' && (
                  <div className="cl-policy-check">
                    {policyLoading ? (
                      <div style={{ fontSize: '11px', color: '#FFD700', display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span className="cl-spin" /> Querying blockchain state...
                      </div>
                    ) : policyData ? (
                      <>
                        <div className="cl-check-row">
                          <span style={{ color: 'rgba(255,255,255,0.4)' }}>Coverage Locked:</span>
                          <span style={{ color: '#FFD700', fontWeight: 800 }}>${fmtUsdc((policyData as any).coverageAmount)} USDC</span>
                        </div>
                        <div className="cl-check-row">
                          <span style={{ color: 'rgba(255,255,255,0.4)' }}>Ownership Auth:</span>
                          {isHolder 
                            ? <span className="cl-tag-pass">VERIFIED</span> 
                            : <span className="cl-tag-fail">UNAUTHORIZED ({shortAddr((policyData as any).holder)})</span>}
                        </div>
                        <div className="cl-check-row">
                          <span style={{ color: 'rgba(255,255,255,0.4)' }}>Policy Lifecycle:</span>
                          {isActive 
                            ? <span className="cl-tag-pass">ACTIVE</span> 
                            : <span className="cl-tag-fail">INVALID STATE ({(policyData as any).status})</span>}
                        </div>
                      </>
                    ) : (
                      <div style={{ fontSize: '11px', color: '#ff003c' }}>⚠ Policy not found on registry.</div>
                    )}
                  </div>
                )}

                <div className="cl-input-group">
                  <div className="cl-label">
                    <span>Evidence Pointer (IPFS / Arweave URI)</span>
                    <span style={{ color: uriValid ? '#00ffaa' : '' }}>Min 10 chars *</span>
                  </div>
                  <input
                    className="cl-input"
                    placeholder="ipfs://Qm... or ar://..."
                    value={evidenceUri}
                    onChange={e => setEvidenceUri(e.target.value)}
                    disabled={txPending || txConfirming}
                  />
                  <div style={{ fontSize: '9px', color: 'rgba(255,255,255,0.3)', marginTop: '8px', lineHeight: '1.4' }}>
                    * Must contain exploit transaction hashes, audit post-mortems, and loss calculations.
                  </div>
                </div>

                <button
                  type="submit"
                  className="cl-btn"
                  disabled={!canSubmit || txPending || txConfirming}
                >
                  {txPending || txConfirming ? (
                    <><span className="cl-spin" /> Processing Matrix...</>
                  ) : (
                    'Submit Claim to DAO Consensus →'
                  )}
                </button>
              </form>
            </div>
          )}
        </div>

        {/* RIGHT COMPONENT: METRICS & SAFEGUARDS */}
        <div>
          <div className="cl-sidebar-card" style={{ borderTop: '3px solid #00ffaa' }}>
            <div className="cl-sidebar-title">Global Adjudication</div>
            <div className="cl-inforow">
              <span className="cl-ik">Total Historical Claims</span>
              <span className="cl-iv" style={{ color: '#00ffaa' }}>
                {totalClaims !== undefined ? Number(totalClaims).toLocaleString() : '...'}
              </span>
            </div>
            <div className="cl-inforow">
              <span className="cl-ik">Consensus Window</span>
              <span className="cl-iv">7 Days Standard</span>
            </div>
            <div className="cl-inforow">
              <span className="cl-ik">Voting Invariant</span>
              <span className="cl-iv" style={{ color: '#FFD700' }}>Checkpoint (N-1)</span>
            </div>
          </div>

          <div className="cl-sidebar-card">
            <div className="cl-sidebar-title">Adjudication Integrity</div>
            <p style={{ fontSize: '12px', color: 'rgba(255,255,255,0.5)', fontFamily: "'Space Grotesk', sans-serif", lineHeight: '1.6', margin: '0 0 16px' }}>
              SentinelShield utilizes absolute block-snapshotting to structurally isolate claim consensus from same-block flash loans.
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {[
                'CEI Execution Pattern Applied En-bloc',
                'Snapshot Weights Hardlocked at T-1',
                '2-of-3 Guardian Veto Valve Capable'
              ].map((inv, idx) => (
                <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '10px', color: 'rgba(255,255,255,0.7)', textTransform: 'uppercase' }}>
                  <span style={{ color: '#ff003c', fontSize: '14px' }}>◆</span> {inv}
                </div>
              ))}
            </div>
          </div>

          <div className="cl-sidebar-card" style={{ background: 'rgba(255,0,60,0.03)', border: '1px dashed rgba(255,0,60,0.3)' }}>
            <div className="cl-sidebar-title" style={{ color: '#ff003c', fontSize: '14px' }}>⚠ Solvency Notice</div>
            <p style={{ fontSize: '12px', color: 'rgba(255,255,255,0.5)', fontFamily: "'Space Grotesk', sans-serif", lineHeight: '1.6', margin: 0 }}>
              Filing fraudulent logs triggers immediate voting slashing conditions if veto thresholds are hit. Ensure decentralized evidence pointers match live block parameters perfectly.
            </p>
          </div>
        </div>
      </div>

      {/* FOOTER METRICS LAYER */}
      <footer style={{ position: 'relative', zIndex: 10, display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '24px 40px', borderTop: '1px solid rgba(255,255,255,0.05)', background: 'rgba(1, 2, 8, 0.8)', backdropFilter: 'blur(20px)' }}>
        <span style={{ fontSize: '10px', fontWeight: 800, color: 'rgba(255,255,255,0.3)', letterSpacing: '0.15em', textTransform: 'uppercase' }}>SentinelShield Framework</span>
        <nav style={{ display: 'flex', gap: '24px', fontSize: '10px', fontWeight: 800, letterSpacing: '0.1em', textTransform: 'uppercase' }}>
          <Link href="/" style={{ color: 'rgba(255,255,255,0.4)', textDecoration: 'none', transition: 'color 0.2s' }}>Dashboard</Link>
          <Link href="/governance" style={{ color: 'rgba(255,255,255,0.4)', textDecoration: 'none', transition: 'color 0.2s' }}>Governance Console</Link>
        </nav>
        <span style={{ fontSize: '10px', fontWeight: 800, color: '#00ffaa', letterSpacing: '0.1em', textTransform: 'uppercase' }}>Sepolia Verified</span>
      </footer>
    </>
  );
}