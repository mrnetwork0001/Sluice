"use client";

import { useEffect, useState } from "react";
import { useAccount } from "wagmi";
import {
  AUTO_TOKENS,
  loadRules,
  loadTriggerLog,
  quoteSwap,
  saveRules,
  type AutoRule,
  type AutoToken,
  type SwapQuote,
  type TriggerLogEntry,
} from "@/lib/automation";
import { Badge, Button, Card, CardTitle, EmptyState, Field, PageHeader, inputClass } from "@/components/ui";

export default function AutomationPage() {
  const { address, isConnected } = useAccount();
  const [rules, setRules] = useState<AutoRule[]>([]);
  const [log, setLog] = useState<TriggerLogEntry[]>([]);
  const [pct, setPct] = useState("20");
  const [tokenOut, setTokenOut] = useState<AutoToken>("EURC");
  const [quote, setQuote] = useState<SwapQuote | undefined>();
  const [quoteError, setQuoteError] = useState<string>();

  useEffect(() => {
    if (!address) return;
    setRules(loadRules(address));
    setLog(loadTriggerLog(address));
  }, [address]);

  // Refresh the trigger history when withdrawals elsewhere append to it.
  useEffect(() => {
    if (!address) return;
    const timer = setInterval(() => setLog(loadTriggerLog(address)), 3_000);
    return () => clearInterval(timer);
  }, [address]);

  // Live Swap Kit quote for a reference 1 USDC slice, so the rate is visible
  // before any paycheck is routed.
  useEffect(() => {
    if (!address) return;
    let cancelled = false;
    setQuote(undefined);
    setQuoteError(undefined);
    quoteSwap("1.00", tokenOut)
      .then((result) => !cancelled && setQuote(result))
      .catch((error) => !cancelled && setQuoteError(error instanceof Error ? error.message : String(error)));
    return () => {
      cancelled = true;
    };
  }, [address, tokenOut]);

  if (!isConnected || !address) {
    return (
      <div>
        <PageHeader title="Stream-to-DeFi automation" />
        <EmptyState
          title="Connect a wallet"
          body="Auto-trigger rules are configured per wallet and run after each salary withdrawal."
        />
      </div>
    );
  }

  const update = (next: AutoRule[]) => {
    setRules(next);
    saveRules(address, next);
  };

  const addRule = () => {
    const parsed = Math.round(Number(pct));
    if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 100) return;
    const total = rules.filter((rule) => rule.enabled).reduce((sum, rule) => sum + rule.pct, 0);
    if (total + parsed > 100) return;
    update([
      ...rules,
      { id: `${Date.now()}`, pct: parsed, tokenOut, enabled: true },
    ]);
    setPct("20");
  };

  const enabledPct = rules.filter((rule) => rule.enabled).reduce((sum, rule) => sum + rule.pct, 0);

  return (
    <div>
      <PageHeader
        title="Stream-to-DeFi automation"
        sub="Routing rules run right after each withdrawal — powered by Circle Swap Kit."
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardTitle hint={`${enabledPct}% of each withdrawal routed`}>Add a rule</CardTitle>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Percent of withdrawal">
              <input
                className={inputClass}
                value={pct}
                onChange={(event) => setPct(event.target.value)}
                placeholder="20"
              />
            </Field>
            <Field label="Convert to">
              <select
                className={inputClass}
                value={tokenOut}
                onChange={(event) => setTokenOut(event.target.value as AutoToken)}
              >
                {AUTO_TOKENS.map((token) => (
                  <option key={token} value={token}>
                    {token}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <div className="mt-3 flex items-center gap-3">
            <Button onClick={addRule}>Add rule</Button>
            <span className="text-xs text-zinc-500">
              e.g. “swap 20% of every paycheck to EURC”
            </span>
          </div>

          <div className="mt-4 rounded-xl border border-cyan-400/15 bg-cyan-400/5 px-3.5 py-2.5 text-xs">
            {quote ? (
              <>
                <span className="text-zinc-400">Live Swap Kit rate — </span>
                <span className="font-mono text-cyan-300">1.00 USDC</span>
                <span className="text-zinc-400"> → </span>
                <span className="font-mono text-emerald-300">
                  {quote.estimatedOutput} {quote.tokenOut}
                </span>
                <span className="text-zinc-500">
                  {" "}· min {quote.minimumOutput} after slippage
                  {quote.gasFee ? ` · ~${quote.gasFee} USDC gas` : ""}
                </span>
              </>
            ) : quoteError ? (
              <span className="text-amber-300">Quote unavailable: {quoteError.slice(0, 120)}</span>
            ) : (
              <span className="text-zinc-500">Fetching live {tokenOut} rate from Circle…</span>
            )}
          </div>

          <div className="mt-5 space-y-2">
            {rules.length === 0 ? (
              <p className="text-sm text-zinc-500">No rules yet.</p>
            ) : (
              rules.map((rule) => (
                <div
                  key={rule.id}
                  className="flex items-center justify-between rounded-xl border border-white/[0.07] bg-black/20 px-3.5 py-2.5"
                >
                  <div className="flex items-center gap-3">
                    <button
                      onClick={() =>
                        update(
                          rules.map((entry) =>
                            entry.id === rule.id ? { ...entry, enabled: !entry.enabled } : entry,
                          ),
                        )
                      }
                      className={`h-5 w-9 rounded-full p-0.5 transition-colors ${
                        rule.enabled ? "bg-emerald-500/80" : "bg-white/10"
                      }`}
                      aria-label="toggle rule"
                    >
                      <span
                        className={`block h-4 w-4 rounded-full bg-white transition-transform ${
                          rule.enabled ? "translate-x-4" : ""
                        }`}
                      />
                    </button>
                    <span className="text-sm text-zinc-200">
                      Swap <span className="font-mono text-cyan-300">{rule.pct}%</span> of each
                      withdrawal to <span className="font-mono text-emerald-300">{rule.tokenOut}</span>
                    </span>
                  </div>
                  <button
                    onClick={() => update(rules.filter((entry) => entry.id !== rule.id))}
                    className="text-zinc-600 hover:text-red-300"
                  >
                    ✕
                  </button>
                </div>
              ))
            )}
          </div>
        </Card>

        <Card>
          <CardTitle hint="latest 50">Trigger history</CardTitle>
          {log.length === 0 ? (
            <p className="text-sm text-zinc-500">
              Nothing yet — withdraw from a stream with a rule enabled and the conversion appears
              here.
            </p>
          ) : (
            <div className="space-y-2">
              {log.map((entry, index) => (
                <div
                  key={index}
                  className="rounded-xl border border-white/[0.07] bg-black/20 px-3.5 py-2.5 text-sm"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-zinc-200">
                      {entry.amountIn} USDC → {entry.amountOut ? `${entry.amountOut} ` : ""}
                      {entry.tokenOut}
                      <span className="ml-2 text-xs text-zinc-500">
                        stream #{entry.streamId} · {entry.pct}%
                      </span>
                    </span>
                    <Badge
                      tone={
                        entry.status === "executed"
                          ? "emerald"
                          : entry.status === "skipped"
                            ? "zinc"
                            : "red"
                      }
                    >
                      {entry.status}
                    </Badge>
                  </div>
                  <div className="mt-1 text-xs text-zinc-500">
                    {new Date(entry.at).toLocaleString()} — {entry.detail}
                    {entry.explorerUrl ? (
                      <>
                        {" "}
                        <a
                          href={entry.explorerUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="text-cyan-400 hover:text-cyan-300"
                        >
                          view tx ↗
                        </a>
                      </>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      <Card className="mt-4">
        <CardTitle>How it works</CardTitle>
        <p className="text-sm leading-relaxed text-zinc-400">
          Rules are stored per wallet and evaluated after every successful{" "}
          <span className="font-mono text-zinc-300">withdrawFromStream</span>. Each rule slices the
          net (post-tax) payout and swaps it through{" "}
          <span className="text-cyan-300">Circle Swap Kit</span> on Arc Testnet using your connected
          wallet — a real on-chain conversion routed by Circle, with the transaction linked above.
          EURC on Arc lives at{" "}
          <span className="font-mono text-zinc-300">0x89B5…D72a</span>; gas is paid in USDC like
          everything else on Arc, so small slices can cost more in gas than they convert.
        </p>
      </Card>
    </div>
  );
}
