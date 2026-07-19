"use client";

import Link from "next/link";
import { useAccount } from "wagmi";
import { useNow, useStream } from "@/lib/hooks";
import { liveAvailable, liveVested } from "@/lib/sluice";
import { formatDuration, formatUsdc, formatUsdcExact, shortAddr } from "@/lib/format";
import { Badge, Card, ProgressBar } from "./ui";

export function StreamCard({ id }: { id: bigint }) {
  const { stream } = useStream(id);
  const { address } = useAccount();
  const now = useNow();

  if (!stream) {
    return (
      <Card className="animate-pulse">
        <div className="h-4 w-24 rounded bg-white/10" />
        <div className="mt-4 h-8 w-40 rounded bg-white/10" />
        <div className="mt-4 h-2 w-full rounded bg-white/10" />
      </Card>
    );
  }

  const vested = liveVested(stream, now);
  const available = liveAvailable(stream, now);
  const pct = stream.deposit > 0n ? Number((vested * 10_000n) / stream.deposit) / 100 : 0;
  const end = Number(stream.start + stream.duration);
  const secondsLeft = Math.max(0, end - now);
  const isMine = address?.toLowerCase() === stream.owner.toLowerCase();
  const isEmployer = address?.toLowerCase() === stream.employer.toLowerCase();

  return (
    <Link href={`/streams/${id.toString()}`} className="block">
      <Card className="transition-colors hover:border-cyan-400/30">
        <div className="flex items-start justify-between gap-2">
          <div>
            <div className="font-mono text-xs text-zinc-500">Stream #{id.toString()}</div>
            <div className="mt-0.5 text-sm text-zinc-400">
              {isEmployer ? (
                <>to <span className="text-zinc-200">{shortAddr(stream.owner)}</span></>
              ) : (
                <>from <span className="text-zinc-200">{shortAddr(stream.employer)}</span></>
              )}
            </div>
          </div>
          <div className="flex flex-wrap justify-end gap-1.5">
            {stream.canceled ? <Badge tone="red">Canceled</Badge> : null}
            {!stream.canceled && stream.salePrice > 0n ? <Badge tone="amber">Listed</Badge> : null}
            {stream.insured ? <Badge tone="emerald">Insured</Badge> : null}
            {isMine && !stream.canceled ? <Badge tone="cyan">Receiving</Badge> : null}
          </div>
        </div>

        <div className="mt-4 flex items-baseline gap-2">
          <span className="font-mono text-2xl font-semibold tabular-nums text-zinc-50">
            {formatUsdc(stream.remaining)}
          </span>
          <span className="text-xs text-zinc-500">USDC remaining</span>
        </div>

        <div className="mt-3">
          <ProgressBar pct={pct} tone={stream.canceled ? "muted" : "flow"} />
          <div className="mt-1.5 flex justify-between text-xs text-zinc-500">
            <span>{pct.toFixed(1)}% vested</span>
            <span>{stream.canceled ? "stopped" : secondsLeft > 0 ? `${formatDuration(secondsLeft)} left` : "fully vested"}</span>
          </div>
        </div>

        <div className="mt-3 flex justify-between border-t border-white/[0.06] pt-3 text-xs">
          <span className="text-zinc-500">
            {formatUsdcExact(stream.ratePerSecond)} USDC/s
          </span>
          <span className="font-mono tabular-nums text-emerald-300">
            {formatUsdc(available)} claimable
          </span>
        </div>
      </Card>
    </Link>
  );
}
