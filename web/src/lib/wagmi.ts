import { createConfig, http, injected } from "wagmi";
import {
  arbitrumSepolia,
  avalancheFuji,
  baseSepolia,
  optimismSepolia,
  sepolia,
} from "wagmi/chains";
import { arcTestnet } from "./arc";

/**
 * Sluice lives on Arc Testnet. The other chains are present only as source or
 * destination sides of real CCTP v2 flows - fund a stream from any of them, buy
 * a stream from any of them, or take salary out to any of them. The app switches
 * the wallet there just long enough to burn, then returns home to Arc.
 *
 * These are exactly the chains in REMOTE_SIDES (lib/crosschain.ts), where the
 * canonical TokenMessengerV2 is deployed at the same address.
 */
export const wagmiConfig = createConfig({
  chains: [arcTestnet, baseSepolia, sepolia, avalancheFuji, optimismSepolia, arbitrumSepolia],
  connectors: [injected()],
  transports: {
    [arcTestnet.id]: http(),
    [baseSepolia.id]: http(),
    [sepolia.id]: http(),
    [avalancheFuji.id]: http(),
    [optimismSepolia.id]: http(),
    [arbitrumSepolia.id]: http(),
  },
  ssr: true,
});

export const CHAIN_LABELS: Record<number, string> = {
  [arcTestnet.id]: "Arc Testnet",
  [baseSepolia.id]: "Base Sepolia",
  [sepolia.id]: "Ethereum Sepolia",
  [avalancheFuji.id]: "Avalanche Fuji",
  [optimismSepolia.id]: "OP Sepolia",
  [arbitrumSepolia.id]: "Arbitrum Sepolia",
};
