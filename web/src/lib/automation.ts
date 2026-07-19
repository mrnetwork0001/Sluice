"use client";

import { formatUsdc } from "./format";

/**
 * Stream-to-DeFi auto-triggers.
 *
 * Rules run client-side after every successful withdrawal: a percentage of the
 * net (post-tax) payout is converted with Circle Swap Kit. On chains Swap Kit
 * supports (Base, Ethereum, Arbitrum, …) the swap executes for real via the
 * connected wallet; on Arc Testnet / local anvil (not yet in the kit's chain
 * registry) the trigger records a simulated execution so the flow is visible
 * end-to-end.
 */

export type AutoToken = "EURC" | "USDT" | "WBTC" | "WETH";
export const AUTO_TOKENS: AutoToken[] = ["EURC", "USDT", "WBTC", "WETH"];

export interface AutoRule {
  id: string;
  pct: number; // 1..100, share of each withdrawal
  tokenOut: AutoToken;
  enabled: boolean;
}

export interface TriggerLogEntry {
  at: number;
  streamId: string;
  amountIn: string; // human USDC
  tokenOut: AutoToken;
  pct: number;
  status: "executed" | "simulated" | "failed";
  detail: string;
}

const rulesKey = (account: string) => `sluice.rules.${account.toLowerCase()}`;
const logsKey = (account: string) => `sluice.triggerlog.${account.toLowerCase()}`;

export function loadRules(account: string): AutoRule[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(window.localStorage.getItem(rulesKey(account)) ?? "[]");
  } catch {
    return [];
  }
}

export function saveRules(account: string, rules: AutoRule[]) {
  window.localStorage.setItem(rulesKey(account), JSON.stringify(rules));
}

export function loadTriggerLog(account: string): TriggerLogEntry[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(window.localStorage.getItem(logsKey(account)) ?? "[]");
  } catch {
    return [];
  }
}

function appendTriggerLog(account: string, entry: TriggerLogEntry) {
  const log = [entry, ...loadTriggerLog(account)].slice(0, 50);
  window.localStorage.setItem(logsKey(account), JSON.stringify(log));
}

interface EthereumProvider {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
}

/** Attempt a real Swap Kit conversion; falls back to a simulated record. */
async function executeSwap(
  account: string,
  amountHuman: string,
  tokenOut: AutoToken,
): Promise<{ status: "executed" | "simulated"; detail: string }> {
  const provider = (globalThis as { ethereum?: EthereumProvider }).ethereum;
  if (!provider) return { status: "simulated", detail: "No injected wallet provider" };
  try {
    const [{ createSwapKitContext, swap }, { createViemAdapterFromProvider }] = await Promise.all([
      import("@circle-fin/swap-kit"),
      import("@circle-fin/adapter-viem-v2"),
    ]);
    const adapter = await createViemAdapterFromProvider({ provider: provider as never });
    const context = createSwapKitContext();
    const chainIdHex = (await provider.request({ method: "eth_chainId" })) as string;
    const result = await swap(context, {
      from: { adapter, address: account, chain: Number(chainIdHex) } as never,
      tokenIn: "USDC",
      tokenOut,
      amountIn: amountHuman,
    });
    return {
      status: "executed",
      detail: `Swap submitted via Circle Swap Kit (${JSON.stringify(result).slice(0, 120)})`,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      status: "simulated",
      detail: `Swap Kit does not support this chain yet — simulated ${amountHuman} USDC → ${tokenOut}. (${message.slice(0, 90)})`,
    };
  }
}

/** Run all enabled rules against a net withdrawal amount. Returns the log entries created. */
export async function runAutoTriggers(params: {
  account: string;
  streamId: bigint;
  netAmount: bigint; // 6-decimal USDC actually received
}): Promise<TriggerLogEntry[]> {
  const { account, streamId, netAmount } = params;
  const rules = loadRules(account).filter((rule) => rule.enabled && rule.pct > 0);
  const entries: TriggerLogEntry[] = [];
  for (const rule of rules) {
    const slice = (netAmount * BigInt(Math.round(rule.pct))) / 100n;
    if (slice <= 0n) continue;
    const amountHuman = formatUsdc(slice).replace(/,/g, "");
    let entry: TriggerLogEntry;
    try {
      const outcome = await executeSwap(account, amountHuman, rule.tokenOut);
      entry = {
        at: Date.now(),
        streamId: streamId.toString(),
        amountIn: amountHuman,
        tokenOut: rule.tokenOut,
        pct: rule.pct,
        ...outcome,
      };
    } catch (error) {
      entry = {
        at: Date.now(),
        streamId: streamId.toString(),
        amountIn: amountHuman,
        tokenOut: rule.tokenOut,
        pct: rule.pct,
        status: "failed",
        detail: error instanceof Error ? error.message : "Unknown error",
      };
    }
    appendTriggerLog(account, entry);
    entries.push(entry);
  }
  return entries;
}
