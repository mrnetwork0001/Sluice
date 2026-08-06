"use client";

/**
 * Circle Gateway - unified USDC balance across chains.
 *
 * Payroll capital is rarely where payroll runs. Gateway lets an employer see
 * every USDC balance they hold as one number and spend it on Arc without
 * pre-positioning funds or waiting on a bridge.
 *
 * Notes that cost real debugging time:
 *  - `getBalances` defaults to MAINNET; testnet chains must be named explicitly.
 *  - Unlike Swap Kit, the Gateway API is CORS-open and permissionless, so this
 *    runs directly from the browser with no proxy and no API key.
 */

/**
 * Testnet chains queried for an EVM depositor. Gateway also covers non-EVM
 * domains (Solana Devnet), but a balance query is per address format - an EVM
 * address is not a valid Solana depositor, so Solana is listed separately and
 * queried only when a Solana address is supplied.
 */
export const GATEWAY_CHAINS = [
  "Arc_Testnet",
  "Base_Sepolia",
  "Ethereum_Sepolia",
  "Avalanche_Fuji",
  "Arbitrum_Sepolia",
  "Optimism_Sepolia",
  "Polygon_Amoy_Testnet",
] as const;

/** Non-EVM domains Gateway supports - queryable with a Solana address. */
export const GATEWAY_NON_EVM_CHAINS = ["Solana_Devnet"] as const;

export type GatewayChain = (typeof GATEWAY_CHAINS)[number];

/** Human labels for the chain identifiers Gateway returns. */
export function gatewayChainLabel(chain: string): string {
  return chain.replace(/_Testnet$/, "").replace(/_/g, " ");
}

/** Wallet chain id -> the identifier Gateway expects, for deposits. */
export function gatewayChainForId(chainId: number | undefined): GatewayChain | undefined {
  switch (chainId) {
    case 5042002:
      return "Arc_Testnet";
    case 84532:
      return "Base_Sepolia";
    case 11155111:
      return "Ethereum_Sepolia";
    case 43113:
      return "Avalanche_Fuji";
    case 421614:
      return "Arbitrum_Sepolia";
    case 11155420:
      return "Optimism_Sepolia";
    case 80002:
      return "Polygon_Amoy_Testnet";
    default:
      return undefined;
  }
}

export interface ChainBalance {
  chain: string;
  confirmed: string;
  pending?: string;
}

export interface UnifiedBalance {
  token: string;
  totalConfirmed: string;
  totalPending?: string;
  chains: ChainBalance[];
}

async function loadKit() {
  return import("@circle-fin/unified-balance-kit");
}

/**
 * Unified USDC balance for an address. Read-only: no wallet connection, no
 * signature, no adapter - Gateway answers for any address.
 */
export async function fetchUnifiedBalance(address: `0x${string}`): Promise<UnifiedBalance | undefined> {
  const kit = await loadKit();
  const context = kit.createUnifiedBalanceKitContext();
  const result = (await kit.getBalances(context, {
    token: "USDC",
    // Naming testnet chains explicitly - the default network is mainnet.
    sources: [{ address, chains: GATEWAY_CHAINS as unknown as string[] }],
    includePending: true,
    networkType: "testnet",
  } as never)) as {
    token?: string;
    totalConfirmedBalance?: string;
    totalPendingBalance?: string;
    breakdown?: Array<{
      breakdown?: Array<{ chain?: string; confirmedBalance?: string; pendingBalance?: string }>;
    }>;
  };

  const chains: ChainBalance[] = [];
  for (const depositor of result.breakdown ?? []) {
    for (const entry of depositor.breakdown ?? []) {
      if (!entry.chain) continue;
      chains.push({
        chain: entry.chain,
        confirmed: entry.confirmedBalance ?? "0",
        pending: entry.pendingBalance,
      });
    }
  }

  return {
    token: result.token ?? "USDC",
    totalConfirmed: result.totalConfirmedBalance ?? "0",
    totalPending: result.totalPendingBalance,
    chains: chains.sort((a, b) => Number(b.confirmed) - Number(a.confirmed)),
  };
}

interface EthereumProvider {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
}

/**
 * Deposit USDC into the employer's Gateway balance from the chain the wallet is
 * currently on. Uses the default EIP-3009 `authorize` strategy: one signature
 * plus one transaction, no separate approval.
 */
export async function depositToGateway(params: {
  chain: GatewayChain;
  amount: string; // human decimal, e.g. "25.00"
}): Promise<{ txHash?: string; explorerUrl?: string }> {
  const provider = (globalThis as { ethereum?: EthereumProvider }).ethereum;
  if (!provider) throw new Error("No wallet provider available.");

  const [kit, adapterModule] = await Promise.all([loadKit(), import("@circle-fin/adapter-viem-v2")]);
  const adapter = await adapterModule.createViemAdapterFromProvider({ provider: provider as never });
  const context = kit.createUnifiedBalanceKitContext();

  const result = (await kit.deposit(context, {
    from: { adapter, chain: params.chain },
    amount: params.amount,
    token: "USDC",
  } as never)) as { txHash?: string; explorerUrl?: string };

  return { txHash: result.txHash, explorerUrl: result.explorerUrl };
}
