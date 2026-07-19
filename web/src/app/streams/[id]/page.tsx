"use client";

import { useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { useAccount } from "wagmi";
import { useNow, useSluiceWrite, useStream } from "@/lib/hooks";
import { liveAvailable, liveVested, maxAdvance, type Stream } from "@/lib/sluice";
import { loadRules, runAutoTriggers, type TriggerLogEntry } from "@/lib/automation";
import { BASE_DOMAIN, GATE_ADDRESS } from "@/lib/crosschain";
import { gateAbi } from "@/lib/gateAbi";
import {
  formatBps,
  formatDuration,
  formatUsdc,
  formatUsdcExact,
  parseUsdc,
  shortAddr,
} from "@/lib/format";
import {
  Badge,
  Button,
  Card,
  CardTitle,
  PageHeader,
  ProgressBar,
  TxBanner,
  inputClass,
} from "@/components/ui";

export default function StreamDetailPage() {
  const params = useParams<{ id: string }>();
  const id = useMemo(() => {
    try {
      return BigInt(params.id);
    } catch {
      return undefined;
    }
  }, [params.id]);
  const { stream, isLoading } = useStream(id);

  if (id === undefined) return <PageHeader title="Invalid stream id" />;
  if (isLoading && !stream) {
    return <div className="py-20 text-center text-sm text-zinc-500">Loading stream…</div>;
  }
  if (!stream) {
    return (
      <div className="py-20 text-center text-sm text-zinc-500">
        Stream #{id.toString()} not found on this chain.
      </div>
    );
  }
  return <StreamDetail stream={stream} />;
}

function StreamDetail({ stream }: { stream: Stream }) {
  const { address } = useAccount();
  const now = useNow();

  const vested = liveVested(stream, now);
  const available = liveAvailable(stream, now);
  const pct = stream.deposit > 0n ? Number((vested * 10_000n) / stream.deposit) / 100 : 0;
  const secondsLeft = Math.max(0, Number(stream.start + stream.duration) - now);

  const me = address?.toLowerCase();
  const isOwner = me === stream.owner.toLowerCase();
  const isEmployer = me === stream.employer.toLowerCase();

  return (
    <div>
      <PageHeader
        title={`Stream #${stream.id.toString()}`}
        sub={`${shortAddr(stream.employer)} → ${shortAddr(stream.owner)}`}
      >
        <div className="flex gap-1.5">
          {stream.canceled ? <Badge tone="red">Canceled</Badge> : null}
          {!stream.canceled && stream.salePrice > 0n ? (
            <Badge tone="amber">Listed · {formatUsdc(stream.salePrice)} USDC</Badge>
          ) : null}
          {stream.insured ? <Badge tone="emerald">Insured</Badge> : null}
        </div>
      </PageHeader>

      <Card>
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <div className="text-xs uppercase tracking-wider text-zinc-500">Remaining</div>
            <div className="mt-1 font-mono text-2xl font-semibold tabular-nums text-zinc-50">
              {formatUsdc(stream.remaining)}
            </div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-wider text-zinc-500">Claimable now</div>
            <div className="mt-1 font-mono text-2xl font-semibold tabular-nums text-emerald-300">
              {formatUsdc(available)}
            </div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-wider text-zinc-500">Rate</div>
            <div className="mt-1 font-mono text-2xl font-semibold tabular-nums text-cyan-300">
              {formatUsdcExact(stream.ratePerSecond)}
              <span className="text-sm text-zinc-500"> /s</span>
            </div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-wider text-zinc-500">Withdrawn · Advanced</div>
            <div className="mt-1 font-mono text-2xl font-semibold tabular-nums text-zinc-300">
              {formatUsdc(stream.withdrawn)}
              <span className="text-sm text-zinc-500"> · {formatUsdc(stream.advanced)}</span>
            </div>
          </div>
        </div>
        <div className="mt-6">
          <ProgressBar pct={pct} tone={stream.canceled ? "muted" : "flow"} />
          <div className="mt-2 flex flex-wrap justify-between gap-2 text-xs text-zinc-500">
            <span>
              {pct.toFixed(2)}% of {formatUsdc(stream.deposit)} USDC vested
            </span>
            <span>
              tax {formatBps(stream.taxBps)}
              {stream.taxBps > 0 ? ` → ${shortAddr(stream.taxVault)}` : ""} ·{" "}
              {stream.canceled
                ? "stream stopped"
                : secondsLeft > 0
                  ? `${formatDuration(secondsLeft)} remaining`
                  : "fully vested"}
            </span>
          </div>
        </div>
      </Card>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        {isOwner && !stream.canceled ? <WithdrawCard stream={stream} available={available} /> : null}
        {isOwner && !stream.canceled ? <AdvanceCard stream={stream} /> : null}
        {isOwner && !stream.canceled ? <MarketplaceCard stream={stream} /> : null}
        {isOwner && !stream.canceled ? <SplitCard stream={stream} /> : null}
        {isOwner ? <InsuranceCard stream={stream} /> : null}
        {isEmployer && !stream.canceled ? <EmployerCard stream={stream} /> : null}
        {!isOwner && !isEmployer ? (
          <Card>
            <CardTitle>View only</CardTitle>
            <p className="text-sm text-zinc-500">
              Connect as the stream owner ({shortAddr(stream.owner)}) or the employer (
              {shortAddr(stream.employer)}) to act on this stream
              {stream.salePrice > 0n ? ", or buy it on the marketplace" : ""}.
            </p>
          </Card>
        ) : null}
      </div>
    </div>
  );
}

function WithdrawCard({ stream, available }: { stream: Stream; available: bigint }) {
  const { send, status, reset, busy } = useSluiceWrite();
  const { address } = useAccount();
  const [amount, setAmount] = useState("");
  const [dest, setDest] = useState<"arc" | "base">("arc");
  const [triggers, setTriggers] = useState<TriggerLogEntry[]>([]);

  const parsed = useMemo(() => {
    try {
      return parseUsdc(amount);
    } catch {
      return undefined;
    }
  }, [amount]);
  const tax = parsed !== undefined ? (parsed * BigInt(stream.taxBps)) / 10_000n : undefined;
  const activeRules = address ? loadRules(address).filter((rule) => rule.enabled) : [];
  const crossChain = dest === "base";

  return (
    <Card>
      <CardTitle hint={`tax ${formatBps(stream.taxBps)} auto-split`}>Withdraw salary</CardTitle>
      <div className="flex gap-2">
        <input
          className={inputClass}
          placeholder="0.00"
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
        />
        <Button variant="ghost" onClick={() => setAmount(formatUsdc(available).replace(/,/g, ""))}>
          Max
        </Button>
      </div>
      <div className="mt-2">
        <select
          className={inputClass}
          value={dest}
          onChange={(event) => setDest(event.target.value as "arc" | "base")}
        >
          <option value="arc">Pay out here on Arc (local)</option>
          <option value="base">Pay out on Base (local) — via CCTP</option>
        </select>
      </div>
      {parsed !== undefined && tax !== undefined && parsed > 0n ? (
        <div className="mt-2 text-xs text-zinc-500">
          You receive <span className="text-emerald-300">{formatUsdc(parsed - tax)}</span> USDC
          {crossChain ? " on Base" : ""} · tax vault gets{" "}
          <span className="text-zinc-300">{formatUsdc(tax)}</span> on Arc
          {crossChain ? (
            <> · burned via CCTP, minted by the relayer</>
          ) : activeRules.length > 0 ? (
            <> · then {activeRules.length} auto-trigger{activeRules.length > 1 ? "s" : ""} run</>
          ) : null}
        </div>
      ) : null}
      <div className="mt-3">
        <Button
          disabled={busy || parsed === undefined || parsed === 0n || parsed > available}
          onClick={() => {
            if (parsed === undefined || !address) return;
            const net = parsed - (parsed * BigInt(stream.taxBps)) / 10_000n;
            if (crossChain) {
              void send({
                to: { address: GATE_ADDRESS, abi: gateAbi },
                functionName: "withdrawToChain",
                args: [stream.id, parsed, BASE_DOMAIN, address],
                label: `Withdrew ${formatUsdc(parsed)} USDC — ${formatUsdc(net)} net exiting to Base via CCTP`,
                onSuccess: () => setAmount(""),
              });
            } else {
              void send({
                functionName: "withdrawFromStream",
                args: [stream.id, parsed],
                label: `Withdrew ${formatUsdc(parsed)} USDC from stream #${stream.id.toString()}`,
                onSuccess: async () => {
                  const entries = await runAutoTriggers({
                    account: address,
                    streamId: stream.id,
                    netAmount: net,
                  });
                  setTriggers(entries);
                  setAmount("");
                },
              });
            }
          }}
        >
          {crossChain ? "Withdraw to Base" : "Withdraw"}
        </Button>
      </div>
      <TxBanner status={status} onDismiss={reset} />
      {triggers.map((entry, index) => (
        <div
          key={index}
          className="mt-2 rounded-xl border border-cyan-400/20 bg-cyan-400/5 px-3.5 py-2.5 text-xs text-cyan-200"
        >
          ⚡ Auto-trigger: {entry.pct}% → {entry.tokenOut} ({entry.amountIn} USDC) —{" "}
          {entry.status === "executed" ? "executed via Circle Swap Kit" : entry.status}
          <div className="mt-0.5 text-cyan-200/60">{entry.detail}</div>
        </div>
      ))}
    </Card>
  );
}

function AdvanceCard({ stream }: { stream: Stream }) {
  const { send, status, reset, busy } = useSluiceWrite();
  const [amount, setAmount] = useState("");
  const cap = maxAdvance(stream);
  const parsed = useMemo(() => {
    try {
      return parseUsdc(amount);
    } catch {
      return undefined;
    }
  }, [amount]);

  return (
    <Card>
      <CardTitle hint="borrow against future salary">Salary advance</CardTitle>
      <p className="mb-3 text-xs text-zinc-500">
        Take up to 50% of your unwithdrawn stream value now; it repays itself as salary vests.
        Available: <span className="font-mono text-zinc-300">{formatUsdc(cap)}</span> USDC.
      </p>
      <div className="flex gap-2">
        <input
          className={inputClass}
          placeholder="0.00"
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
        />
        <Button variant="ghost" onClick={() => setAmount(formatUsdc(cap).replace(/,/g, ""))}>
          Max
        </Button>
      </div>
      <div className="mt-3">
        <Button
          disabled={busy || parsed === undefined || parsed === 0n || parsed > cap}
          onClick={() =>
            parsed !== undefined &&
            void send({
              functionName: "borrowSalaryAdvance",
              args: [stream.id, parsed],
              label: `Advanced ${formatUsdc(parsed)} USDC`,
              onSuccess: () => setAmount(""),
            })
          }
        >
          Borrow advance
        </Button>
      </div>
      <TxBanner status={status} onDismiss={reset} />
    </Card>
  );
}

function MarketplaceCard({ stream }: { stream: Stream }) {
  const { send, status, reset, busy } = useSluiceWrite();
  const [price, setPrice] = useState("");
  const parsed = useMemo(() => {
    try {
      return parseUsdc(price);
    } catch {
      return undefined;
    }
  }, [price]);
  const listed = stream.salePrice > 0n;
  const discount =
    parsed !== undefined && stream.remaining > 0n
      ? 100 - Number((parsed * 10_000n) / stream.remaining) / 100
      : undefined;

  return (
    <Card>
      <CardTitle hint="factoring — instant liquidity">Sell this stream</CardTitle>
      {listed ? (
        <>
          <p className="mb-3 text-sm text-zinc-400">
            Listed at <span className="font-mono text-amber-300">{formatUsdc(stream.salePrice)}</span>{" "}
            USDC ({(100 - Number((stream.salePrice * 10_000n) / stream.remaining) / 100).toFixed(1)}%
            discount to remaining value).
          </p>
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
            Delist
          </Button>
        </>
      ) : (
        <>
          <p className="mb-3 text-xs text-zinc-500">
            List your remaining {formatUsdc(stream.remaining)} USDC stream for upfront cash. Buyers
            pay you directly; the SFT transfers atomically.
          </p>
          <div className="flex gap-2">
            <input
              className={inputClass}
              placeholder="Sale price in USDC"
              value={price}
              onChange={(event) => setPrice(event.target.value)}
            />
            <Button
              disabled={busy || parsed === undefined || parsed === 0n}
              onClick={() =>
                parsed !== undefined &&
                void send({
                  functionName: "listStreamForSale",
                  args: [stream.id, parsed],
                  label: `Listed for ${formatUsdc(parsed)} USDC`,
                  onSuccess: () => setPrice(""),
                })
              }
            >
              List
            </Button>
          </div>
          {discount !== undefined && parsed !== undefined && parsed > 0n ? (
            <div className="mt-2 text-xs text-zinc-500">
              {discount > 0 ? (
                <>Buyer gets a <span className="text-amber-300">{discount.toFixed(1)}%</span> discount.</>
              ) : (
                <span className="text-amber-300">Price is above remaining value — unlikely to sell.</span>
              )}
            </div>
          ) : null}
        </>
      )}
      <TxBanner status={status} onDismiss={reset} />
    </Card>
  );
}

function SplitCard({ stream }: { stream: Stream }) {
  const { send, status, reset, busy } = useSluiceWrite();
  const [to, setTo] = useState("");
  const [amount, setAmount] = useState("");
  const parsed = useMemo(() => {
    try {
      return parseUsdc(amount);
    } catch {
      return undefined;
    }
  }, [amount]);
  const validTo = /^0x[0-9a-fA-F]{40}$/.test(to);

  return (
    <Card>
      <CardTitle hint="ERC-3525 value transfer">Split stream</CardTitle>
      <p className="mb-3 text-xs text-zinc-500">
        Carve out part of this stream into a new SFT for another address — schedule and tax terms
        carry over pro-rata. {stream.salePrice > 0n ? "Delist before splitting." : ""}
      </p>
      <div className="space-y-2">
        <input
          className={inputClass}
          placeholder="Recipient 0x…"
          value={to}
          onChange={(event) => setTo(event.target.value)}
        />
        <input
          className={inputClass}
          placeholder={`Amount (≤ ${formatUsdc(stream.remaining).replace(/,/g, "")})`}
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
        />
      </div>
      <div className="mt-3">
        <Button
          disabled={
            busy ||
            !validTo ||
            parsed === undefined ||
            parsed === 0n ||
            parsed > stream.remaining ||
            stream.salePrice > 0n
          }
          onClick={() =>
            parsed !== undefined &&
            void send({
              functionName: "transferFrom",
              args: [stream.id, to as `0x${string}`, parsed],
              label: `Split ${formatUsdc(parsed)} USDC to ${shortAddr(to)}`,
              onSuccess: () => {
                setAmount("");
                setTo("");
              },
            })
          }
        >
          Split
        </Button>
      </div>
      <TxBanner status={status} onDismiss={reset} />
    </Card>
  );
}

function InsuranceCard({ stream }: { stream: Stream }) {
  const { send, status, reset, busy } = useSluiceWrite();
  const premium = (stream.remaining * 50n) / 10_000n;

  return (
    <Card>
      <CardTitle hint="credit default pool">Insurance</CardTitle>
      {stream.canceled && stream.insured && stream.shortfall > 0n ? (
        <>
          <p className="mb-3 text-sm text-zinc-400">
            Employer defaulted. <span className="font-mono text-emerald-300">{formatUsdc(stream.shortfall)}</span>{" "}
            USDC of lost salary is claimable from the pool.
          </p>
          <Button
            disabled={busy}
            onClick={() =>
              void send({
                functionName: "claimDefaultCoverage",
                args: [stream.id],
                label: `Claimed ${formatUsdc(stream.shortfall)} USDC coverage`,
              })
            }
          >
            Claim coverage
          </Button>
        </>
      ) : stream.insured ? (
        <p className="text-sm text-zinc-400">
          ✓ This stream is insured. If the employer cancels early, the unvested remainder is covered
          by the staked pool.
        </p>
      ) : stream.canceled ? (
        <p className="text-sm text-zinc-500">Stream ended without insurance.</p>
      ) : (
        <>
          <p className="mb-3 text-xs text-zinc-500">
            Pay a one-time 0.5% premium (
            <span className="font-mono text-zinc-300">{formatUsdc(premium)}</span> USDC) to cover
            your remaining salary if the employer defaults.
          </p>
          <Button
            disabled={busy || premium === 0n}
            onClick={() =>
              void send({
                functionName: "insureStream",
                args: [stream.id],
                usdcApproval: premium,
                label: `Stream insured for ${formatUsdc(premium)} USDC premium`,
              })
            }
          >
            Insure stream
          </Button>
        </>
      )}
      <TxBanner status={status} onDismiss={reset} />
    </Card>
  );
}

function EmployerCard({ stream }: { stream: Stream }) {
  const { send, status, reset, busy } = useSluiceWrite();
  return (
    <Card>
      <CardTitle hint="employer controls">Cancel stream</CardTitle>
      <p className="mb-3 text-xs text-zinc-500">
        Stops the stream: vested salary pays out to the employee immediately (tax applied), the
        unvested remainder refunds to you{stream.insured ? " — the employee can then claim it from the insurance pool" : ""}.
      </p>
      <Button
        variant="danger"
        disabled={busy}
        onClick={() =>
          void send({
            functionName: "cancelStream",
            args: [stream.id],
            label: `Stream #${stream.id.toString()} canceled`,
          })
        }
      >
        Cancel & settle
      </Button>
      <TxBanner status={status} onDismiss={reset} />
    </Card>
  );
}
