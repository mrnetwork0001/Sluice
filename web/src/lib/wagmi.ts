import { createConfig, http, injected } from "wagmi";
import { baseSepolia } from "wagmi/chains";
import { arcTestnet } from "./arc";

/**
 * Sluice lives on Arc Testnet. Base Sepolia is present only as the source side
 * of real CCTP v2 flows (fund a stream from Base, buy a stream from Base, and
 * the treasury's remote yield vault) — the app switches the wallet there just
 * long enough to burn, then returns home to Arc.
 */
export const wagmiConfig = createConfig({
  chains: [arcTestnet, baseSepolia],
  connectors: [injected()],
  transports: {
    [arcTestnet.id]: http(),
    [baseSepolia.id]: http(),
  },
  ssr: true,
});

export const CHAIN_LABELS: Record<number, string> = {
  [arcTestnet.id]: "Arc Testnet",
  [baseSepolia.id]: "Base Sepolia",
};
