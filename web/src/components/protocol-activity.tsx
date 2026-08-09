"use client";

import { useState } from "react";
import { usePublicClient } from "wagmi";
import { parseAbiItem } from "viem";
import { useProtocolActivity, type ProtocolActivityEntry } from "@/lib/activity";
import { SLUICE_ADDRESSES, SLUICE_FROM_BLOCK, sluiceAbi } from "@/lib/sluice";
import { arcTestnet } from "@/lib/arc";
import { explorerTxUrl } from "@/lib/explorer";
import { Button, Card } from "@/components/ui";

/** Live protocol-wide event feed - every row links to its transaction. */
export function ProtocolActivity() {
  const { data, isLoading } = useProtocolActivity(20);
  // This tanstack build's rolled-up declarations collapse the data generic to
  // never through the hook boundary; the runtime shape is exactly this.
  const entries = (data ?? []) as ProtocolActivityEntry[];
  return (
    <Card>
      {isLoading && !entries.length ? (
        <p className="text-sm text-zinc-500">Reading protocol history from Arc…</p>
      ) : !entries.length ? (
        <p className="text-sm text-zinc-500">No activity yet.</p>
      ) : (
        <ul className="space-y-2">
          {entries.map((entry) => (
            <li
              key={`${entry.txHash}-${entry.text}`}
              className="flex items-baseline justify-between gap-3 border-t border-[var(--hairline)] pt-2 text-sm first:border-t-0 first:pt-0"
            >
              <span className="min-w-0 text-zinc-300">{entry.text}</span>
              <a
                href={explorerTxUrl(arcTestnet.id, entry.txHash)}
                target="_blank"
                rel="noreferrer"
                className="shrink-0 font-mono text-[11px] text-zinc-600 underline decoration-white/10 underline-offset-2 transition-colors hover:text-cyan-300"
              >
                block {entry.block.toString()} ↗
              </a>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

const withdrawalEvent = parseAbiItem(
  "event StreamWithdrawal(uint256 indexed streamId, address indexed to, uint256 amount, uint256 tax)",
);

const usdc = (value: bigint) => (Number(value) / 1e6).toFixed(6);

/**
 * Compliance export: every withdrawal with its enforced tax split, as CSV.
 * Pure event reading - the tax ledger IS the chain, this just reformats it
 * for an accountant.
 */
export function TaxExportButton() {
  const client = usePublicClient({ chainId: arcTestnet.id });
  const [busy, setBusy] = useState(false);

  const exportCsv = async () => {
    const sluice = SLUICE_ADDRESSES[arcTestnet.id];
    if (!client || !sluice || busy) return;
    setBusy(true);
    try {
      const latest = await client.getBlockNumber();
      const logs = [];
      for (let from = SLUICE_FROM_BLOCK[arcTestnet.id]; from <= latest; from += 9_999n) {
        const to = from + 9_998n > latest ? latest : from + 9_998n;
        logs.push(
          ...(await client.getLogs({ address: sluice, event: withdrawalEvent, fromBlock: from, toBlock: to })),
        );
      }

      const streamIds = [...new Set(logs.map((log) => log.args.streamId!))];
      const streams = await client.multicall({
        contracts: streamIds.map((id) => ({
          address: sluice,
          abi: sluiceAbi,
          functionName: "streams" as const,
          args: [id] as const,
        })),
        allowFailure: true,
      });
      const streamInfo = new Map(
        streamIds.map((id, index) => {
          const tuple =
            streams[index]?.status === "success" ? (streams[index].result as readonly unknown[]) : undefined;
          return [
            id,
            {
              employer: (tuple?.[0] as string) ?? "",
              taxBps: tuple ? Number(tuple[7]) : 0,
              taxVault: (tuple?.[8] as string) ?? "",
            },
          ];
        }),
      );

      const blockNumbers = [...new Set(logs.map((log) => log.blockNumber!))];
      const blocks = await Promise.all(blockNumbers.map((number) => client.getBlock({ blockNumber: number })));
      const timestamps = new Map(blockNumbers.map((number, index) => [number, blocks[index].timestamp]));

      const rows = logs.map((log) => {
        const info = streamInfo.get(log.args.streamId!)!;
        const gross = log.args.amount!;
        const tax = log.args.tax!;
        const at = new Date(Number(timestamps.get(log.blockNumber!) ?? 0n) * 1000).toISOString();
        return [
          at,
          log.args.streamId!.toString(),
          log.args.to,
          usdc(gross),
          usdc(tax),
          usdc(gross - tax),
          String(info.taxBps),
          info.taxVault,
          info.employer,
          log.transactionHash,
        ].join(",");
      });

      const header =
        "timestamp_utc,stream_id,paid_to,gross_usdc,tax_usdc,net_usdc,tax_bps,tax_vault,employer,tx_hash";
      const blob = new Blob([[header, ...rows].join("\n")], { type: "text/csv" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `sluice-tax-withholding-${new Date().toISOString().slice(0, 10)}.csv`;
      anchor.click();
      URL.revokeObjectURL(url);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Button variant="ghost" disabled={busy} onClick={() => void exportCsv()}>
      {busy ? "Building CSV…" : "Export tax CSV"}
    </Button>
  );
}
