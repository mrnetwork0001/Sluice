import { arcTestnet } from "./arc";
import { BASE_SEPOLIA_CHAIN_ID } from "./crosschain";

/** Block explorer per chain the app can transact on. */
const EXPLORERS: Record<number, { name: string; base: string }> = {
  [arcTestnet.id]: { name: "Arcscan", base: "https://testnet.arcscan.app" },
  [BASE_SEPOLIA_CHAIN_ID]: { name: "Basescan", base: "https://sepolia.basescan.org" },
};

export function explorerName(chainId: number): string {
  return EXPLORERS[chainId]?.name ?? "explorer";
}

/** Link to a transaction; falls back to Arcscan for unknown chains. */
export function explorerTxUrl(chainId: number, hash: string): string {
  const explorer = EXPLORERS[chainId] ?? EXPLORERS[arcTestnet.id]!;
  return `${explorer.base}/tx/${hash}`;
}

export function explorerAddressUrl(chainId: number, address: string): string {
  const explorer = EXPLORERS[chainId] ?? EXPLORERS[arcTestnet.id]!;
  return `${explorer.base}/address/${address}`;
}

/** 0x1234…abcd */
export function shortHash(hash: string): string {
  return `${hash.slice(0, 8)}…${hash.slice(-6)}`;
}
