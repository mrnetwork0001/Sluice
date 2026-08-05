import { defineChain } from "viem";

/**
 * Arc Testnet — Circle's L1 with native USDC gas and sub-second finality.
 * Chain ID 5042002 (0x4CEF52).
 */
export const arcTestnet = defineChain({
  id: 5042002,
  name: "Arc Testnet",
  nativeCurrency: { name: "USD Coin", symbol: "USDC", decimals: 6 },
  rpcUrls: {
    default: { http: ["https://rpc.testnet.arc.network"] },
  },
  blockExplorers: {
    default: { name: "Arcscan", url: "https://testnet.arcscan.app" },
  },
  contracts: {
    // Canonical Multicall3 — verified deployed on Arc testnet; lets wagmi batch reads.
    multicall3: { address: "0xcA11bde05977b3631167028862bE2a173976CA11" },
  },
  testnet: true,
});

/** Native USDC (ERC-20 interface) on Arc Testnet. 6 decimals. */
export const ARC_USDC_ADDRESS =
  "0x3600000000000000000000000000000000000000" as const;
