"use client";

import { useMemo, useState } from "react";
import { useAccount, useReadContract } from "wagmi";
import { useNow, useSluiceAddress, useSluiceWrite, useStream, useStreamIds } from "@/lib/hooks";
import { liveVested, sluiceAbi, type Stream } from "@/lib/sluice";
import { formatDuration, formatUsdc, parseUsdc, shortAddr } from "@/lib/format";
import {
  Badge,
  Button,
  Card,
  CardTitle,
  EmptyState,
  PageHeader,
  ProgressBar,
  TxBanner,
  inputClass,
} from "@/components/ui";
import { useChainId } from "wagmi";
import {
  ARC_DOMAIN,
  REMOTE_SIDES,
  FINALITY_FAST,
  GATE_ADDRESS,
  addressToBytes32,
  crossChainEnabled,
  encodeBuyStreamHook,
  fastMaxFee,
  hookDestinationCaller,
  messengerAbi,
} from "@/lib/crosschain";
import Link from "next/link";
import { arcTestnet } from "@/lib/arc";

export default function MarketplacePage() {
  const { data: streamRefs, isLoading } = useStreamIds();

  return (
    <div>
      <PageHeader
        title="Stream marketplace"
        sub="Buy future salary streams at a discount - sellers get instant liquidity, you collect the full stream."
      />
      {isLoading ? (
        <div className="text-sm text-zinc-500">Scanning chain for listings…</div>
      ) : !streamRefs || streamRefs.length === 0 ? (
        <EmptyState
          title="No streams exist yet"
          body="Once salary streams are created and listed for sale, they show up here."
          action={{ href: "/create", label: "Create the first stream" }}
        />
      ) : (
        <ListingsGrid ids={streamRefs.map((ref) => ref.id)} />
      )}

      <section className="mt-10">
        <h2 className="mb-4 text-lg font-bold text-zinc-100">Underwrite salaries, earn premiums</h2>
        <InsurancePoolCard />
      </section>
    </div>
  );
}

function InsurancePoolCard() {
  const { address } = useAccount();
  const sluice = useSluiceAddress();
  const { send, status, reset, busy } = useSluiceWrite();
  const [amount, setAmount] = useState("");

  const { data: poolBalance } = useReadContract({
    address: sluice,
    abi: sluiceAbi,
    functionName: "poolBalance",
    chainId: arcTestnet.id,
    query: { enabled: Boolean(sluice), refetchInterval: 8_000 },
  });
  const { data: totalShares } = useReadContract({
    address: sluice,
    abi: sluiceAbi,
    functionName: "totalPoolShares",
    chainId: arcTestnet.id,
    query: { enabled: Boolean(sluice), refetchInterval: 8_000 },
  });
  const { data: myShares } = useReadContract({
    address: sluice,
    abi: sluiceAbi,
    functionName: "poolShares",
    args: address ? [address] : undefined,
    chainId: arcTestnet.id,
    query: { enabled: Boolean(sluice && address), refetchInterval: 8_000 },
  });

  const myValue =
    myShares !== undefined && totalShares !== undefined && (totalShares as bigint) > 0n
      ? ((myShares as bigint) * (poolBalance as bigint ?? 0n)) / (totalShares as bigint)
      : 0n;

  const parsed = useMemo(() => {
    try {
      return parseUsdc(amount);
    } catch {
      return undefined;
    }
  }, [amount]);

  return (
    <Card>
      <CardTitle hint="credit default pool - 0.5% premiums accrue to stakers">
        Insurance pool
      </CardTitle>
      <div className="grid gap-4 sm:grid-cols-3">
        <div>
          <div className="text-xs uppercase tracking-wider text-zinc-500">Pool balance</div>
          <div className="mt-1 font-mono text-xl font-semibold tabular-nums text-cyan-300">
            {poolBalance !== undefined ? formatUsdc(poolBalance as bigint) : "-"} USDC
          </div>
        </div>
        <div>
          <div className="text-xs uppercase tracking-wider text-zinc-500">Your stake value</div>
          <div className="mt-1 font-mono text-xl font-semibold tabular-nums text-emerald-300">
            {formatUsdc(myValue)} USDC
          </div>
        </div>
        <div className="flex items-end gap-2">
          <input
            className={inputClass}
            placeholder="Amount"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
          />
          <Button
            disabled={busy || parsed === undefined || parsed === 0n || !address}
            onClick={() =>
              parsed !== undefined &&
              void send({
                functionName: "stakeInsurancePool",
                args: [parsed],
                usdcApproval: parsed,
                label: `Staked ${formatUsdc(parsed)} USDC into the pool`,
                onSuccess: () => setAmount(""),
              })
            }
          >
            Stake
          </Button>
          <Button
            variant="ghost"
            disabled={busy || !address || (myShares as bigint | undefined) === undefined || (myShares as bigint) === 0n}
            onClick={() =>
              void send({
                functionName: "unstakeInsurancePool",
                args: [myShares as bigint],
                label: "Unstaked full pool position",
              })
            }
          >
            Exit
          </Button>
        </div>
      </div>
      <TxBanner status={status} onDismiss={reset} />
    </Card>
  );
}

function ListingsGrid({ ids }: { ids: bigint[] }) {
  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
      {ids.map((id) => (
        <ListingCard key={id.toString()} id={id} />
      ))}
    </div>
  );
}

function ListingCard({ id }: { id: bigint }) {
  const { stream } = useStream(id);
  if (!stream || stream.canceled || stream.salePrice === 0n) return null;
  return <Listing stream={stream} />;
}

function Listing({ stream }: { stream: Stream }) {
  // Which chain to pay from when buying cross-chain. Defaults to the first
  // remote side; every one of them can burn with a BUY_STREAM hook.
  const [buySide, setBuySide] = useState(REMOTE_SIDES[0]!);
  const { address } = useAccount();
  const chainId = useChainId();
  const canCrossChain = crossChainEnabled(chainId);
  const now = useNow();
  const { send, status, reset, busy } = useSluiceWrite();

  const vested = liveVested(stream, now);
  const pct = stream.deposit > 0n ? Number((vested * 10_000n) / stream.deposit) / 100 : 0;
  const secondsLeft = Math.max(0, Number(stream.start + stream.duration) - now);
  const discountBps =
    stream.remaining > 0n ? 10_000n - (stream.salePrice * 10_000n) / stream.remaining : 0n;
  const upside = stream.remaining - stream.salePrice;
  const isSeller = address?.toLowerCase() === stream.owner.toLowerCase();

  return (
    <Card className="flex flex-col">
      <div className="flex items-start justify-between gap-2">
        <div>
          <Link
            href={`/streams/${stream.id.toString()}`}
            className="font-mono text-xs text-zinc-500 hover:text-cyan-300"
          >
            Stream #{stream.id.toString()}
          </Link>
          <div className="mt-0.5 text-sm text-zinc-400">
            seller <span className="text-zinc-200">{shortAddr(stream.owner)}</span>
          </div>
        </div>
        <div className="flex gap-1.5">
          {stream.insured ? <Badge tone="emerald">Insured</Badge> : null}
          <Badge tone="amber">{(Number(discountBps) / 100).toFixed(1)}% off</Badge>
        </div>
      </div>

      <div className="mt-4 flex items-baseline justify-between">
        <div>
          <div className="font-mono text-2xl font-semibold tabular-nums text-zinc-50">
            {formatUsdc(stream.salePrice)}
          </div>
          <div className="text-xs text-zinc-500">asking price (USDC)</div>
        </div>
        <div className="text-right">
          <div className="font-mono text-lg tabular-nums text-emerald-300">
            {formatUsdc(stream.remaining)}
          </div>
          <div className="text-xs text-zinc-500">stream value</div>
        </div>
      </div>

      <div className="mt-3">
        <ProgressBar pct={pct} />
        <div className="mt-1.5 flex justify-between text-xs text-zinc-500">
          <span>{pct.toFixed(1)}% vested</span>
          <span>{secondsLeft > 0 ? `${formatDuration(secondsLeft)} left` : "fully vested"}</span>
        </div>
      </div>

      <div className="mt-4 border-t border-white/[0.06] pt-3 text-xs text-zinc-500">
        Potential upside{" "}
        <span className="font-mono text-emerald-300">{formatUsdc(upside)} USDC</span> before tax
      </div>

      <div className="mt-3 space-y-2">
        {isSeller ? (
          <Button
            variant="ghost"
            disabled={busy}
            onClick={() =>
              void send({
                functionName: "listStreamForSale",
                args: [stream.id, 0n],
                label: "Listing removed",
              })
            }
          >
            Delist my stream
          </Button>
        ) : (
          <>
            <Button
              className="w-full"
              disabled={busy || !address}
              onClick={() =>
                void send({
                  functionName: "buyStream",
                  args: [stream.id],
                  usdcApproval: stream.salePrice,
                  label: `Bought stream #${stream.id.toString()} for ${formatUsdc(stream.salePrice)} USDC`,
                })
              }
            >
              Buy for {formatUsdc(stream.salePrice)} USDC
            </Button>
            {canCrossChain && GATE_ADDRESS ? (
              <Button
                variant="ghost"
                className="w-full"
                disabled={busy || !address}
                onClick={() =>
                  address &&
                  GATE_ADDRESS &&
                  void send({
                    to: { address: buySide.messenger, abi: messengerAbi },
                    chainId: buySide.chainId,
                    functionName: "depositForBurnWithHook",
                    // Burn price + fee headroom: Circle deducts the fast-transfer
                    // fee from the mint, and the gate refunds any excess on Arc.
                    args: [
                      stream.salePrice + fastMaxFee(stream.salePrice),
                      ARC_DOMAIN,
                      addressToBytes32(GATE_ADDRESS),
                      buySide.usdc,
                      hookDestinationCaller(),
                      fastMaxFee(stream.salePrice),
                      FINALITY_FAST,
                      encodeBuyStreamHook(address, stream.id),
                    ],
                    approval: {
                      token: buySide.usdc,
                      spender: buySide.messenger,
                      amount: stream.salePrice + fastMaxFee(stream.salePrice),
                    },
                    label: `Burned ${formatUsdc(stream.salePrice)} USDC on ${buySide.label} - Circle attests and the gate settles the purchase on Arc in ~20s`,
                  })
                }
              >
                Buy from {buySide.label} via CCTP ⚡
              </Button>
            ) : null}
            {canCrossChain && GATE_ADDRESS ? (
              <select
                className={`${inputClass} mt-2 text-xs`}
                value={buySide.domain}
                onChange={(event) =>
                  setBuySide(
                    REMOTE_SIDES.find((side) => side.domain === Number(event.target.value)) ??
                      REMOTE_SIDES[0]!,
                  )
                }
              >
                {REMOTE_SIDES.map((side) => (
                  <option key={side.domain} value={side.domain}>
                    Pay from {side.label}
                  </option>
                ))}
              </select>
            ) : null}
          </>
        )}
      </div>
      <TxBanner status={status} onDismiss={reset} />
    </Card>
  );
}
