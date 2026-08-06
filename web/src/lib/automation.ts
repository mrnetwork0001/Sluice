"use client";

import { formatUsdcExact } from "./format";

/**
 * Stream-to-DeFi auto-triggers - real Circle Swap Kit swaps on Arc Testnet.
 *
 * Rules run after every successful withdrawal: a percentage of the net
 * (post-tax) payout is converted through Swap Kit using the connected wallet.
 * Swaps are executed onchain against Circle's routing service - the same call
 * path a user would take manually, no simulation.
 */

/** Tokens Circle's chain registry exposes on Arc Testnet alongside USDC. */
export type AutoToken = "EURC";
export const AUTO_TOKENS: AutoToken[] = ["EURC"];

/** Swap Kit's identifier for Arc Testnet (getChainByEnum('Arc') does NOT resolve). */
export const SWAPKIT_ARC_CHAIN = "Arc_Testnet";

/**
 * Below this, Arc gas (~0.028 USDC per swap) costs more than the conversion is
 * worth, so the rule is skipped with an explicit reason instead of burning fees.
 */
export const MIN_SWAP_USDC = 100_000n; // 0.10 USDC

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
  amountOut?: string; // human tokenOut actually received
  tokenOut: AutoToken;
  pct: number;
  status: "executed" | "failed" | "skipped";
  detail: string;
  txHash?: string;
  explorerUrl?: string;
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

function injectedProvider(): EthereumProvider | undefined {
  return (globalThis as { ethereum?: EthereumProvider }).ethereum;
}

/**
 * Circle's Stablecoin Service blocks browser calls via CORS (the SDK sends an
 * `x-user-*` header the service doesn't allow cross-origin), and its base URL is
 * an internal constant with no config hook. So we transparently reroute just
 * those API calls through this app's server-side proxy - the swap transaction
 * itself is still built, signed, and broadcast by the user's wallet.
 */
const CIRCLE_API_ORIGIN = "https://api.circle.com";
let fetchPatched = false;

function routeCircleApiThroughProxy() {
  if (fetchPatched || typeof window === "undefined") return;
  const originalFetch = window.fetch.bind(window);
  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    const url =
      typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (url.startsWith(CIRCLE_API_ORIGIN)) {
      const proxied = `/api/circle${url.slice(CIRCLE_API_ORIGIN.length)}`;
      if (typeof input === "string" || input instanceof URL) return originalFetch(proxied, init);
      return originalFetch(new Request(proxied, input), init);
    }
    return originalFetch(input as RequestInfo, init);
  };
  fetchPatched = true;
}

/** Swap Kit modules are heavy and browser-only - load them on demand. */
async function loadSwapKit() {
  routeCircleApiThroughProxy();
  const [kit, adapterModule] = await Promise.all([
    import("@circle-fin/swap-kit"),
    import("@circle-fin/adapter-viem-v2"),
  ]);
  return { kit, createViemAdapterFromProvider: adapterModule.createViemAdapterFromProvider };
}

export interface SwapQuote {
  amountIn: string;
  estimatedOutput: string;
  minimumOutput: string;
  tokenOut: AutoToken;
  gasFee?: string;
  providerFee?: string;
}

/**
 * Live quote for a USDC → tokenOut swap on Arc. Returns undefined when no
 * wallet is connected; throws with a readable message when the route fails.
 */
export async function quoteSwap(amountHuman: string, tokenOut: AutoToken): Promise<SwapQuote | undefined> {
  const provider = injectedProvider();
  if (!provider) return undefined;
  const { kit, createViemAdapterFromProvider } = await loadSwapKit();
  const adapter = await createViemAdapterFromProvider({ provider: provider as never });
  const context = kit.createSwapKitContext();
  // Note: `address` must be omitted for user-controlled adapters - Swap Kit
  // resolves it from the connected wallet and rejects an explicit value.
  const estimate = await kit.estimate(context, {
    from: { adapter, chain: SWAPKIT_ARC_CHAIN as never },
    tokenIn: "USDC",
    tokenOut,
    amountIn: amountHuman,
  } as never);

  const fees = (estimate as { fees?: Array<{ type: string; amount: string }> }).fees ?? [];
  return {
    amountIn: amountHuman,
    estimatedOutput: (estimate as { estimatedOutput?: { amount: string } }).estimatedOutput?.amount ?? "0",
    minimumOutput: (estimate as { stopLimit?: { amount: string } }).stopLimit?.amount ?? "0",
    tokenOut,
    gasFee: fees.find((fee) => fee.type === "gas")?.amount,
    providerFee: fees.find((fee) => fee.type === "provider")?.amount,
  };
}

interface SwapOutcome {
  status: "executed" | "failed";
  detail: string;
  amountOut?: string;
  txHash?: string;
  explorerUrl?: string;
}

/** A wallet that never answers must not hang the trigger forever. */
const SWAP_TIMEOUT_MS = 180_000;

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${Math.round(ms / 1000)}s - check your wallet for a pending signature.`)), ms),
    ),
  ]);
}

/** Execute one real Swap Kit conversion through the connected wallet. */
async function executeSwap(amountHuman: string, tokenOut: AutoToken): Promise<SwapOutcome> {
  const provider = injectedProvider();
  if (!provider) {
    return { status: "failed", detail: "No wallet provider available for the swap." };
  }
  try {
    const { kit, createViemAdapterFromProvider } = await loadSwapKit();
    const adapter = await createViemAdapterFromProvider({ provider: provider as never });
    const context = kit.createSwapKitContext();
    const result = (await withTimeout(
      kit.swap(context, {
        from: { adapter, chain: SWAPKIT_ARC_CHAIN as never },
        tokenIn: "USDC",
        tokenOut,
        amountIn: amountHuman,
      } as never),
      SWAP_TIMEOUT_MS,
      "Swap",
    )) as {
      txHash?: string;
      explorerUrl?: string;
      amountOut?: string;
      progress?: { status?: string; substatusMessage?: string };
    };

    let amountOut = result.amountOut;
    let status = result.progress?.status;
    // Same-chain swaps usually settle inline; if the service hasn't reported the
    // output yet, poll it rather than logging an unknown amount.
    if (status !== "DONE" || amountOut === undefined) {
      try {
        const settled = (await withTimeout(
          kit.waitForSwap({ result, timeoutMs: 60_000 } as never),
          70_000,
          "Swap settlement",
        )) as {
          amountOut?: string;
          progress?: { status?: string; substatusMessage?: string };
        };
        amountOut = settled.amountOut ?? amountOut;
        status = settled.progress?.status ?? status;
      } catch {
        /* keep whatever swap() already reported */
      }
    }

    const done = status === "DONE";
    return {
      status: done ? "executed" : "failed",
      detail: done
        ? `Swapped ${amountHuman} USDC → ${amountOut ?? "?"} ${tokenOut} via Circle Swap Kit`
        : (result.progress?.substatusMessage ?? `Swap status: ${status ?? "unknown"}`),
      amountOut,
      txHash: result.txHash,
      explorerUrl: result.explorerUrl,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { status: "failed", detail: message.slice(0, 200) };
  }
}

/**
 * Run all enabled rules against a net withdrawal amount.
 *
 * Swaps run sequentially: each one is a wallet transaction, and Arc charges gas
 * in USDC, so parallel submissions would race on nonces.
 */
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
    // Full 6-decimal precision: Swap Kit takes a human decimal string and
    // rejects "0", so a truncated amount would both under-swap and (for small
    // slices) fail validation outright.
    const amountHuman = formatUsdcExact(slice).replace(/,/g, "");
    let entry: TriggerLogEntry;

    if (slice < MIN_SWAP_USDC) {
      entry = {
        at: Date.now(),
        streamId: streamId.toString(),
        amountIn: amountHuman,
        tokenOut: rule.tokenOut,
        pct: rule.pct,
        status: "skipped",
        detail:
          slice === 0n
            ? "Withdrawal slice rounded to zero - nothing to swap."
            : `Slice is ${amountHuman} USDC - below the ${formatUsdcExact(MIN_SWAP_USDC)} USDC minimum, where Arc gas would exceed the conversion.`,
      };
    } else {
      const outcome = await executeSwap(amountHuman, rule.tokenOut);
      entry = {
        at: Date.now(),
        streamId: streamId.toString(),
        amountIn: amountHuman,
        amountOut: outcome.amountOut,
        tokenOut: rule.tokenOut,
        pct: rule.pct,
        status: outcome.status,
        detail: outcome.detail,
        txHash: outcome.txHash,
        explorerUrl: outcome.explorerUrl,
      };
    }

    appendTriggerLog(account, entry);
    entries.push(entry);
  }
  return entries;
}
