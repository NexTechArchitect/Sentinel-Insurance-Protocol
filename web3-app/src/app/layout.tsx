import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import "@rainbow-me/rainbowkit/styles.css";
import { Web3Provider } from "@/providers/Web3Provider";
import { Navbar } from "@/components/layout/Navbar"; // 🔥 Logo & Wallet connect bar loaded

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "SentinelShield | On-Chain Insurance Infrastructure",
  description: "Next-generation decentralized insurance protocol powered by ERC-4626 and DAO adjudication.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${inter.className} bg-slate-950 text-slate-50 antialiased`}>
        <Web3Provider>
          <Navbar /> {/* 🔥 Pura application layout ab navbar se controlled hai */}
          <main className="min-h-[calc(100vh-73px)]">
            {children}
          </main>
        </Web3Provider>
      </body>
    </html>
  );
}