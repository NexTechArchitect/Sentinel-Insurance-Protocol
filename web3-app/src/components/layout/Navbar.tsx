'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ConnectButton } from '@rainbow-me/rainbowkit';

const links = [
  { name: 'Dashboard', href: '/' },
  { name: 'Buy Policy', href: '/buy-policy' },
  { name: 'Claims', href: '/claims' },
  { name: 'Governance', href: '/governance' },
  { name: 'Liquidity', href: '/pool' },
  { name: 'Docs', href: '/docs' }, // Added Docs link
];

export function Navbar() {
  const pathname = usePathname();
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    const onScroll = () => {
      const max = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
      setScrolled(window.scrollY > 18);
      setProgress(Math.min(1, window.scrollY / max));
    };

    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => setOpen(false), [pathname]);

  // FIX: Hide the global Navbar on the /docs page to prevent collision with its custom header
  if (pathname === '/docs') {
    return null;
  }

  const isActive = (href: string) => (href === '/' ? pathname === '/' : pathname.startsWith(href));

  return (
    <>
      <style>{`
        .ss-nav {
          position: fixed;
          top: 14px;
          left: clamp(12px, 2vw, 28px);
          right: clamp(12px, 2vw, 28px);
          z-index: 200;
          height: 68px;
          display: grid;
          grid-template-columns: 1fr auto 1fr;
          align-items: center;
          padding: 0 14px 0 18px;
          color: #fff;
          font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
          border: 1px solid rgba(255,255,255,0.08);
          background:
            linear-gradient(135deg, rgba(255,255,255,0.075), rgba(255,255,255,0.018)),
            rgba(4, 7, 13, 0.38);
          backdrop-filter: blur(22px) saturate(135%);
          -webkit-backdrop-filter: blur(22px) saturate(135%);
          box-shadow:
            0 24px 80px rgba(0,0,0,0.42),
            inset 0 1px 0 rgba(255,255,255,0.12);
          transition: background 280ms ease, border-color 280ms ease, transform 280ms ease;
        }

        .ss-nav.solid {
          background:
            linear-gradient(135deg, rgba(21, 30, 44, 0.72), rgba(5, 7, 13, 0.72)),
            rgba(3, 5, 10, 0.72);
          border-color: rgba(255,255,255,0.14);
        }

        .ss-nav::before {
          content: '';
          position: absolute;
          inset: -1px;
          z-index: -1;
          opacity: 0.52;
          background:
            linear-gradient(90deg, rgba(95,232,255,0.24), transparent 24%, transparent 72%, rgba(255,201,104,0.22)),
            linear-gradient(180deg, rgba(255,255,255,0.1), transparent 42%);
          pointer-events: none;
          mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
          -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
          padding: 1px;
          -webkit-mask-composite: xor;
          mask-composite: exclude;
        }

        .ss-scroll-progress {
          position: absolute;
          left: 12px;
          right: 12px;
          bottom: -1px;
          height: 1px;
          transform-origin: left;
          background: linear-gradient(90deg, #67e8f9, #ffffff, #facc15, #fb7185);
          box-shadow: 0 0 22px rgba(103,232,249,0.45);
        }

        .ss-brand {
          min-width: 0;
          display: inline-flex;
          align-items: center;
          gap: 12px;
          width: fit-content;
          color: #fff;
          text-decoration: none;
        }

        .ss-logo {
          position: relative;
          width: 36px;
          height: 36px;
          flex: 0 0 auto;
          transform-style: preserve-3d;
          perspective: 600px;
        }

        .ss-logo-core {
          position: absolute;
          inset: 12px;
          border-radius: 50%;
          background: #fff;
          box-shadow:
            0 0 16px rgba(255,255,255,0.95),
            0 0 36px rgba(103,232,249,0.55),
            0 0 58px rgba(250,204,21,0.28);
        }

        .ss-logo-ring {
          position: absolute;
          inset: 4px;
          border: 1px solid rgba(255,255,255,0.48);
          border-radius: 50%;
          transform: rotateX(64deg) rotateZ(0deg);
          animation: ssLogoOrbit 5.8s linear infinite;
        }

        .ss-logo-ring.r2 {
          inset: 8px 2px;
          border-color: rgba(103,232,249,0.42);
          transform: rotateX(62deg) rotateY(52deg);
          animation-duration: 8.5s;
          animation-direction: reverse;
        }

        @keyframes ssLogoOrbit {
          to { transform: rotateX(64deg) rotateZ(360deg); }
        }

        .ss-brand-text {
          display: grid;
          gap: 2px;
        }

        .ss-brand-name {
          font-family: "Cormorant Garamond", Georgia, serif;
          font-size: 18px;
          font-weight: 700;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          line-height: 1;
        }

        .ss-brand-sub {
          font-family: "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace;
          font-size: 8px;
          letter-spacing: 0.24em;
          text-transform: uppercase;
          color: rgba(255,255,255,0.38);
        }

        .ss-links {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 4px;
          padding: 5px;
          list-style: none;
          border: 1px solid rgba(255,255,255,0.075);
          background: rgba(255,255,255,0.035);
          box-shadow: inset 0 1px 0 rgba(255,255,255,0.08);
        }

        .ss-link {
          position: relative;
          display: inline-flex;
          align-items: center;
          height: 36px;
          padding: 0 16px;
          overflow: hidden;
          color: rgba(255,255,255,0.46);
          text-decoration: none;
          font-family: "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace;
          font-size: 9px;
          font-weight: 700;
          letter-spacing: 0.17em;
          text-transform: uppercase;
          transition: color 180ms ease, background 180ms ease;
        }

        .ss-link::before {
          content: '';
          position: absolute;
          inset: 0;
          opacity: 0;
          background:
            linear-gradient(135deg, rgba(103,232,249,0.14), rgba(255,255,255,0.06), rgba(250,204,21,0.12));
          transition: opacity 180ms ease;
        }

        .ss-link span {
          position: relative;
          z-index: 1;
        }

        .ss-link:hover,
        .ss-link.active {
          color: rgba(255,255,255,0.94);
        }

        .ss-link:hover::before,
        .ss-link.active::before {
          opacity: 1;
        }

        .ss-link.active::after {
          content: '';
          position: absolute;
          left: 14px;
          right: 14px;
          bottom: 5px;
          height: 1px;
          background: linear-gradient(90deg, transparent, rgba(255,255,255,0.9), transparent);
          box-shadow: 0 0 16px rgba(103,232,249,0.75);
        }

        .ss-nav-right {
          display: flex;
          align-items: center;
          justify-content: flex-end;
          gap: 10px;
          min-width: 0;
        }

        .ss-network-chip {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          height: 36px;
          padding: 0 12px;
          border: 1px solid rgba(255,255,255,0.08);
          background: rgba(255,255,255,0.025);
          font-family: "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace;
          font-size: 8px;
          font-weight: 700;
          letter-spacing: 0.18em;
          text-transform: uppercase;
          color: rgba(255,255,255,0.42);
        }

        .ss-network-chip i {
          width: 7px;
          height: 7px;
          border-radius: 50%;
          background: #4ade80;
          box-shadow: 0 0 12px rgba(74,222,128,0.9);
        }

        .ss-wallet {
          display: flex;
          align-items: center;
        }

        .ss-wallet button,
        .ss-wallet [data-testid="rk-connect-button"],
        .ss-wallet [data-testid="rk-account-button"] {
          height: 40px !important;
          min-height: 40px !important;
          border-radius: 8px !important;
          border: 1px solid rgba(255,255,255,0.14) !important;
          background:
            linear-gradient(135deg, rgba(255,255,255,0.14), rgba(255,255,255,0.045)) !important;
          color: rgba(255,255,255,0.9) !important;
          box-shadow:
            0 0 26px rgba(103,232,249,0.10),
            inset 0 1px 0 rgba(255,255,255,0.12) !important;
          font-family: "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace !important;
          font-size: 10px !important;
          font-weight: 800 !important;
          letter-spacing: 0.08em !important;
          transition: transform 180ms ease, border-color 180ms ease, background 180ms ease !important;
        }

        .ss-wallet button:hover {
          transform: translateY(-1px) !important;
          border-color: rgba(103,232,249,0.42) !important;
          background:
            linear-gradient(135deg, rgba(103,232,249,0.18), rgba(255,255,255,0.075), rgba(250,204,21,0.12)) !important;
        }

        .ss-menu {
          display: none;
          width: 40px;
          height: 40px;
          border: 1px solid rgba(255,255,255,0.12);
          background: rgba(255,255,255,0.04);
          color: #fff;
          cursor: pointer;
        }

        .ss-menu span {
          display: block;
          width: 16px;
          height: 1px;
          margin: 5px auto;
          background: rgba(255,255,255,0.82);
          transition: transform 180ms ease;
        }

        .ss-nav.open .ss-menu span:first-child {
          transform: translateY(3px) rotate(45deg);
        }

        .ss-nav.open .ss-menu span:last-child {
          transform: translateY(-3px) rotate(-45deg);
        }

        .ss-mobile-panel {
          display: none;
        }

        @media (max-width: 980px) {
          .ss-nav {
            grid-template-columns: 1fr auto;
            height: 66px;
          }

          .ss-links,
          .ss-network-chip {
            display: none;
          }

          .ss-menu {
            display: block;
          }

          .ss-brand-sub {
            display: none;
          }

          .ss-mobile-panel {
            position: absolute;
            top: 76px;
            left: 0;
            right: 0;
            display: grid;
            gap: 6px;
            padding: 10px;
            opacity: 0;
            pointer-events: none;
            transform: translateY(-10px);
            border: 1px solid rgba(255,255,255,0.1);
            background: rgba(5,8,15,0.88);
            backdrop-filter: blur(22px);
            -webkit-backdrop-filter: blur(22px);
            box-shadow: 0 24px 60px rgba(0,0,0,0.44);
            transition: opacity 180ms ease, transform 180ms ease;
          }

          .ss-nav.open .ss-mobile-panel {
            opacity: 1;
            pointer-events: auto;
            transform: translateY(0);
          }

          .ss-mobile-panel .ss-link {
            justify-content: space-between;
            height: 44px;
          }
        }

        @media (max-width: 560px) {
          .ss-nav {
            left: 10px;
            right: 10px;
            top: 10px;
            padding-left: 12px;
          }

          .ss-brand-name {
            font-size: 14px;
            letter-spacing: 0.06em;
          }

          .ss-logo {
            width: 30px;
            height: 30px;
          }

          .ss-wallet {
            max-width: 46px;
            overflow: hidden;
          }
        }
      `}</style>

      <nav className={`ss-nav${scrolled ? ' solid' : ''}${open ? ' open' : ''}`}>
        <Link href="/" className="ss-brand" aria-label="SentinelShield home">
          <span className="ss-logo" aria-hidden>
            <span className="ss-logo-ring" />
            <span className="ss-logo-ring r2" />
            <span className="ss-logo-core" />
          </span>
          <span className="ss-brand-text">
            <span className="ss-brand-name">SentinelShield</span>
            <span className="ss-brand-sub">DeFi risk engine</span>
          </span>
        </Link>

        <ul className="ss-links">
          {links.map((link) => (
            <li key={link.href}>
              <Link href={link.href} className={`ss-link${isActive(link.href) ? ' active' : ''}`}>
                <span>{link.name}</span>
              </Link>
            </li>
          ))}
        </ul>

        <div className="ss-nav-right">
          <div className="ss-network-chip">
            <i />
            Sepolia live
          </div>

          <div className="ss-wallet">
            <ConnectButton showBalance={false} accountStatus="avatar" chainStatus="icon" />
          </div>

          <button
            type="button"
            className="ss-menu"
            aria-label="Toggle navigation"
            aria-expanded={open}
            onClick={() => setOpen((value) => !value)}
          >
            <span />
            <span />
          </button>
        </div>

        <div className="ss-mobile-panel">
          {links.map((link) => (
            <Link 
              key={link.href} 
              href={link.href} 
              className={`ss-link${isActive(link.href) ? ' active' : ''}`}
              onClick={() => setOpen(false)} /* FIX: Auto-close menu on phone tap */
            >
              <span>{link.name}</span>
            </Link>
          ))}
        </div>

        <div className="ss-scroll-progress" style={{ transform: `scaleX(${progress})` }} />
      </nav>
    </>
  );
}