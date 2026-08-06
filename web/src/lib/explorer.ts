import { arcTestnet } from "./arc";
import { BASE_SEPOLIA_CHAIN_ID } from "./crosschain";

/** Block explorer per chain the app can transact on. */
const EXPLORERS: Record<number, { name: string; base: string }> = {
  [arcTestnet.id]: { name: "Arcscan", base: "https://testnet.arcscan.app" },
  [BASE_SEPOLIA_CHAIN_ID]: { name: "Basescan", base: "https://sepolia.basescan.org" },
  11155111: { name: "Etherscan", base: "https://sepolia.etherscan.io" },
  43113: { name: "Snowtrace", base: "https://testnet.snowtrace.io" },
  11155420: { name: "OP Explorer", base: "https://sepolia-optimism.etherscan.io" },
  421614: { name: "Arbiscan", base: "https://sepolia.arbiscan.io" },
};

/** Solana has no EVM chain id; its explorer is addressed separately. */
export function solanaExplorerTxUrl(signature: string): string {
  return `https://explorer.solana.com/tx/${signature}?cluster=devnet`;
}

export function solanaExplorerAddressUrl(address: string): string {
  return `https://explorer.solana.com/address/${address}?cluster=devnet`;
}

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
