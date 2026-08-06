"use client";

import { useEffect, useState } from "react";
import { useAccount } from "wagmi";
import {
  GATEWAY_CHAINS,
  depositToGateway,
  fetchUnifiedBalance,
  gatewayChainForId,
  gatewayChainLabel,
  type UnifiedBalance,
} from "@/lib/gateway";
import { Badge, Button, Card, CardTitle, inputClass } from "@/components/ui";

/**
 * Circle Gateway panel: the employer's USDC across every supported chain as one
 * spendable number. Payroll capital is rarely where payroll runs - this is the
 * treasury view that makes that a non-problem.
 */
export function UnifiedBalancePanel() {
  const { address, isConnected, chainId } = useAccount();
  const [balance, setBalance] = useState<UnifiedBalance | undefined>();
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(false);
  const [amount, setAmount] = useState("");
  const [depositing, setDepositing] = useState(false);
  const [depositNote, setDepositNote] = useState<string>();
  const [depositUrl, setDepositUrl] = useState<string>();
  const [reloadKey, setReloadKey] = useState(0);

  const depositChain = gatewayChainForId(chainId);

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
  }, [address, reloadKey]);

  const deposit = async () => {
    if (!depositChain) return;
    setDepositing(true);
    setDepositNote(undefined);
    setDepositUrl(undefined);
    try {
      const result = await depositToGateway({ chain: depositChain, amount });
      setDepositUrl(result.explorerUrl);
      setDepositNote(
        `Deposited ${amount} USDC from ${gatewayChainLabel(depositChain)}. Gateway credits it after finality.`,
      );
      setAmount("");
      setReloadKey((key) => key + 1);
    } catch (err) {
      setDepositNote(err instanceof Error ? err.message : String(err));
    } finally {
      setDepositing(false);
    }
  };

  if (!isConnected) return null;

  const funded = balance?.chains.filter((chain) => Number(chain.confirmed) > 0) ?? [];

  return (
    <Card>
      <CardTitle hint="Circle Gateway · no bridging, no pre-positioning">
        Gateway balance
      </CardTitle>

      <div className="flex flex-wrap items-baseline gap-3">
        <span className="font-mono text-3xl font-semibold tabular-nums text-cyan-300">
          {loading && !balance ? "…" : (balance?.totalConfirmed ?? "0")}
        </span>
        <span className="text-sm text-zinc-500">USDC deposited into Gateway</span>
        {balance?.totalPending && Number(balance.totalPending) > 0 ? (
          <Badge tone="amber">{balance.totalPending} pending</Badge>
        ) : null}
      </div>
      <p className="mt-1.5 text-xs text-zinc-500">
        This is not your wallet balance. It counts only USDC you have deposited into Gateway, which
        is then spendable on any supported chain without bridging.
      </p>

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
          Nothing deposited yet. Move USDC in below and it becomes instantly spendable on Arc -
          payroll no longer has to sit on the chain it runs on.
        </p>
      ) : null}

      <div className="mt-4 border-t border-white/[0.06] pt-4">
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            inputMode="decimal"
            placeholder="25.00"
            className={`${inputClass} w-32 font-mono`}
          />
          <Button
            onClick={deposit}
            disabled={depositing || !depositChain || !(Number(amount) > 0)}
          >
            {depositing
              ? "Depositing…"
              : depositChain
                ? `Deposit from ${gatewayChainLabel(depositChain)}`
                : "Unsupported chain"}
          </Button>
        </div>
        <p className="mt-2 text-xs text-zinc-600">
          Deposits come from the chain your wallet is on now. One EIP-3009 signature plus one
          transaction - no separate approval.
        </p>
        {depositNote ? <p className="mt-2 text-xs text-cyan-300">{depositNote}</p> : null}
        {depositUrl ? (
          <a
            href={depositUrl}
            target="_blank"
            rel="noreferrer"
            className="mt-1 inline-block font-mono text-xs text-cyan-400 hover:text-cyan-300"
          >
            view deposit ↗
          </a>
        ) : null}
      </div>

      <p className="mt-4 text-xs leading-relaxed text-zinc-600">
        Queried across {GATEWAY_CHAINS.length} EVM testnets, permissionlessly from Circle - no API
        key, no proxy. Gateway also covers non-EVM domains (Solana Devnet), which answer to a Solana
        address rather than this one.
      </p>
    </Card>
  );
}
