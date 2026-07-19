import { createConfig, http, injected, mock } from "wagmi";
import { defineChain } from "viem";
import { arcTestnet } from "./arc";

/**
 * Anvil dev account #1 — the employee seeded with salary streams by
 * `script/DeployLocal.s.sol`. Anvil keeps its dev accounts unlocked, so the
 * mock connector's eth_sendTransaction passthrough executes real local txs
 * without any browser wallet installed.
 */
export const DEMO_EMPLOYEE = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" as const;

/** Local anvil node seeded via `script/DeployLocal.s.sol` — plays Arc. */
export const anvilLocal = defineChain({
  id: 31337,
  name: "Arc (local)",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["http://127.0.0.1:8545"] } },
  testnet: true,
});

/** Second anvil (script/DeployLocalB.s.sol) — plays Base for CCTP demo flows. */
export const anvilLocalB = defineChain({
  id: 31338,
  name: "Base (local)",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["http://127.0.0.1:8546"] } },
  testnet: true,
});

export const wagmiConfig = createConfig({
  chains: [anvilLocal, anvilLocalB, arcTestnet],
  connectors: [
    injected(),
    mock({ accounts: [DEMO_EMPLOYEE], features: { reconnect: true } }),
  ],
  transports: {
    [anvilLocal.id]: http(),
    [anvilLocalB.id]: http(),
    [arcTestnet.id]: http(),
  },
  ssr: true,
});

export const CHAIN_LABELS: Record<number, string> = {
  [anvilLocal.id]: "Arc (local)",
  [anvilLocalB.id]: "Base (local)",
  [arcTestnet.id]: "Arc Testnet",
};
