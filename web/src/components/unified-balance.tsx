"use client";

import { useEffect, useState } from "react";
import { useAccount } from "wagmi";
import {
  GATEWAY_CHAINS,
  fetchUnifiedBalance,
  gatewayChainLabel,
  type UnifiedBalance,
} from "@/lib/gateway";
import { Badge, Card, CardTitle } from "@/components/ui";

/**
 * Circle Gateway panel: the employer's USDC across every supported chain as one
 * spendable number. Payroll capital is rarely where payroll runs — this is the
 * treasury view that makes that a non-problem.
 */
export function UnifiedBalancePanel() {
  const { address, isConnected } = useAccount();
  const [balance, setBalance] = useState<UnifiedBalance | undefined>();
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!address) return;
    let cancelled = false;
    setLoading(true);
    setError(undefined);
    fetchUnifiedBalance(address)
      .then((result) => !cancelled && setBalance(result))
      .catch((err) => !cancelled && setError(err instanceof Error ? err.message : String(err)))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [address]);

  if (!isConnected) return null;

  const funded = balance?.chains.filter((chain) => Number(chain.confirmed) > 0) ?? [];

  return (
    <Card>
      <CardTitle hint="Circle Gateway · no bridging, no pre-positioning">
        Unified USDC balance
      </CardTitle>

      <div className="flex flex-wrap items-baseline gap-3">
        <span className="font-mono text-3xl font-semibold tabular-nums text-cyan-300">
          {loading && !balance ? "…" : (balance?.totalConfirmed ?? "0")}
        </span>
        <span className="text-sm text-zinc-500">USDC spendable across chains</span>
        {balance?.totalPending && Number(balance.totalPending) > 0 ? (
          <Badge tone="amber">{balance.totalPending} pending</Badge>
        ) : null}
      </div>

      {error ? (
        <p className="mt-3 text-xs text-amber-300">Gateway unavailable: {error.slice(0, 140)}</p>
      ) : funded.length > 0 ? (
        <div className="mt-4 space-y-1.5">
          {funded.map((chain) => (
            <div
              key={chain.chain}
              className="flex items-center justify-between rounded-lg border border-white/[0.07] bg-black/20 px-3 py-2 text-sm"
            >
              <span className="text-zinc-300">{gatewayChainLabel(chain.chain)}</span>
              <span className="font-mono tabular-nums text-emerald-300">{chain.confirmed} USDC</span>
            </div>
          ))}
        </div>
      ) : !loading ? (
        <p className="mt-3 text-xs leading-relaxed text-zinc-500">
          No Gateway balance yet. Deposit USDC into Gateway from any supported chain and it becomes
          instantly spendable on Arc — payroll no longer has to sit on the chain it runs on.
        </p>
      ) : null}

      <p className="mt-4 text-xs leading-relaxed text-zinc-600">
        Queried across {GATEWAY_CHAINS.length} EVM testnets, permissionlessly from Circle — no API
        key, no proxy. Gateway also covers non-EVM domains (Solana Devnet), which answer to a Solana
        address rather than this one.
      </p>
    </Card>
  );
}
