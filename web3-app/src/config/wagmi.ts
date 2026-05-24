import { getDefaultConfig } from '@rainbow-me/rainbowkit';
import { sepolia } from 'wagmi/chains';
import { http, fallback } from 'wagmi';

const ALCHEMY = process.env.NEXT_PUBLIC_SEPOLIA_RPC_URL;

export const config = getDefaultConfig({
  appName: 'SentinelShield Insurance Protocol',
  projectId: process.env.NEXT_PUBLIC_PROJECT_ID || 'dummy-id-fallback',
  chains: [sepolia],
  transports: {
    [sepolia.id]: fallback([
      ...(ALCHEMY ? [http(ALCHEMY)] : []),
      http('https://ethereum-sepolia-rpc.publicnode.com'),
      http('https://sepolia.drpc.org'),
      http('https://rpc.sepolia.org'),
      http('https://rpc2.sepolia.org'),
    ]),
  },
  ssr: true,
});
