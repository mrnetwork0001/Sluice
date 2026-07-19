"use client";

import { useMemo } from "react";
import { useAccount, useReadContract } from "wagmi";
import { useStreamIds, useSluiceAddress, useUsdcBalance } from "@/lib/hooks";
import { sluiceAbi } from "@/lib/sluice";
import { formatUsdc } from "@/lib/format";
import { StreamCard } from "@/components/stream-card";
import { ConnectButton } from "@/components/connect-button";
import { Card, EmptyState, PageHeader, Stat } from "@/components/ui";

export default function DashboardPage() {
  const { address, isConnected } = useAccount();
  const sluice = useSluiceAddress();
  const { data: usdcBalance } = useUsdcBalance(address);
  const { data: streamRefs, isLoading } = useStreamIds();
  const { data: poolBalance } = useReadContract({
    address: sluice,
    abi: sluiceAbi,
    functionName: "poolBalance",
    query: { enabled: Boolean(sluice), refetchInterval: 8_000 },
  });

  const { incoming, outgoing } = useMemo(() => {
    const refs = streamRefs ?? [];
    const mine = address?.toLowerCase();
    return {
      // recipient may have changed via marketplace sales — StreamCard corrects per-card,
      // but the original recipient/employer split is right for grouping the overview.
      incoming: refs.filter((ref) => ref.recipient.toLowerCase() === mine),
      outgoing: refs.filter((ref) => ref.employer.toLowerCase() === mine),
    };
  }, [streamRefs, address]);

  if (!isConnected) {
    return (
      <div className="py-16">
        <Card className="mx-auto flex max-w-md flex-col items-center gap-4 py-12 text-center">
          <h1 className="text-xl font-bold text-zinc-50">Your dashboard is waiting</h1>
          <p className="max-w-sm text-sm text-zinc-400">
            Connect a wallet to see your salary streams, claimable balances, and the streams you
            fund — or use the demo wallet on the seeded local chain.
          </p>
          <ConnectButton />
        </Card>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Dashboard"
        sub={sluice ? undefined : "No Sluice deployment on this chain — switch network or set NEXT_PUBLIC_SLUICE_ADDRESS."}
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="Wallet USDC"
          value={usdcBalance !== undefined ? formatUsdc(usdcBalance as bigint) : "—"}
          accent="text-emerald-300"
        />
        <Stat label="Incoming streams" value={incoming.length} sub="streams paying you" />
        <Stat label="Outgoing streams" value={outgoing.length} sub="streams you fund" />
        <Stat
          label="Insurance pool"
          value={poolBalance !== undefined ? formatUsdc(poolBalance as bigint) : "—"}
          sub="USDC staked for default coverage"
          accent="text-cyan-300"
        />
      </div>

      <section className="mt-10">
        <h2 className="mb-4 text-lg font-bold text-zinc-100">Your income streams</h2>
        {isLoading ? (
          <div className="text-sm text-zinc-500">Scanning chain for streams…</div>
        ) : incoming.length === 0 ? (
          <EmptyState
            title="No incoming streams"
            body="When an employer opens a salary stream to your address, it appears here — or buy one on the marketplace."
            action={{ href: "/marketplace", label: "Browse marketplace" }}
          />
        ) : (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {incoming.map((ref) => (
              <StreamCard key={ref.id.toString()} id={ref.id} />
            ))}
          </div>
        )}
      </section>

      <section className="mt-10">
        <h2 className="mb-4 text-lg font-bold text-zinc-100">Streams you fund</h2>
        {outgoing.length === 0 ? (
          <EmptyState
            title="No outgoing streams"
            body="Open a stream to start paying someone by the second, with automatic tax withholding."
            action={{ href: "/create", label: "Create a stream" }}
          />
        ) : (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {outgoing.map((ref) => (
              <StreamCard key={ref.id.toString()} id={ref.id} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
