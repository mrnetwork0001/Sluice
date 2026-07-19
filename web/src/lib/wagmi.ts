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

/** Local anvil node seeded via `script/DeployLocal.s.sol` — the demo chain. */
export const anvilLocal = defineChain({
  id: 31337,
  name: "Anvil (local)",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["http://127.0.0.1:8545"] } },
  testnet: true,
});

export const wagmiConfig = createConfig({
  chains: [anvilLocal, arcTestnet],
  connectors: [
    injected(),
    mock({ accounts: [DEMO_EMPLOYEE], features: { reconnect: true } }),
  ],
  transports: {
    [anvilLocal.id]: http(),
    [arcTestnet.id]: http(),
  },
  ssr: true,
});

export const CHAIN_LABELS: Record<number, string> = {
  [anvilLocal.id]: "Anvil (local)",
  [arcTestnet.id]: "Arc Testnet",
};
