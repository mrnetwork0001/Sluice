"use client";

import { useMemo } from "react";
import { useAccount, useReadContract, useReadContracts } from "wagmi";
import { useStreamIds, useSluiceAddress, useUsdcBalance } from "@/lib/hooks";
import { sluiceAbi } from "@/lib/sluice";
import { formatUsdc } from "@/lib/format";
import { arcTestnet } from "@/lib/arc";
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
    chainId: arcTestnet.id,
    query: { enabled: Boolean(sluice), refetchInterval: 8_000 },
  });

  // Ownership can change hands via marketplace and cross-chain buys, so group by
  // the SFT's current owner rather than the recipient from the creation event.
  const { data: owners } = useReadContracts({
    contracts: (streamRefs ?? []).map((ref) => ({
      address: sluice!,
      abi: sluiceAbi,
      functionName: "ownerOf" as const,
      args: [ref.id] as const,
      chainId: arcTestnet.id,
    })),
    allowFailure: true,
    query: { enabled: Boolean(sluice && streamRefs?.length), refetchInterval: 5_000 },
  });

  const { incoming, outgoing } = useMemo(() => {
    const refs = streamRefs ?? [];
    const mine = address?.toLowerCase();
    return {
      incoming: refs.filter((ref, index) => {
        const owner = owners?.[index]?.status === "success" ? (owners[index].result as string) : ref.recipient;
        return owner.toLowerCase() === mine;
      }),
      outgoing: refs.filter((ref) => ref.employer.toLowerCase() === mine),
    };
  }, [streamRefs, owners, address]);

  if (!isConnected) {
    return (
      <div className="py-16">
        <Card className="mx-auto flex max-w-md flex-col items-center gap-4 py-12 text-center">
          <h1 className="text-xl font-bold text-zinc-50">Your dashboard is waiting</h1>
          <p className="max-w-sm text-sm text-zinc-400">
            Connect a wallet on Arc Testnet to see your salary streams, claimable balances, and
            the streams you fund. Need gas USDC? Grab some at{" "}
            <a
              href="https://faucet.circle.com"
              target="_blank"
              rel="noreferrer"
              className="text-cyan-400 hover:text-cyan-300"
            >
              faucet.circle.com
            </a>
            .
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
        sub={sluice ? undefined : "No Sluice deployment on this chain - switch network or set NEXT_PUBLIC_SLUICE_ADDRESS."}
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="Wallet USDC"
          value={usdcBalance !== undefined ? formatUsdc(usdcBalance as bigint) : "-"}
          accent="text-emerald-300"
        />
        <Stat label="Incoming streams" value={incoming.length} sub="streams paying you" />
        <Stat label="Outgoing streams" value={outgoing.length} sub="streams you fund" />
        <Stat
          label="Insurance pool"
          value={poolBalance !== undefined ? formatUsdc(poolBalance as bigint) : "-"}
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
            body="When an employer opens a salary stream to your address, it appears here - or buy one on the marketplace."
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
