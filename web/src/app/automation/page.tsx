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
import { arcTestnet } from "@/lib/arc";
import { explorerTxUrl, shortHash } from "@/lib/explorer";

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
        sub="Set your own rules — any percentage, any supported token. They run automatically right after each withdrawal, powered by Circle Swap Kit."
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardTitle hint={`${enabledPct}% of each withdrawal routed`}>Add a rule</CardTitle>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Percent of withdrawal" hint="Anything from 1 to 100 — your choice">
              <input
                className={inputClass}
                value={pct}
                onChange={(event) => setPct(event.target.value)}
                placeholder="20"
              />
            </Field>
            <Field label="Convert to" hint="Tokens Circle routes on Arc">
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

          <div className="mt-5">
            <div className="mb-2 text-xs font-medium uppercase tracking-wider text-zinc-500">
              Your rules — click a value to edit
            </div>
          </div>
          <div className="space-y-2">
            {rules.length === 0 ? (
              <p className="text-sm text-zinc-500">
                No rules yet — add one above. Rules are yours to edit: change the percentage or
                token any time, toggle a rule off, or delete it. With no rules, withdrawals simply
                arrive as USDC.
              </p>
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
                    <span className="flex flex-wrap items-center gap-1.5 text-sm text-zinc-200">
                      Swap
                      <input
                        aria-label="rule percentage"
                        className="w-14 rounded-lg border border-white/10 bg-black/40 px-2 py-0.5 text-center font-mono text-sm text-cyan-300 outline-none focus:border-cyan-400/50"
                        value={rule.pct}
                        onChange={(event) => {
                          const next = Math.max(0, Math.min(100, Math.round(Number(event.target.value) || 0)));
                          update(rules.map((entry) => (entry.id === rule.id ? { ...entry, pct: next } : entry)));
                        }}
                      />
                      <span className="text-cyan-300">%</span>
                      of each withdrawal to
                      <select
                        aria-label="rule token"
                        className="rounded-lg border border-white/10 bg-black/40 px-2 py-0.5 font-mono text-sm text-emerald-300 outline-none focus:border-cyan-400/50"
                        value={rule.tokenOut}
                        onChange={(event) =>
                          update(
                            rules.map((entry) =>
                              entry.id === rule.id
                                ? { ...entry, tokenOut: event.target.value as AutoToken }
                                : entry,
                            ),
                          )
                        }
                      >
                        {AUTO_TOKENS.map((token) => (
                          <option key={token} value={token}>
                            {token}
                          </option>
                        ))}
                      </select>
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
                    {entry.txHash ? (
                      <>
                        {" "}
                        <a
                          href={entry.explorerUrl ?? explorerTxUrl(arcTestnet.id, entry.txHash)}
                          target="_blank"
                          rel="noreferrer"
                          className="font-mono text-cyan-400 underline decoration-cyan-400/30 underline-offset-2 hover:text-cyan-300"
                          title={entry.txHash}
                        >
                          {shortHash(entry.txHash)} ↗ Arcscan
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
