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
  testnet: true,
});

/** Native USDC (ERC-20 interface) on Arc Testnet. 6 decimals. */
export const ARC_USDC_ADDRESS =
  "0x3600000000000000000000000000000000000000" as const;
