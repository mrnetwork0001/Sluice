import { createConfig, http, injected } from "wagmi";
import { arcTestnet } from "./arc";

/**
 * Sluice targets Arc Testnet exclusively. The local twin-chain rig
 * (script/DeployLocal*.s.sol + web/scripts/relayer.mjs) remains in the repo as
 * development tooling for the Bridge Kit / real-CCTP integration, but the app
 * itself only ever connects to Arc.
 */
export const wagmiConfig = createConfig({
  chains: [arcTestnet],
  connectors: [injected()],
  transports: {
    [arcTestnet.id]: http(),
  },
  ssr: true,
});

export const CHAIN_LABELS: Record<number, string> = {
  [arcTestnet.id]: "Arc Testnet",
};
