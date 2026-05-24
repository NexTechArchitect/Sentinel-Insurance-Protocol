
'use client';

import React, { useEffect, useRef, useState, useCallback } from 'react';
import Link from 'next/link';
import * as THREE from 'three';
import { useAccount, useReadContract } from 'wagmi';
import { SENTINEL_ABIS, SENTINEL_ADDRESSES } from '@/constants/contracts';

type AddressKey = keyof typeof SENTINEL_ADDRESSES;

type Planet = {
  name: string; key: AddressKey; role: string; desc: string;
  orbit: number; ecc: number; inc: number; lan: number;
  spd: number; phase: number; radius: number; color: string;
};

const PLANETS: Planet[] = [
  { name: 'PolicyEngine',   key: 'POLICY_ENGINE',   role: 'Policy core', desc: 'Quotes risk and mints coverage.',      orbit: 110, ecc: 0.05, inc: 0.16, lan: 0,   spd: 0.08,  phase: 0,   radius: 4.8, color: '#ffc676' },
  { name: 'CoveragePool',   key: 'COVERAGE_POOL',   role: 'Liquidity',   desc: 'Locks collateral and routes capital.',  orbit: 160, ecc: 0.07, inc: 0.28, lan: 0.9, spd: 0.06,  phase: 1.4, radius: 6.8, color: '#58daff' },
  { name: 'RiskRegistry',   key: 'RISK_REGISTRY',   role: 'Risk map',    desc: 'Stores premium curves and limits.',     orbit: 210, ecc: 0.03, inc: 0.12, lan: 1.8, spd: 0.045, phase: 2.8, radius: 5.0, color: '#c484ff' },
  { name: 'ClaimsGovernor', key: 'CLAIMS_GOVERNOR', role: 'Claims',      desc: 'Coordinates evidence and voting.',      orbit: 260, ecc: 0.10, inc: 0.35, lan: 2.7, spd: 0.032, phase: 0.7, radius: 6.5, color: '#ff687c' },
  { name: 'ShieldToken',    key: 'SHIELD_TOKEN',    role: 'Voting',      desc: 'Carries governance power.',             orbit: 315, ecc: 0.06, inc: 0.20, lan: 3.6, spd: 0.024, phase: 3.5, radius: 5.8, color: '#4af5b2' },
  { name: 'VetoCouncil',    key: 'VETO_COUNCIL',    role: 'Defense',     desc: 'Emergency protocol circuit.',           orbit: 370, ecc: 0.05, inc: 0.40, lan: 4.5, spd: 0.018, phase: 1.9, radius: 4.8, color: '#ffae48' },
  { name: 'PolicyNFT',      key: 'POLICY_NFT',      role: 'Identity',    desc: 'Represents policy ownership.',          orbit: 425, ecc: 0.02, inc: 0.10, lan: 5.4, spd: 0.012, phase: 4.2, radius: 6.0, color: '#b2c6ff' },
  { name: 'PayoutExecutor', key: 'PAYOUT_EXECUTOR', role: 'Recovery',    desc: 'Executes approved payouts.',            orbit: 485, ecc: 0.03, inc: 0.22, lan: 6.1, spd: 0.009, phase: 5.1, radius: 5.8, color: '#ffec84' },
];

const FLOW = [
  { num: '01', title: 'Quote',      body: 'Coverage is priced from live protocol risk and pool capacity.',       color: '88,218,255'  },
  { num: '02', title: 'Underwrite', body: 'Capital is reserved while liquidity remains productive.',             color: '255,198,118' },
  { num: '03', title: 'Govern',     body: 'Evidence enters voting and emergency protocol controls.',             color: '196,132,255' },
  { num: '04', title: 'Recover',    body: 'Approved claims return value after exploit gravity hits.',            color: '74,245,178'  },
];

function shortAddr(key: AddressKey) {
  const a = SENTINEL_ADDRESSES[key];
  return `${a.slice(0,6)}...${a.slice(-4)}`;
}

function smoothstep(edge0: number, edge1: number, x: number) {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

function orbitVector(p: Planet, time: number) {
  const angle = p.phase + time * p.spd;
  const r = (p.orbit * (1 - p.ecc * p.ecc)) / (1 + p.ecc * Math.cos(angle));
  const xO = r * Math.cos(angle); const zO = r * Math.sin(angle);
  const cosI = Math.cos(p.inc), sinI = Math.sin(p.inc);
  const cosL = Math.cos(p.lan), sinL = Math.sin(p.lan);
  return new THREE.Vector3(cosL*xO - sinL*zO*cosI, zO*sinI, sinL*xO + cosL*zO*cosI);
}

function makeGlowTexture(res = 256, innerAlpha = 1.0): THREE.Texture {
  const c = document.createElement('canvas'); c.width = c.height = res;
  const ctx = c.getContext('2d')!; const half = res/2;
  const g = ctx.createRadialGradient(half,half,0,half,half,half);
  g.addColorStop(0,   `rgba(255,255,255,${innerAlpha})`);
  g.addColorStop(0.10,`rgba(255,255,255,${innerAlpha*0.80})`);
  g.addColorStop(0.30,`rgba(255,255,255,${innerAlpha*0.22})`);
  g.addColorStop(0.60,'rgba(255,255,255,0.05)');
  g.addColorStop(1,   'rgba(255,255,255,0)');
  ctx.fillStyle=g; ctx.fillRect(0,0,res,res);
  return new THREE.CanvasTexture(c);
}

function makeRingHaloTexture(): THREE.Texture {
  const c = document.createElement('canvas'); c.width=c.height=256;
  const ctx=c.getContext('2d')!;
  const g=ctx.createRadialGradient(128,128,74,128,128,128);
  g.addColorStop(0,'rgba(255,255,255,0)'); g.addColorStop(0.5,'rgba(255,255,255,0.06)');
  g.addColorStop(0.76,'rgba(255,255,255,0.50)'); g.addColorStop(0.9,'rgba(255,255,255,0.14)');
  g.addColorStop(1,'rgba(255,255,255,0)');
  ctx.fillStyle=g; ctx.fillRect(0,0,256,256);
  return new THREE.CanvasTexture(c);
}

async function makeLabelTextureAsync(text: string, color: string): Promise<THREE.Texture> {
  try { await document.fonts.ready; } catch {}
  const W=2048,H=256;
  const canvas=document.createElement('canvas'); canvas.width=W; canvas.height=H;
  const ctx=canvas.getContext('2d')!; ctx.clearRect(0,0,W,H);
  const fontStr='900 96px "JetBrains Mono", monospace';
  ctx.font=fontStr;
  const tw=ctx.measureText(text).width;
  const pillPad=36,pillH=108,pillR=16;
  const pillX=W/2-tw/2-pillPad, pillW=tw+pillPad*2, pillY=H/2-pillH/2;
  ctx.beginPath(); ctx.moveTo(pillX+pillR,pillY); ctx.lineTo(pillX+pillW-pillR,pillY);
  ctx.arcTo(pillX+pillW,pillY,pillX+pillW,pillY+pillR,pillR);
  ctx.lineTo(pillX+pillW,pillY+pillH-pillR);
  ctx.arcTo(pillX+pillW,pillY+pillH,pillX+pillW-pillR,pillY+pillH,pillR);
  ctx.lineTo(pillX+pillR,pillY+pillH);
  ctx.arcTo(pillX,pillY+pillH,pillX,pillY+pillH-pillR,pillR);
  ctx.lineTo(pillX,pillY+pillR); ctx.arcTo(pillX,pillY,pillX+pillR,pillY,pillR);
  ctx.closePath(); ctx.fillStyle='rgba(0,3,12,0.82)'; ctx.fill();
  ctx.strokeStyle=color+'55'; ctx.lineWidth=2; ctx.stroke();
  ctx.font=fontStr; ctx.textAlign='center'; ctx.textBaseline='middle';
  ctx.shadowColor=color; ctx.shadowBlur=8; ctx.fillStyle=color;
  ctx.fillText(text,W/2,H/2-2); ctx.shadowBlur=0; ctx.globalAlpha=0.96;
  ctx.fillText(text,W/2,H/2-2); ctx.globalAlpha=1;
  const tex=new THREE.CanvasTexture(canvas);
  tex.minFilter=THREE.LinearFilter; tex.magFilter=THREE.LinearFilter;
  tex.generateMipmaps=false; tex.anisotropy=16; tex.needsUpdate=true;
  return tex;
}

function rand(min:number,max:number){return min+Math.random()*(max-min);}

// ─── THREE.js scene — ONLY rendered on desktop ────────────────────────────────
function CinematicScene() {
  const mountRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const mount = mountRef.current; if (!mount) return;
    let cancelled = false;

    const renderer = new THREE.WebGLRenderer({ antialias:true, alpha:true, powerPreference:'high-performance' });
    renderer.setClearColor(0,0);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio??1, 2.5));
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.outputColorSpace=THREE.SRGBColorSpace;
    renderer.toneMapping=THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure=1.22;
    mount.appendChild(renderer.domElement);

    const scene=new THREE.Scene(); scene.fog=new THREE.FogExp2(0x010208,0.00082);
    const camera=new THREE.PerspectiveCamera(42,window.innerWidth/window.innerHeight,0.5,5000);
    camera.position.set(-30,100,790); camera.lookAt(0,0,0);

    scene.add(new THREE.AmbientLight(0x1a2840,1.5));
    const kl=new THREE.PointLight(0x58daff,8,1400); kl.position.set(-80,60,120); scene.add(kl);
    const fl=new THREE.PointLight(0xc484ff,5,1000); fl.position.set(160,-40,80); scene.add(fl);
    scene.add(new THREE.PointLight(0xffc676,3,800)).position.set(0,-130,-300);
    const satL=new THREE.PointLight(0x88ccff,6,300); satL.position.set(-60,80,150); scene.add(satL);

    const root=new THREE.Group(); root.position.x=-155; scene.add(root);
    const textures:THREE.Texture[]=[];
    const glowTex=makeGlowTexture(256,1.0); textures.push(glowTex);
    const softTex=makeGlowTexture(256,0.50); textures.push(softTex);
    const wideTex=makeGlowTexture(256,0.22); textures.push(wideTex);
    const ringTex=makeRingHaloTexture(); textures.push(ringTex);

    // Stars
    const starLayers=[{n:3400,rMin:650,rMax:2000,sz:0.85,op:0.60,spd:0.00018},{n:1600,rMin:320,rMax:720,sz:1.30,op:0.40,spd:0.00042},{n:620,rMin:180,rMax:360,sz:2.00,op:0.26,spd:0.00085}];
    const starGroups:THREE.Points[]=[];
    const sPalette=[new THREE.Color('#58daff'),new THREE.Color('#c484ff'),new THREE.Color('#b2c6ff'),new THREE.Color('#ffffff')];
    starLayers.forEach(({n,rMin,rMax,sz,op,spd})=>{
      const pos=new Float32Array(n*3),col=new Float32Array(n*3);
      for(let i=0;i<n;i++){const theta=Math.random()*Math.PI*2,phi=Math.acos(2*Math.random()-1),r=rand(rMin,rMax);pos[i*3]=r*Math.sin(phi)*Math.cos(theta);pos[i*3+1]=r*Math.cos(phi)*0.44;pos[i*3+2]=r*Math.sin(phi)*Math.sin(theta);const c=sPalette[Math.floor(Math.random()*4)],b=0.45+Math.random()*0.55;col[i*3]=c.r*b;col[i*3+1]=c.g*b;col[i*3+2]=c.b*b;}
      const geo=new THREE.BufferGeometry(); geo.setAttribute('position',new THREE.BufferAttribute(pos,3)); geo.setAttribute('color',new THREE.BufferAttribute(col,3));
      const pts=new THREE.Points(geo,new THREE.PointsMaterial({size:sz,vertexColors:true,transparent:true,opacity:op,blending:THREE.AdditiveBlending,depthWrite:false,sizeAttenuation:true}));
      pts.userData.spd=spd; scene.add(pts); starGroups.push(pts);
    });

    // Nebula
    const nebulaGroup=new THREE.Group(); root.add(nebulaGroup);
    {const n=2400,pos=new Float32Array(n*3),col=new Float32Array(n*3);
    for(let i=0;i<n;i++){const r=80+Math.pow(Math.random(),1.8)*260,theta=Math.random()*Math.PI*2,phi=Math.acos(2*Math.random()-1);pos[i*3]=r*Math.sin(phi)*Math.cos(theta);pos[i*3+1]=r*Math.cos(phi)*0.28;pos[i*3+2]=r*Math.sin(phi)*Math.sin(theta);const c=Math.random()<0.6?new THREE.Color('#58daff'):new THREE.Color('#c484ff');col[i*3]=c.r*0.45;col[i*3+1]=c.g*0.45;col[i*3+2]=c.b*0.45;}
    const geo=new THREE.BufferGeometry(); geo.setAttribute('position',new THREE.BufferAttribute(pos,3)); geo.setAttribute('color',new THREE.BufferAttribute(col,3));
    nebulaGroup.add(new THREE.Points(geo,new THREE.PointsMaterial({size:0.95,vertexColors:true,transparent:true,opacity:0.45,blending:THREE.AdditiveBlending,depthWrite:false})));}

    // Saturn
    const saturnGroup=new THREE.Group(); nebulaGroup.add(saturnGroup);
    const sc=document.createElement('canvas'); sc.width=1024; sc.height=512;
    const sx=sc.getContext('2d')!;
    const sg=sx.createLinearGradient(0,0,0,512);
    ['#0d1f3a','#112444','#1a3a5e','#0f2d52','#112850','#1c3c5c','#0d2040','#09182e'].forEach((c,i,a)=>sg.addColorStop(i/(a.length-1),c));
    sx.fillStyle=sg; sx.fillRect(0,0,1024,512);
    [[0.08,0.04,'rgba(88,218,255,0.18)'],[0.18,0.06,'rgba(44,130,200,0.22)'],[0.32,0.08,'rgba(30,100,180,0.14)'],[0.48,0.04,'rgba(88,218,255,0.12)'],[0.60,0.07,'rgba(60,160,220,0.18)'],[0.74,0.05,'rgba(40,120,190,0.16)'],[0.88,0.04,'rgba(80,200,240,0.10)']].forEach(([y,h,col])=>{sx.fillStyle=col as string;sx.fillRect(0,(y as number)*512,1024,(h as number)*512);});
    const sTex=new THREE.CanvasTexture(sc); textures.push(sTex);
    const saturnBody=new THREE.Mesh(new THREE.SphereGeometry(26,128,64),new THREE.MeshStandardMaterial({map:sTex,emissiveMap:sTex,emissive:new THREE.Color('#1a4a7a'),emissiveIntensity:0.45,metalness:0.05,roughness:0.62}));
    saturnGroup.add(saturnBody);
    saturnGroup.add(new THREE.Mesh(new THREE.SphereGeometry(28.5,64,32),new THREE.MeshStandardMaterial({color:'#2a6aaa',emissive:new THREE.Color('#58daff'),emissiveIntensity:0.50,transparent:true,opacity:0.22,side:THREE.BackSide})));
    saturnGroup.add(new THREE.Mesh(new THREE.SphereGeometry(26.1,64,32),new THREE.MeshStandardMaterial({color:'#000820',transparent:true,opacity:0.28,side:THREE.FrontSide,depthWrite:false})));

    // Rings
    const makeRingTex=(col:string,op:number)=>{const rc=document.createElement('canvas');rc.width=512;rc.height=1;const rCtx=rc.getContext('2d')!;const rg=rCtx.createLinearGradient(0,0,512,0);const c=new THREE.Color(col);const r=Math.round(c.r*255),g2=Math.round(c.g*255),b=Math.round(c.b*255);rg.addColorStop(0,`rgba(${r},${g2},${b},0)`);rg.addColorStop(0.05,`rgba(${r},${g2},${b},${op})`);rg.addColorStop(0.95,`rgba(${r},${g2},${b},${op*0.7})`);rg.addColorStop(1,`rgba(${r},${g2},${b},0)`);rCtx.fillStyle=rg;rCtx.fillRect(0,0,512,1);const t=new THREE.CanvasTexture(rc);t.wrapS=THREE.RepeatWrapping;textures.push(t);return t;};
    [{iR:32,oR:46,col:'#58daff',op:0.55},{iR:48,oR:65,col:'#a0ccee',op:0.48},{iR:67,oR:80,col:'#c484ff',op:0.32},{iR:82,oR:90,col:'#b2c6ff',op:0.18}].forEach(({iR,oR,col,op})=>{
      const segs=256,verts:number[]=[],uvs:number[]=[],idxs:number[]=[];
      for(let i=0;i<=segs;i++){const a=(i/segs)*Math.PI*2;verts.push(iR*Math.cos(a),0,iR*Math.sin(a));uvs.push(0,i/segs);verts.push(oR*Math.cos(a),0,oR*Math.sin(a));uvs.push(1,i/segs);}
      for(let i=0;i<segs;i++){const b=i*2;idxs.push(b,b+1,b+2,b+1,b+3,b+2);}
      const rGeo=new THREE.BufferGeometry(); rGeo.setAttribute('position',new THREE.Float32BufferAttribute(verts,3)); rGeo.setAttribute('uv',new THREE.Float32BufferAttribute(uvs,2)); rGeo.setIndex(idxs); rGeo.computeVertexNormals();
      const rt=makeRingTex(col,op);
      const rm=new THREE.Mesh(rGeo,new THREE.MeshStandardMaterial({map:rt,alphaMap:rt,emissive:new THREE.Color(col),emissiveIntensity:0.30,transparent:true,opacity:1,side:THREE.DoubleSide,metalness:0,roughness:0.8,depthWrite:false,alphaTest:0.01}));
      rm.rotation.x=0.46; saturnGroup.add(rm);
    });
    const coreHalo=new THREE.Sprite(new THREE.SpriteMaterial({map:wideTex,color:new THREE.Color('#3888cc'),transparent:true,opacity:0.22,blending:THREE.AdditiveBlending,depthWrite:false}));
    coreHalo.scale.set(320,320,1); nebulaGroup.add(coreHalo);

    // Aurora
    interface AuroraLayer{pts:THREE.Points;buf:Float32Array;meta:Array<{r:number;theta:number;y:number;phase:number;spd:number}>;}
    const auroraLayers:AuroraLayer[]=[];
    [{n:550,col:new THREE.Color('#58daff'),yRange:[-22,22],rRange:[130,340],sRange:[0.03,0.07]},{n:380,col:new THREE.Color('#c484ff'),yRange:[-45,12],rRange:[185,420],sRange:[0.022,0.055]},{n:260,col:new THREE.Color('#4af5b2'),yRange:[12,58],rRange:[100,270],sRange:[0.038,0.09]}].forEach(({n,col,yRange,rRange,sRange})=>{
      const buf=new Float32Array(n*3),meta=Array.from({length:n},()=>({r:rand(rRange[0],rRange[1]),theta:Math.random()*Math.PI*2,y:rand(yRange[0],yRange[1]),phase:Math.random()*Math.PI*2,spd:rand(sRange[0],sRange[1])}));
      const geo=new THREE.BufferGeometry(); geo.setAttribute('position',new THREE.BufferAttribute(buf,3));
      const pts=new THREE.Points(geo,new THREE.PointsMaterial({color:col,size:1.85,transparent:true,opacity:0.16,blending:THREE.AdditiveBlending,depthWrite:false}));
      root.add(pts); auroraLayers.push({pts,buf,meta});
    });

    // Orbs
    interface OrbState{planet:Planet;core:THREE.Sprite;mid:THREE.Sprite;halo:THREE.Sprite;ring:THREE.Sprite;label:THREE.Sprite;trailBuf:Float32Array;trailGeo:THREE.BufferGeometry;trailPts:THREE.Vector3[];}
    const orbLights=PLANETS.slice(0,4).map(p=>{const pl=new THREE.PointLight(new THREE.Color(p.color),2.2,190);root.add(pl);return pl;});
    const TRAIL_MAX=55;
    const orbStates:OrbState[]=PLANETS.map(planet=>{
      const col=new THREE.Color(planet.color);
      const core=new THREE.Sprite(new THREE.SpriteMaterial({map:glowTex,color:col,transparent:true,opacity:0.96,blending:THREE.AdditiveBlending,depthWrite:false}));
      core.scale.set(planet.radius*2.8,planet.radius*2.8,1); root.add(core);
      const mid=new THREE.Sprite(new THREE.SpriteMaterial({map:softTex,color:col,transparent:true,opacity:0.38,blending:THREE.AdditiveBlending,depthWrite:false}));
      mid.scale.set(planet.radius*10,planet.radius*10,1); root.add(mid);
      const halo=new THREE.Sprite(new THREE.SpriteMaterial({map:wideTex,color:col,transparent:true,opacity:0.11,blending:THREE.AdditiveBlending,depthWrite:false}));
      halo.scale.set(planet.radius*26,planet.radius*26,1); root.add(halo);
      const ring=new THREE.Sprite(new THREE.SpriteMaterial({map:ringTex,color:col,transparent:true,opacity:0.20,blending:THREE.AdditiveBlending,depthWrite:false,rotation:Math.random()*Math.PI}));
      ring.scale.set(planet.radius*15,planet.radius*15,1); root.add(ring);
      const label=new THREE.Sprite(new THREE.SpriteMaterial({transparent:true,opacity:0,depthWrite:false,depthTest:false,blending:THREE.NormalBlending}));
      label.scale.set(95,12,1); root.add(label);
      const trailBuf=new Float32Array(TRAIL_MAX*3),trailGeo=new THREE.BufferGeometry();
      trailGeo.setAttribute('position',new THREE.BufferAttribute(trailBuf,3));
      root.add(new THREE.Points(trailGeo,new THREE.PointsMaterial({color:col,size:1.6,transparent:true,opacity:0.09,blending:THREE.AdditiveBlending,depthWrite:false})));
      return{planet,core,mid,halo,ring,label,trailBuf,trailGeo,trailPts:[]};
    });
    PLANETS.forEach((planet,idx)=>{makeLabelTextureAsync(planet.name,planet.color).then(lTex=>{if(cancelled){lTex.dispose();return;}textures.push(lTex);const mat=orbStates[idx].label.material as THREE.SpriteMaterial;mat.map=lTex;mat.opacity=0.88;mat.needsUpdate=true;});});

    // Orbit dust
    PLANETS.forEach(p=>{const n=300,pos=new Float32Array(n*3);for(let i=0;i<n;i++){const a=(i/n)*Math.PI*2+rand(-0.05,0.05),r=p.orbit+rand(-5,5),xO=r*Math.cos(a),zO=r*Math.sin(a),cosI=Math.cos(p.inc),sinI=Math.sin(p.inc),cosL=Math.cos(p.lan),sinL=Math.sin(p.lan);pos[i*3]=cosL*xO-sinL*zO*cosI+rand(-2,2);pos[i*3+1]=zO*sinI+rand(-1.5,1.5);pos[i*3+2]=sinL*xO+cosL*zO*cosI+rand(-2,2);}const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.BufferAttribute(pos,3));root.add(new THREE.Points(geo,new THREE.PointsMaterial({color:new THREE.Color(p.color),size:0.65,transparent:true,opacity:0.032,blending:THREE.AdditiveBlending,depthWrite:false})));});

    // Ambient dust
    {const n=5500,pos=new Float32Array(n*3),col=new Float32Array(n*3);for(let i=0;i<n;i++){const r=rand(260,1300),theta=Math.random()*Math.PI*2,phi=Math.acos(2*Math.random()-1);pos[i*3]=r*Math.sin(phi)*Math.cos(theta);pos[i*3+1]=r*Math.cos(phi)*0.36;pos[i*3+2]=r*Math.sin(phi)*Math.sin(theta);const c=Math.random()<0.55?new THREE.Color('#58daff'):new THREE.Color('#c484ff');col[i*3]=c.r*0.38;col[i*3+1]=c.g*0.38;col[i*3+2]=c.b*0.38;}const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.BufferAttribute(pos,3));geo.setAttribute('color',new THREE.BufferAttribute(col,3));scene.add(new THREE.Points(geo,new THREE.PointsMaterial({size:0.82,vertexColors:true,transparent:true,opacity:0.52,blending:THREE.AdditiveBlending,depthWrite:false})));}

    // Comets
    interface Comet{line:THREE.Line;arr:Float32Array;seed:number;y:number;z:number;spd:number;len:number;}
    const cometColors=[new THREE.Color('#58daff'),new THREE.Color('#c484ff'),new THREE.Color('#b2c6ff'),new THREE.Color('#4af5b2')];
    const comets:Comet[]=Array.from({length:6},(_,i)=>{const arr=new Float32Array(6),geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.BufferAttribute(arr,3));const line=new THREE.Line(geo,new THREE.LineBasicMaterial({color:cometColors[i%4],transparent:true,opacity:0,blending:THREE.AdditiveBlending,depthWrite:false}));scene.add(line);return{line,arr,seed:Math.random(),y:rand(-150,150),z:rand(-680,-340),spd:rand(0.005,0.011),len:rand(55,110)};});

    const mouse={x:0,y:0,tx:0,ty:0};
    const onMM=(e:MouseEvent)=>{mouse.tx=(e.clientX/window.innerWidth-0.5)*2;mouse.ty=(e.clientY/window.innerHeight-0.5)*2;};
    const onR=()=>{renderer.setPixelRatio(Math.min(window.devicePixelRatio??1,2.5));renderer.setSize(window.innerWidth,window.innerHeight);camera.aspect=window.innerWidth/window.innerHeight;camera.updateProjectionMatrix();};
    window.addEventListener('mousemove',onMM,{passive:true});
    window.addEventListener('resize',onR,{passive:true});

    let raf=0;const clock=new THREE.Clock();
    const tick=()=>{
      if(cancelled)return;
      const t=clock.getElapsedTime();
      mouse.x+=(mouse.tx-mouse.x)*0.014; mouse.y+=(mouse.ty-mouse.y)*0.014;
      root.rotation.x=mouse.y*0.11; root.rotation.y=mouse.x*0.16+t*0.0065;
      nebulaGroup.rotation.y=t*0.030; nebulaGroup.rotation.x=Math.sin(t*0.016)*0.040;
      saturnBody.rotation.y=t*0.08;
      const corePulse=1+Math.sin(t*0.28)*0.03; coreHalo.scale.set(320*corePulse,320*corePulse,1);
      kl.position.x=Math.cos(t*0.055)*130; kl.position.z=Math.sin(t*0.055)*130;
      satL.position.x=Math.cos(t*0.04+1.2)*80; satL.position.z=Math.sin(t*0.04+1.2)*80;
      starGroups.forEach(s=>{s.rotation.y+=s.userData.spd;});
      auroraLayers.forEach(({pts,buf,meta})=>{meta.forEach((m,i)=>{const a=m.theta+t*m.spd*0.28,wave=Math.sin(t*0.20+m.phase)*20;buf[i*3]=Math.cos(a)*m.r;buf[i*3+1]=m.y+wave;buf[i*3+2]=Math.sin(a)*m.r;});(pts.geometry.attributes.position as THREE.BufferAttribute).needsUpdate=true;(pts.material as THREE.PointsMaterial).opacity=0.12+Math.sin(t*0.13)*0.04;});
      const cycleT=(Math.sin(t*0.3)+1)/2,hackLevel=Math.pow(smoothstep(0.55,0.95,cycleT),1.8),recoveryLevel=Math.pow(smoothstep(0.02,0.26,cycleT),1.7)*(1-hackLevel);
      orbStates.forEach((state,idx)=>{const p=state.planet,pos=orbitVector(p,t);const interpPos=pos.clone().lerp(new THREE.Vector3(0,0,0),hackLevel*0.5);if(recoveryLevel>0.02)interpPos.add(pos.clone().normalize().multiplyScalar(recoveryLevel*24*Math.sin(t*2+idx)));const pulse=1+Math.sin(t*0.55+idx*0.85)*0.06;state.core.position.copy(interpPos);state.core.scale.setScalar(p.radius*2.8*pulse);state.mid.position.copy(interpPos);state.mid.scale.setScalar(p.radius*10*pulse);state.halo.position.copy(interpPos);state.halo.scale.setScalar(p.radius*26*(1+Math.sin(t*0.22+idx)*0.04));state.ring.position.copy(interpPos);(state.ring.material as THREE.SpriteMaterial).rotation+=0.0018;state.label.position.copy(interpPos.clone().add(new THREE.Vector3(0,p.radius*4.8+14,0)));state.trailPts.push(interpPos.clone());if(state.trailPts.length>TRAIL_MAX)state.trailPts.shift();state.trailPts.forEach((tp,i)=>{state.trailBuf[i*3]=tp.x;state.trailBuf[i*3+1]=tp.y;state.trailBuf[i*3+2]=tp.z;});(state.trailGeo.attributes.position as THREE.BufferAttribute).needsUpdate=true;if(idx<4){orbLights[idx].position.copy(interpPos);orbLights[idx].intensity=2+pulse*0.6;}});
      comets.forEach(c=>{const prog=(t*c.spd+c.seed)%1;const x=-750+prog*1500;c.arr[0]=x;c.arr[1]=c.y;c.arr[2]=c.z;c.arr[3]=x-c.len;c.arr[4]=c.y+c.len*0.14;c.arr[5]=c.z;(c.line.geometry.attributes.position as THREE.BufferAttribute).needsUpdate=true;(c.line.material as THREE.LineBasicMaterial).opacity=Math.sin(prog*Math.PI)*0.50;});
      camera.position.x+=(mouse.x*32-camera.position.x)*0.011;
      camera.position.y+=(100+mouse.y*20-camera.position.y)*0.011;
      camera.lookAt(root.position.x*0.20,0,0);
      renderer.render(scene,camera); raf=requestAnimationFrame(tick);
    };
    tick();
    return()=>{cancelled=true;cancelAnimationFrame(raf);window.removeEventListener('mousemove',onMM);window.removeEventListener('resize',onR);if(mount.contains(renderer.domElement))mount.removeChild(renderer.domElement);textures.forEach(tx=>tx.dispose());renderer.dispose();};
  },[]);

  return <div className="ss-three-mount" ref={mountRef} aria-hidden suppressHydrationWarning />;
}

// ─── UI Components ────────────────────────────────────────────────────────────
function Reveal({children,delay=0}:{children:React.ReactNode;delay?:number}){
  const ref=useRef<HTMLDivElement>(null);const[show,setShow]=useState(false);
  useEffect(()=>{const el=ref.current;if(!el)return;const obs=new IntersectionObserver(([e])=>{if(e.isIntersecting)setShow(true)},{threshold:0.1});obs.observe(el);return()=>obs.disconnect();},[]);
  return <div ref={ref} className={`ss-reveal${show?' show':''}`} style={{transitionDelay:`${delay}s`}}>{children}</div>;
}

function StatChip({label,value,accent,index}:{label:string;value?:string;accent:string;index:number}){
  return <div className="ss-stat-chip" style={{'--accent':accent,'--offset':`${(index-2)*3}px`} as React.CSSProperties}><i/><span>{label}</span><strong>{value??'SYNCING'}</strong></div>;
}

function SectionTitle({label,title,body}:{label:string;title:string;body?:string}){
  return <div className="ss-section-title"><span>{label}</span><h2>{title}</h2>{body&&<p>{body}</p>}</div>;
}

function ActionCard({href,label,title,desc,color}:{href:string;label:string;title:string;desc:string;color:string}){
  return <Link href={href} className="ss-command-card" style={{'--accent':color} as React.CSSProperties}><span>{label}</span><strong>{title}</strong><p>{desc}</p><em>Launch Core Dashboard →</em></Link>;
}

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function DashboardPage() {
  const {address,isConnected}=useAccount();
  const [mounted,setMounted]=useState(false);
  const [scrollY,setScrollY]=useState(0);
  const [menuOpen,setMenuOpen]=useState(false);
  // KEY FIX: detect mobile on client to skip WebGL
  const [isMobile,setIsMobile]=useState(false);

  useEffect(()=>{
    setMounted(true);
    // Mobile detection: width OR touch device
    const checkMobile=()=>setIsMobile(window.innerWidth<860||('ontouchstart' in window));
    checkMobile();
    window.addEventListener('resize',checkMobile,{passive:true});
    return()=>window.removeEventListener('resize',checkMobile);
  },[]);

  useEffect(()=>{
    const fn=()=>setScrollY(window.scrollY);
    window.addEventListener('scroll',fn,{passive:true});
    return()=>window.removeEventListener('scroll',fn);
  },[]);

  const {data:totalLiquidity}=useReadContract({address:SENTINEL_ADDRESSES.COVERAGE_POOL as `0x${string}`,abi:SENTINEL_ABIS.COVERAGE_POOL,functionName:'totalLiquidity'});
  const {data:freeLiquidity}=useReadContract({address:SENTINEL_ADDRESSES.COVERAGE_POOL as `0x${string}`,abi:SENTINEL_ABIS.COVERAGE_POOL,functionName:'freeLiquidity'});
  const {data:totalLocked}=useReadContract({address:SENTINEL_ADDRESSES.COVERAGE_POOL as `0x${string}`,abi:SENTINEL_ABIS.COVERAGE_POOL,functionName:'totalLockedLiquidity'});
  const {data:totalPolicies}=useReadContract({address:SENTINEL_ADDRESSES.POLICY_ENGINE as `0x${string}`,abi:SENTINEL_ABIS.POLICY_ENGINE,functionName:'totalPolicies'});
  const {data:totalClaims}=useReadContract({address:SENTINEL_ADDRESSES.CLAIMS_GOVERNOR as `0x${string}`,abi:SENTINEL_ABIS.CLAIMS_GOVERNOR,functionName:'totalClaims'});

  const fmt=(v:bigint|undefined)=>{if(v===undefined)return undefined;const n=Number(v)/1_000_000;if(n>=1_000_000)return`$${(n/1_000_000).toFixed(2)}M`;if(n>=1_000)return`$${(n/1_000).toFixed(1)}K`;return`$${n.toFixed(2)}`;};
  const fmtN=(v:bigint|undefined)=>(v!==undefined?Number(v).toLocaleString():undefined);

  const heroOpacity=Math.max(0,1-scrollY/600);
  const heroY=scrollY*0.12;

  if(!mounted)return <main suppressHydrationWarning style={{minHeight:'100vh',background:'#010207'}}/>;

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,500;0,600;0,700;1,600;1,700&family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@500;600;700&display=swap');
        *,*::before,*::after{box-sizing:border-box;}
        html{background:#010207;scroll-behavior:smooth;}
        body{margin:0;background:#010207;overflow-x:hidden;-webkit-tap-highlight-color:transparent;}

        /* ── THREE canvas — DESKTOP ONLY ── */
        .ss-three-mount{
          position:fixed;inset:0;z-index:0;overflow:hidden;
          background:radial-gradient(circle at 20% 35%,rgba(8,22,46,0.48),transparent 38%),radial-gradient(circle at 65% 55%,rgba(42,12,60,0.22),transparent 42%),linear-gradient(180deg,#010308 0%,#000104 100%);
        }
        .ss-three-mount canvas{display:block;width:100%;height:100%;}
        /* Hide canvas on mobile — shows gradient bg instead */
        @media(max-width:859px){
          .ss-three-mount{display:none;}
        }

        /* ── Mobile background gradient (replaces WebGL) ── */
        .ss-mobile-bg{
          display:none;
          position:fixed;inset:0;z-index:0;
          background:
            radial-gradient(ellipse 120% 60% at 50% -10%,rgba(30,50,120,0.55),transparent 55%),
            radial-gradient(ellipse 80% 50% at 20% 60%,rgba(50,15,90,0.4),transparent 55%),
            radial-gradient(ellipse 70% 40% at 80% 80%,rgba(5,35,25,0.35),transparent 52%),
            #010208;
          pointer-events:none;
        }
        @media(max-width:859px){
          .ss-mobile-bg{display:block;}
        }

        /* ── Page ── */
        .ss-page{position:relative;z-index:10;min-height:100vh;color:#f8fbff;font-family:Inter,system-ui,sans-serif;}

        /* ── NAV ── */
        .ss-nav{
          position:fixed;top:0;left:0;right:0;z-index:900;
          display:flex;align-items:center;justify-content:space-between;
          padding:14px clamp(16px,5vw,48px);
          transition:background 0.4s,border-color 0.4s,padding 0.3s;
        }
        .ss-nav.scrolled{
          background:rgba(1,2,8,0.88);
          backdrop-filter:blur(28px) saturate(1.5);
          -webkit-backdrop-filter:blur(28px) saturate(1.5);
          border-bottom:1px solid rgba(88,218,255,0.08);
          padding-top:10px;padding-bottom:10px;
        }
        .ss-nav-brand{display:flex;align-items:center;gap:10px;text-decoration:none;flex-shrink:0;}
        .ss-nav-logo{width:32px;height:32px;border-radius:9px;background:linear-gradient(135deg,#1a44aa,#aa2288);display:flex;align-items:center;justify-content:center;font-size:14px;box-shadow:0 4px 14px rgba(80,30,180,0.4);}
        .ss-nav-name{font-family:"Cormorant Garamond",serif;font-size:clamp(15px,2.5vw,19px);font-style:italic;font-weight:700;color:#fff;}
        .ss-nav-name em{color:#58daff;font-style:normal;}
        /* Desktop nav links */
        .ss-nav-links{display:flex;gap:4px;align-items:center;}
        .ss-nav-a{padding:0 11px;height:34px;display:flex;align-items:center;font-family:"JetBrains Mono",monospace;font-size:9px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:rgba(232,242,255,0.4);text-decoration:none;border-radius:6px;transition:all 0.2s;white-space:nowrap;}
        .ss-nav-a:hover{color:#58daff;background:rgba(88,218,255,0.08);}
        /* Wallet chip */
        .ss-wallet-chip{padding:5px 12px;border:1px solid rgba(88,218,255,0.18);border-radius:8px;font-family:"JetBrains Mono",monospace;font-size:9px;color:rgba(200,220,255,0.5);display:flex;align-items:center;gap:6px;white-space:nowrap;flex-shrink:0;}
        .ss-wallet-dot{width:6px;height:6px;border-radius:50%;background:#4af5b2;box-shadow:0 0 8px rgba(74,245,178,0.8);flex-shrink:0;}
        /* Hamburger */
        .ss-ham{background:none;border:none;cursor:pointer;padding:6px;display:none;flex-direction:column;gap:5px;align-items:center;justify-content:center;-webkit-tap-highlight-color:transparent;}
        /* ── RESPONSIVE NAV ── */
        @media(max-width:860px){
          .ss-nav-links{display:none!important;}
          .ss-wallet-chip .ss-wallet-text{display:none;}/* hide long address */
          .ss-ham{display:flex!important;}
        }
        @media(max-width:400px){
          .ss-nav{padding:12px 14px;}
        }

        /* ── Mobile full-screen menu ── */
        .ss-mobile-menu{position:fixed;inset:0;z-index:850;background:rgba(1,2,8,0.97);backdrop-filter:blur(28px);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:24px;transition:opacity 0.3s;pointer-events:none;opacity:0;}
        .ss-mobile-menu.open{pointer-events:auto;opacity:1;}
        .ss-mobile-link{font-family:"Cormorant Garamond",serif;font-size:clamp(26px,8vw,40px);font-style:italic;font-weight:700;color:#fff;text-decoration:none;transition:color 0.2s;opacity:0;transform:translateY(12px);transition:all 0.4s cubic-bezier(0.16,1,0.3,1);}
        .ss-mobile-menu.open .ss-mobile-link{opacity:1;transform:none;}
        .ss-mobile-link:hover{color:#58daff;}

        /* ── HERO ── */
        .ss-hero{
          min-height:100svh;
          display:flex;align-items:center;
          /* Desktop: content on the right */
          justify-content:flex-end;
          padding:clamp(80px,12vw,124px) clamp(16px,6vw,82px) clamp(60px,8vw,78px);
          position:relative;
        }
        .ss-hero-copy{width:min(500px,100%);will-change:opacity,transform;}

        /* ── MOBILE HERO: full width, centered/left ── */
        @media(max-width:860px){
          .ss-hero{
            justify-content:flex-start;
            align-items:flex-start;
            padding:clamp(80px,18vw,110px) clamp(16px,5vw,28px) clamp(40px,8vw,60px);
            /* On mobile hero should be taller to give space for content */
            min-height:auto;
          }
          .ss-hero-copy{
            width:100%;max-width:100%;
          }
          /* Kill parallax on mobile — just static */
          .ss-hero-copy-inner{
            opacity:1!important;transform:none!important;
          }
        }
        @media(max-width:480px){
          .ss-hero{padding:76px 14px 36px;}
        }

        .ss-kicker{display:inline-flex;align-items:center;gap:9px;height:28px;padding:0 11px;margin-bottom:clamp(14px,3vw,20px);border:1px solid rgba(238,246,255,0.1);background:rgba(1,6,16,0.45);backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);color:rgba(232,242,255,0.65);font-family:"JetBrains Mono",monospace;font-size:clamp(7px,1.5vw,8px);font-weight:700;letter-spacing:0.18em;text-transform:uppercase;}
        .ss-kicker i{width:6px;height:6px;border-radius:50%;background:#4af5b2;box-shadow:0 0 12px rgba(74,245,178,0.85);flex-shrink:0;animation:liveDot 2s ease-in-out infinite;}
        @keyframes liveDot{0%,100%{transform:scale(1);opacity:0.9}50%{transform:scale(1.7);opacity:0.4}}

        .ss-title{margin:0;font-family:"Cormorant Garamond",Georgia,serif;font-size:clamp(52px,10vw,120px);font-weight:700;font-style:italic;line-height:0.82;color:#fff;text-shadow:0 0 32px rgba(255,255,255,0.15);}
        .ss-title span{display:block;padding-left:clamp(18px,5vw,58px);color:rgba(238,245,255,0.26);}

        .ss-lead{max-width:460px;margin:clamp(16px,3vw,26px) 0;color:rgba(232,242,255,0.62);font-size:clamp(12px,1.5vw,14px);line-height:1.68;}

        .ss-actions-row{display:flex;flex-wrap:wrap;gap:8px;}
        @media(max-width:400px){
          .ss-actions-row{flex-direction:column;}
          .ss-btn{width:100%;justify-content:center;}
        }

        .ss-btn{display:inline-flex;align-items:center;justify-content:center;min-height:40px;padding:0 clamp(14px,3vw,18px);border:1px solid rgba(238,246,255,0.12);background:rgba(1,6,16,0.45);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);color:rgba(238,245,255,0.84);text-decoration:none;font-family:"JetBrains Mono",monospace;font-size:clamp(8px,1.5vw,9px);font-weight:800;letter-spacing:0.15em;text-transform:uppercase;transition:transform 180ms,border-color 180ms,background 180ms;white-space:nowrap;}
        .ss-btn.primary{background:rgba(244,247,255,0.92);color:#010206;border-color:rgba(244,247,255,0.92);box-shadow:0 0 28px rgba(255,255,255,0.14);}
        .ss-btn:hover{transform:translateY(-2px);border-color:rgba(88,218,255,0.44);background:rgba(88,218,255,0.08);}

        .ss-status{margin-top:clamp(16px,3vw,22px);width:min(440px,100%);border:1px solid rgba(238,246,255,0.07);background:rgba(1,6,16,0.5);backdrop-filter:blur(18px);-webkit-backdrop-filter:blur(18px);box-shadow:0 16px 54px rgba(0,0,0,0.3);}
        .ss-status-row{display:grid;grid-template-columns:90px minmax(0,1fr);gap:8px;padding:8px 11px;border-bottom:1px solid rgba(255,255,255,0.04);align-items:center;}
        .ss-status-row:last-child{border-bottom:0;}
        .ss-status-row span{font-family:"JetBrains Mono",monospace;font-size:clamp(7px,1.5vw,8px);font-weight:800;letter-spacing:0.18em;text-transform:uppercase;color:rgba(232,242,255,0.32);}
        .ss-status-row strong{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-family:"JetBrains Mono",monospace;font-size:clamp(8px,1.5vw,9px);font-weight:700;color:rgba(240,247,255,0.76);}
        @media(max-width:400px){.ss-status-row{grid-template-columns:72px 1fr;}}

        /* ── TELEMETRY ── */
        .ss-telemetry{width:min(1040px,calc(100% - 24px));margin:-16px auto 0;padding:10px;display:grid;grid-template-columns:0.76fr 1.24fr;gap:10px;border:1px solid rgba(255,255,255,0.06);background:rgba(1,4,11,0.5);backdrop-filter:blur(20px);-webkit-backdrop-filter:blur(20px);box-shadow:0 20px 80px rgba(0,0,0,0.3);}
        @media(max-width:860px){.ss-telemetry{grid-template-columns:1fr;margin-top:0;}}

        .ss-holo{position:relative;min-height:clamp(160px,25vw,214px);display:grid;place-items:center;overflow:hidden;border:1px solid rgba(255,255,255,0.058);background:rgba(1,5,14,0.28);}
        .ss-holo::before{content:'';position:absolute;inset:18%;border-radius:50%;background:radial-gradient(circle,rgba(88,218,255,0.14),transparent 45%);animation:holoPulse 4s ease-in-out infinite alternate;}
        .ss-holo-core{position:relative;z-index:2;text-align:center;}
        .ss-holo-core span{display:block;margin-bottom:7px;font-family:"JetBrains Mono",monospace;font-size:clamp(7px,1.5vw,8px);font-weight:800;letter-spacing:0.20em;text-transform:uppercase;color:rgba(232,242,255,0.34);}
        .ss-holo-core strong{display:block;font-family:"Cormorant Garamond",Georgia,serif;font-size:clamp(26px,4vw,50px);font-style:italic;line-height:0.92;color:#fff;}
        .ss-holo-core small{display:block;margin-top:8px;color:rgba(232,242,255,0.38);font-size:9px;text-transform:uppercase;}

        .ss-stat-cloud{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;}
        @media(max-width:400px){.ss-stat-cloud{grid-template-columns:1fr;}}
        .ss-stat-chip{position:relative;min-height:80px;padding:13px;overflow:hidden;border:1px solid rgba(255,255,255,0.06);background:rgba(1,6,16,0.4);transform:translateY(var(--offset));transition:transform 220ms,border-color 220ms;}
        .ss-stat-chip:nth-child(5){grid-column:1/-1;min-height:68px;}
        .ss-stat-chip:hover{transform:translateY(calc(var(--offset) - 4px));border-color:rgba(var(--accent),0.28);}
        .ss-stat-chip i{position:absolute;right:13px;top:13px;width:8px;height:8px;border-radius:50%;background:rgb(var(--accent));box-shadow:0 0 10px rgb(var(--accent));}
        .ss-stat-chip span{display:block;margin-bottom:8px;color:rgba(232,242,255,0.32);font-family:"JetBrains Mono",monospace;font-size:clamp(7px,1.5vw,8px);font-weight:800;letter-spacing:0.17em;text-transform:uppercase;}
        .ss-stat-chip strong{display:block;font-family:"Cormorant Garamond",Georgia,serif;font-size:clamp(18px,3.5vw,31px);color:#fff;}

        /* ── SECTIONS ── */
        .ss-section{max-width:1080px;margin:0 auto;padding:clamp(36px,6vw,68px) clamp(14px,5vw,58px);}
        .ss-section-title{max-width:540px;margin-bottom:20px;}
        .ss-section-title>span{display:flex;align-items:center;gap:10px;margin-bottom:10px;color:rgba(232,242,255,0.4);font-family:"JetBrains Mono",monospace;font-size:clamp(7px,1.5vw,8px);font-weight:800;letter-spacing:0.20em;text-transform:uppercase;}
        .ss-section-title>span::after{content:'';width:52px;height:1px;background:linear-gradient(90deg,rgba(88,218,255,0.42),transparent);}
        .ss-section-title h2{margin:0;color:#fff;font-family:"Cormorant Garamond",Georgia,serif;font-size:clamp(24px,4vw,48px);font-weight:700;font-style:italic;line-height:1;}
        .ss-section-title p{max-width:510px;margin:12px 0 0;color:rgba(232,242,255,0.48);font-size:clamp(11px,1.5vw,12px);line-height:1.64;}

        .ss-cortex{display:grid;grid-template-columns:0.68fr 1.32fr;gap:clamp(12px,3vw,34px);align-items:start;}
        @media(max-width:860px){.ss-cortex{grid-template-columns:1fr;}}
        .ss-cortex-rail,.ss-node,.ss-step,.ss-command-large,.ss-command-card{border:1px solid rgba(255,255,255,0.06);background:rgba(1,6,16,0.4);backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);box-shadow:0 18px 58px rgba(0,0,0,0.25),inset 0 1px 0 rgba(255,255,255,0.055);}
        .ss-cortex-rail{position:sticky;top:100px;min-height:240px;padding:19px;overflow:hidden;}
        .ss-cortex-rail::before{content:'';position:absolute;inset:20%;border:1px solid rgba(255,255,255,0.08);border-radius:50%;animation:holoSpin 22s linear infinite reverse;}
        .ss-cortex-rail strong{position:relative;display:block;margin-top:clamp(70px,10vw,106px);font-family:"Cormorant Garamond",Georgia,serif;font-size:clamp(22px,3vw,42px);font-style:italic;line-height:1;color:#fff;}
        .ss-cortex-rail p{position:relative;margin:12px 0 0;color:rgba(232,242,255,0.44);font-size:clamp(11px,1.5vw,11px);line-height:1.6;}
        @media(max-width:860px){.ss-cortex-rail{position:relative;top:auto;min-height:180px;}}
        .ss-cortex-stack{display:grid;gap:9px;padding-top:8px;}
        .ss-node{position:relative;min-height:96px;padding:13px 15px 13px 19px;transform:translateX(var(--shift));transition:transform 220ms,border-color 220ms,box-shadow 220ms;}
        .ss-node:hover{transform:translateX(var(--shift)) translateY(-4px);border-color:rgba(var(--planet),0.32);box-shadow:0 14px 50px rgba(var(--planet),0.06);}
        .ss-node::before{content:'';position:absolute;left:0;top:0;bottom:0;width:2px;background:rgb(var(--planet));box-shadow:0 0 16px rgb(var(--planet));}
        .ss-node span{color:rgba(var(--planet),0.9);font-family:"JetBrains Mono",monospace;font-size:clamp(7px,1.5vw,8px);font-weight:800;text-transform:uppercase;}
        .ss-node h3{margin:6px 0 4px;font-family:"Cormorant Garamond",Georgia,serif;font-size:clamp(16px,2.2vw,26px);color:#fff;}
        .ss-node p{margin:0;color:rgba(232,242,255,0.44);font-size:clamp(11px,1.5vw,11px);line-height:1.52;}
        .ss-node code{display:block;margin-top:7px;color:rgba(232,242,255,0.26);font-family:"JetBrains Mono",monospace;font-size:clamp(8px,1.5vw,8px);}
        @media(max-width:860px){.ss-node{transform:none!important;}}

        .ss-corridor{display:grid;gap:10px;padding-left:clamp(0px,5vw,74px);}
        @media(max-width:860px){.ss-corridor{padding-left:0;}}
        .ss-step{position:relative;width:min(660px,100%);min-height:108px;padding:16px 18px 15px;transform:translateX(var(--shift));transition:transform 220ms,border-color 220ms;}
        .ss-step:hover{transform:translateX(var(--shift)) translateY(-4px);border-color:rgba(var(--accent),0.28);}
        .ss-step span{display:block;color:rgba(var(--accent),0.85);font-family:"JetBrains Mono",monospace;font-size:clamp(7px,1.5vw,8px);font-weight:800;text-transform:uppercase;}
        .ss-step h3{margin:8px 0 6px;font-family:"Cormorant Garamond",Georgia,serif;font-size:clamp(20px,3vw,32px);color:#fff;}
        .ss-step p{margin:0;color:rgba(232,242,255,0.48);font-size:clamp(11px,1.5vw,11px);line-height:1.58;}
        @media(max-width:860px){.ss-step{transform:none!important;}}

        .ss-command-bay{display:grid;grid-template-columns:0.84fr 1.16fr;gap:9px;}
        @media(max-width:860px){.ss-command-bay{grid-template-columns:1fr;}}
        .ss-command-large{min-height:220px;padding:20px;}
        .ss-command-large h2{margin:0;font-family:"Cormorant Garamond",Georgia,serif;font-size:clamp(26px,4vw,48px);font-style:italic;line-height:1;color:#fff;}
        .ss-command-large p{margin:12px 0 0;color:rgba(232,242,255,0.48);font-size:clamp(11px,1.5vw,11px);line-height:1.6;}
        .ss-command-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:9px;}
        @media(max-width:480px){.ss-command-grid{grid-template-columns:1fr;}}
        .ss-command-card{position:relative;min-height:110px;display:flex;flex-direction:column;padding:14px;text-decoration:none;transition:transform 220ms,border-color 220ms;}
        .ss-command-card:hover{transform:translateY(-4px);border-color:rgba(var(--accent),0.28);}
        .ss-command-card span{color:rgba(var(--accent),0.85);font-family:"JetBrains Mono",monospace;font-size:clamp(7px,1.5vw,8px);font-weight:800;text-transform:uppercase;}
        .ss-command-card strong{margin-top:7px;font-family:"Cormorant Garamond",Georgia,serif;font-size:clamp(18px,2.5vw,21px);line-height:1;color:#fff;}
        .ss-command-card p{margin:8px 0 0;color:rgba(232,242,255,0.44);font-size:clamp(10px,1.5vw,10px);line-height:1.52;}
        .ss-command-card em{margin-top:auto;padding-top:10px;color:rgba(232,242,255,0.32);font-family:"JetBrains Mono",monospace;font-size:clamp(7px,1.5vw,8px);font-style:normal;font-weight:800;text-transform:uppercase;}

        /* ── FOOTER ── */
        .ss-footer{display:flex;justify-content:space-between;align-items:center;gap:14px;flex-wrap:wrap;padding:clamp(14px,3vw,20px) clamp(14px,5vw,58px);border-top:1px solid rgba(255,255,255,0.05);background:rgba(1,4,11,0.5);backdrop-filter:blur(18px);-webkit-backdrop-filter:blur(18px);}
        .ss-footer strong{font-family:"Cormorant Garamond",Georgia,serif;font-size:clamp(13px,2vw,16px);text-transform:uppercase;color:rgba(232,242,255,0.38);}
        .ss-footer nav{display:flex;flex-wrap:wrap;gap:clamp(10px,2vw,14px);}
        .ss-footer a{color:rgba(232,242,255,0.30);text-decoration:none;font-family:"JetBrains Mono",monospace;font-size:clamp(7px,1.5vw,8px);font-weight:800;text-transform:uppercase;white-space:nowrap;}
        .ss-footer a:hover{color:rgba(240,247,255,0.74);}

        /* ── REVEAL ── */
        .ss-reveal{opacity:0;transform:translateY(12px);transition:opacity 550ms,transform 550ms;}
        .ss-reveal.show{opacity:1;transform:translateY(0);}

        @keyframes holoPulse{from{transform:scale(0.98);opacity:0.78;}to{transform:scale(1.02);opacity:1;}}
        @keyframes holoSpin{to{transform:rotate(360deg);}}
      `}</style>

      {/* Mobile background (replaces WebGL) */}
      <div className="ss-mobile-bg" />

      {/* THREE.js scene — only mounted on desktop */}
      {!isMobile && <CinematicScene />}

      {/* Mobile full-screen menu */}
      <div className={`ss-mobile-menu${menuOpen?' open':''}`} onClick={()=>setMenuOpen(false)}>
        {[
          {label:'Coverage', href:'/buy-policy'},
          {label:'Claims',   href:'/claims'},
          {label:'Govern',   href:'/governance'},
          {label:'Liquidity',href:'/pool'},
          {label:'Docs',     href:'/docs'},
        ].map((item,i)=>(
          <Link key={item.label} href={item.href} className="ss-mobile-link"
            style={{transitionDelay:`${i*45}ms`}}
            onClick={()=>setMenuOpen(false)}
          >{item.label}</Link>
        ))}
        <a href="https://github.com/NexTechArchitect/Sentinel-Insurance-Protocol" target="_blank" rel="noreferrer"
          className="ss-mobile-link" style={{fontSize:'clamp(14px,4vw,18px)',color:'rgba(88,218,255,0.7)',transitionDelay:'225ms'}}>
          GitHub ↗
        </a>
      </div>

      <main className="ss-page">
        {/* ── NAV ── */}
        <nav className={`ss-nav${scrollY>55?' scrolled':''}`}>
          <Link href="/" className="ss-nav-brand">
            <div className="ss-nav-logo">◆</div>
            <div className="ss-nav-name">Sentinel<em>Shield</em></div>
          </Link>

          <div className="ss-nav-links">
            {[
              {label:'Coverage',   href:'/buy-policy'},
              {label:'Claims',     href:'/claims'},
              {label:'Governance', href:'/governance'},
              {label:'Liquidity',  href:'/pool'},
              {label:'Docs',       href:'/docs'},
            ].map(item=>(
              <Link key={item.label} href={item.href} className="ss-nav-a">{item.label}</Link>
            ))}
          </div>

          <div style={{display:'flex',alignItems:'center',gap:8}}>
            <div className="ss-wallet-chip" style={{display:isMobile?'none':'flex'}}>
              {isConnected&&<span className="ss-wallet-dot"/>}
              <span className="ss-wallet-text">{isConnected&&address?`${address.slice(0,6)}...${address.slice(-4)}`:'No wallet'}</span>
            </div>
            {/* Hamburger */}
            <button className="ss-ham" onClick={()=>setMenuOpen(!menuOpen)} aria-label="Menu">
              {[0,1,2].map(i=>(
                <div key={i} style={{width:22,height:1.5,background:'#fff',borderRadius:1,transition:'all 0.3s',
                  transform:menuOpen?(i===0?'rotate(45deg) translate(4.5px,4.5px)':i===1?'scaleX(0)':'rotate(-45deg) translate(4.5px,-4.5px)'):'none',
                  opacity:menuOpen&&i===1?0:1}}/>
              ))}
            </button>
          </div>
        </nav>

        {/* ── HERO ── */}
        <section className="ss-hero">
          {/* On mobile: no parallax, just static. On desktop: apply parallax */}
          <div className="ss-hero-copy">
            <div className="ss-hero-copy-inner" style={isMobile?{}:{opacity:heroOpacity,transform:`translate3d(0,${heroY}px,0)`}}>
              <div className="ss-kicker">
                <i />
                Decentralized insurance // Sepolia Layer
              </div>

              <h1 className="ss-title">
                Sentinel
                <span>Shield</span>
              </h1>

              <p className="ss-lead">
                Insurance capital for hostile DeFi environments. When exploit gravity pulls assets into the dark,
                Sentinel routes claim governance and recovery back on-chain.
              </p>

              <div className="ss-actions-row">
                <Link href="/buy-policy" className="ss-btn primary">Buy Coverage</Link>
                <Link href="/claims"     className="ss-btn">File Claim</Link>
                <Link href="/docs"       className="ss-btn">Docs</Link>
              </div>

              <div className="ss-status">
                <div className="ss-status-row">
                  <span>Status</span>
                  <strong style={{color:isConnected?'#4af5b2':undefined}}>
                    {isConnected?'◉ Wallet linked':'○ Awaiting wallet'}
                  </strong>
                </div>
                <div className="ss-status-row">
                  <span>Account</span>
                  <strong>{isConnected&&address?`${address.slice(0,6)}...${address.slice(-4)}`:'Connect wallet'}</strong>
                </div>
                <div className="ss-status-row">
                  <span>Network</span>
                  <strong>Ethereum Sepolia</strong>
                </div>
                <div className="ss-status-row">
                  <span>Core</span>
                  <strong>{shortAddr('POLICY_ENGINE')} // {shortAddr('COVERAGE_POOL')}</strong>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ── TELEMETRY ── */}
        <Reveal>
          <section className="ss-telemetry">
            <div className="ss-holo">
              <div className="ss-holo-core">
                <span>Protocol telemetry</span>
                <strong>Quantum<br />Capital</strong>
                <small>Bypassing hack gravity filaments</small>
              </div>
            </div>
            <div className="ss-stat-cloud">
              <StatChip label="Total Liquidity"   value={fmt(totalLiquidity as bigint|undefined)} accent="88,218,255"  index={0}/>
              <StatChip label="Free Capacity"     value={fmt(freeLiquidity  as bigint|undefined)} accent="74,245,178"  index={1}/>
              <StatChip label="Locked Collateral" value={fmt(totalLocked    as bigint|undefined)} accent="255,198,118" index={2}/>
              <StatChip label="Policies Issued"   value={fmtN(totalPolicies as bigint|undefined)} accent="196,132,255" index={3}/>
              <StatChip label="Claims Filed"      value={fmtN(totalClaims   as bigint|undefined)} accent="255,104,124" index={4}/>
            </div>
          </section>
        </Reveal>

        {/* ── PROTOCOL CORTEX ── */}
        <section className="ss-section">
          <Reveal>
            <div className="ss-cortex">
              <div className="ss-cortex-rail">
                <strong>Protocol Cortex.</strong>
                <p>Core contract logic nodes. Algorithmic stability visualized.</p>
              </div>
              <div className="ss-cortex-stack">
                {PLANETS.map((p,index)=>{
                  const col=new THREE.Color(p.color);
                  const shift=`${index%2===0?-6:9}px`;
                  return (
                    <article key={p.name} className="ss-node"
                      style={{'--planet':`${Math.round(col.r*255)},${Math.round(col.g*255)},${Math.round(col.b*255)}`,'--shift':shift} as React.CSSProperties}>
                      <span>{p.role}</span>
                      <h3>{p.name}</h3>
                      <p>{p.desc}</p>
                      <code>{shortAddr(p.key)}</code>
                    </article>
                  );
                })}
              </div>
            </div>
          </Reveal>
        </section>

        {/* ── COVERAGE CORRIDOR ── */}
        <section className="ss-section">
          <Reveal>
            <SectionTitle label="Coverage corridor" title="Malicious breach impacts absorbed by automated recovery sequences." body="How protocol exploits are instantly flattened by capital reserves."/>
          </Reveal>
          <div className="ss-corridor">
            {FLOW.map((step,index)=>(
              <Reveal delay={index*0.05} key={step.num}>
                <article className="ss-step" style={{'--accent':step.color,'--shift':`${index%2===0?0:20}px`} as React.CSSProperties}>
                  <span>{step.num}</span>
                  <h3>{step.title}</h3>
                  <p>{step.body}</p>
                </article>
              </Reveal>
            ))}
          </div>
        </section>

        {/* ── COMMAND CORE ── */}
        <section className="ss-section">
          <Reveal>
            <div className="ss-command-bay">
              <div className="ss-command-large">
                <h2>Command Core.</h2>
                <p>Buy coverage, file evidence logs, exercise voting power, or provide liquidity through an elite institutional interface.</p>
              </div>
              <div className="ss-command-grid">
                <ActionCard href="/buy-policy" label="Coverage" title="Buy Policy"        desc="Insure DeFi positions against smart contract exploits."  color="255,198,118"/>
                <ActionCard href="/claims"      label="Claims"   title="File Claim"         desc="Submit evidence and request settlement from the pool."  color="255,104,124"/>
                <ActionCard href="/governance"  label="DAO"      title="Vote Claims"        desc="Use SHIELD voting power to resolve active claims."      color="74,245,178"/>
                <ActionCard href="/pool"        label="Capital"  title="Provide Liquidity"  desc="Deposit USDC to earn yield and premium flow."          color="178,198,255"/>
              </div>
            </div>
          </Reveal>
        </section>

        {/* ── FOOTER ── */}
        <footer className="ss-footer">
          <strong>SentinelShield</strong>
          <nav>
            <a href={`https://sepolia.etherscan.io/address/${SENTINEL_ADDRESSES.POLICY_ENGINE}`} target="_blank" rel="noreferrer">Etherscan</a>
            <Link href="/docs">Docs</Link>
            <a href="https://github.com/NexTechArchitect/Sentinel-Insurance-Protocol" target="_blank" rel="noreferrer">GitHub</a>
            <Link href="/governance">Governance</Link>
          </nav>
          <span style={{fontFamily:'"JetBrains Mono",monospace',fontSize:'clamp(7px,1.5vw,8px)',color:'rgba(232,242,255,0.2)',textTransform:'uppercase',letterSpacing:'0.1em'}}>Sepolia · Verified</span>
        </footer>
      </main>
    </>
  );
}
