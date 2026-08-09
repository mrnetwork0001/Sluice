"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useAccount, useReadContracts } from "wagmi";
import { useNow, useSluiceAddress, useStream, useStreamIds } from "@/lib/hooks";
import { liveVested, sluiceAbi } from "@/lib/sluice";
import { formatUsdc, formatUsdcExact, shortAddr } from "@/lib/format";
import { arcTestnet } from "@/lib/arc";
import { SLUICE_ADDRESSES } from "@/lib/sluice";
import { TREASURY_ADDRESS } from "@/lib/crosschain";
import { treasuryAbi } from "@/lib/treasuryAbi";
import { Badge, Card, ProgressBar } from "./ui";
import { Reveal } from "./reveal";

/* ------------------------------------------------------------------ hero demo */

const DEMO_RATE = 1_929n; // µUSDC per tick (0.001929 USDC/s - a 5,000/30d stream)
const DEMO_TARGET = 5_000_000_000n; // 5,000 USDC

/** Purely visual per-second stream ticker for the hero. */
function LiveStreamDemo() {
  const [streamed, setStreamed] = useState(1_284_000_000n); // start mid-stream
  useEffect(() => {
    const timer = setInterval(() => {
      setStreamed((value) =>
        value + DEMO_RATE >= DEMO_TARGET ? 1_284_000_000n : value + DEMO_RATE,
      );
    }, 1_000);
    return () => clearInterval(timer);
  }, []);

  const pct = Number((streamed * 10_000n) / DEMO_TARGET) / 100;
  const tax = (streamed * 800n) / 10_000n;

  return (
    <Card className="relative overflow-hidden border-cyan-400/20 bg-gradient-to-b from-cyan-400/[0.06] to-transparent">
      <div className="flex items-start justify-between">
        <div>
          <div className="font-mono text-xs text-zinc-500">
            Stream #1 · monthly salary
          </div>
          <div className="mt-0.5 text-sm text-zinc-400">
            0xf39F…2266 → <span className="text-zinc-200">0x7099…79C8</span>
          </div>
        </div>
        <div className="flex gap-1.5">
          <Badge tone="emerald">Insured</Badge>
          <Badge tone="cyan">Streaming</Badge>
        </div>
      </div>

      <div className="mt-5">
        <div className="text-xs uppercase tracking-wider text-zinc-500">
          Streamed so far
        </div>
        <div className="mt-1 font-mono text-4xl font-semibold tabular-nums text-zinc-50">
          {formatUsdc(streamed, 6)}
          <span className="ml-2 text-base text-zinc-500">USDC</span>
        </div>
      </div>

      <div className="mt-4">
        <ProgressBar pct={pct} />
        <div className="mt-1.5 flex justify-between text-xs text-zinc-500">
          <span>{pct.toFixed(2)}% of 5,000.00 vested</span>
          <span className="text-cyan-300">0.001929 USDC/s</span>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 border-t border-white/[0.06] pt-4 text-xs">
        <div>
          <div className="text-zinc-500">Tax auto-split (8%)</div>
          <div className="mt-0.5 font-mono tabular-nums text-zinc-300">
            {formatUsdc(tax)} USDC
          </div>
        </div>
        <div>
          <div className="text-zinc-500">Auto-trigger</div>
          <div className="mt-0.5 font-mono text-emerald-300">20% → EURC</div>
        </div>
      </div>
    </Card>
  );
}

/* ------------------------------------------------------------------ sections */

function SectionHeading({
  eyebrow,
  title,
  sub,
}: {
  eyebrow: string;
  title: string;
  sub?: string;
}) {
  return (
    <Reveal className="max-w-2xl border-t border-[var(--hairline)] pt-6">
      <div className="label text-cyan-400/80">{eyebrow}</div>
      <h2 className="mt-2 text-[1.75rem] font-semibold leading-tight text-zinc-50">{title}</h2>
      {sub ? <p className="mt-2.5 text-[15px] leading-relaxed text-zinc-400">{sub}</p> : null}
    </Reveal>
  );
}

const steps = [
  {
    n: "01",
    title: "Employer escrows once",
    body: "Fund a stream with USDC, set a duration and a tax split. The escrow starts flowing the same block - on Arc, gas is USDC too, so payroll never touches another token.",
  },
  {
    n: "02",
    title: "Salary vests every second",
    body: "The stream is minted to the employee as an ERC-3525 token whose value is the USDC left to flow. No pay cycles, no batch runs - balance grows block by block.",
  },
  {
    n: "03",
    title: "Employee withdraws - or automates",
    body: "Withdraw any vested amount; the tax share routes itself to the vault. Auto-trigger rules convert a slice of every paycheck with Circle Swap Kit on the way out.",
  },
];

const features = [
  {
    tag: "ERC-3525",
    title: "Streams are semi-fungible tokens",
    body: "Each salary is an SFT: token value equals the remaining streamable USDC. Split part of a stream to another address, merge same-schedule streams, or transfer the whole thing - vesting math carries over pro-rata.",
    fn: "transferFrom(streamId, to, value)",
  },
  {
    tag: "Tax rails",
    title: "Compliance splits, enforced onchain",
    body: "Every withdrawal automatically routes the configured basis points to a tax vault before the employee sees a cent. Set it per stream: 8% payroll tax, 0% for contractors.",
    fn: "withdrawFromStream(streamId, amount)",
  },
  {
    tag: "Factoring",
    title: "Sell future income for cash today",
    body: "List a stream at a discount and any liquidity provider can buy it - payment goes straight to the seller, the SFT and all future flow transfer atomically to the buyer.",
    fn: "listStreamForSale · buyStream",
  },
  {
    tag: "Advances",
    title: "Payday loans without the loan shark",
    body: "Borrow up to 50% of your unwithdrawn stream value instantly. No interest, no liquidations - the advance repays itself as salary keeps vesting.",
    fn: "borrowSalaryAdvance(streamId, amount)",
  },
  {
    tag: "Insurance",
    title: "Credit-default pool for salaries",
    body: "Pay a one-time 0.5% premium and your stream is covered: if the employer cancels early, the unvested remainder is claimable from a pool underwritten by USDC stakers who earn the premiums.",
    fn: "insureStream · claimDefaultCoverage",
  },
  {
    tag: "Swap Kit",
    title: "Stream-to-DeFi auto-triggers",
    body: "Per-wallet rules run after every withdrawal - swap 20% to EURC, stack WBTC, dollar-cost-average by paycheck instead of by calendar. Powered by Circle Swap Kit through your own wallet.",
    fn: "web/src/lib/automation.ts",
  },
];

const personas = [
  {
    title: "For employers",
    points: [
      "One escrow transaction replaces the entire pay run",
      "Tax withholding enforced by the contract, not the back office",
      "Cancel anytime - vested pays out, unvested refunds",
      "Idle escrow routes to cross-chain yield via CCTP, live on Arc",
    ],
  },
  {
    title: "For employees",
    points: [
      "Get paid every second, not every month",
      "Sell or split your stream when life needs liquidity",
      "Insure your income against employer default for 0.5%",
      "Auto-route each paycheck into savings or DeFi",
    ],
  },
  {
    title: "For liquidity providers",
    points: [
      "Buy discounted streams - collect the full face value",
      "Stake the insurance pool and earn every premium",
      "Sub-second finality on Arc keeps positions atomic",
      "All positions are onchain, transferable, composable",
    ],
  },
];

const rails = [
  ["Arc L1", "USDC-gas chain, sub-second finality"],
  ["Native USDC", "6-decimal payroll & gas token"],
  ["ERC-3525", "semi-fungible salary streams"],
  ["Circle Swap Kit", "paycheck auto-conversion"],
  ["CCTP v2", "cross-chain treasury routing"],
  ["Foundry", "50 tests across payroll and cross-chain"],
];

/* -------------------------------------------------------------- revenue model */

/**
 * The business model, stated with live figures. Both numbers are protocol
 * revenue readable from chain: treasury NAV above swept principal, and the
 * cumulative marketplace take. The claim: Sluice is free at the point of use.
 */
function RevenueSection({ sluice }: { sluice: `0x${string}` | undefined }) {
  const { data } = useReadContracts({
    contracts: [
      ...(TREASURY_ADDRESS
        ? [
            {
              address: TREASURY_ADDRESS,
              abi: treasuryAbi,
              functionName: "yieldEarned",
              chainId: arcTestnet.id,
            } as const,
          ]
        : []),
      ...(sluice
        ? [
            {
              address: sluice,
              abi: sluiceAbi,
              functionName: "totalMarketFees",
              chainId: arcTestnet.id,
            } as const,
          ]
        : []),
    ],
    allowFailure: true,
    query: { enabled: Boolean(TREASURY_ADDRESS || sluice), refetchInterval: 4_000 },
  });
  const yieldEarned =
    data?.[0]?.status === "success" ? (data[0].result as bigint) : undefined;
  const marketFees =
    data?.[1]?.status === "success" ? (data[1].result as bigint) : undefined;

  const rows = [
    {
      tag: "Float yield",
      title: "Idle escrow earns while salaries vest",
      body: "Employers pre-fund streams, so roughly half the payroll sits idle at any moment. Anyone can sweep it to the treasury, which routes it across yield venues on Arc and, via CCTP, on other chains. Every dollar of NAV above swept principal is protocol revenue.",
      fn: "SluiceTreasury.claimYield(to)",
      figure: yieldEarned !== undefined ? `+${formatUsdc(yieldEarned)} USDC earned` : undefined,
    },
    {
      tag: "Take rate",
      title: "0.5% when future income trades hands",
      body: "Selling a stream is a windfall moment - a seller accepting a 5% discount for instant cash pays 50bps of the ask to the protocol at purchase. Streams, withdrawals and advances stay free; the fee sits only on the liquidity event.",
      fn: "MARKET_FEE_BPS = 50",
      figure: marketFees !== undefined ? `${formatUsdc(marketFees)} USDC collected` : undefined,
    },
    {
      tag: "Free to use",
      title: "No fees on payroll itself",
      body: "Creating streams, withdrawing salary and borrowing advances carry zero protocol fee, and insurance premiums accrue entirely to the stakers who underwrite the risk. Adoption first; revenue rides the float, not the paycheck.",
      fn: "createStream · withdraw · advance — 0 bps",
      figure: undefined,
    },
  ];

  return (
    <section className="py-8">
      <SectionHeading
        eyebrow="Business model"
        title="Free for payroll. Revenue is the float."
        sub="The same model payroll processors have run for decades - earn on the pre-funded window - except here the numbers are onchain and anyone can audit them."
      />
      <div className="mt-10 overflow-hidden rounded-lg border border-[var(--hairline)] bg-[var(--panel)]">
        {rows.map((row, index) => (
          <Reveal key={row.tag} delay={Math.min(index, 3) * 70}>
            <div className="group grid gap-x-6 gap-y-2 border-t border-[var(--hairline)] px-5 py-5 transition-colors first:border-t-0 hover:bg-[var(--panel-raised)] md:grid-cols-[128px_1fr_auto] md:items-baseline">
              <div className="label pt-0.5 text-emerald-400/70">{row.tag}</div>
              <div className="min-w-0">
                <h3 className="text-[15px] font-semibold text-zinc-100">{row.title}</h3>
                <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-zinc-400">
                  {row.body}
                </p>
              </div>
              <div className="flex flex-col items-start gap-1 md:items-end">
                {row.figure ? (
                  <span className="font-mono text-xs tabular-nums text-emerald-300">
                    {row.figure}
                  </span>
                ) : null}
                <code className="truncate font-mono text-[11px] text-zinc-600 transition-colors group-hover:text-cyan-300/70">
                  {row.fn}
                </code>
              </div>
            </div>
          </Reveal>
        ))}
      </div>
    </section>
  );
}


/* ---------------------------------------------------------------- live ledger */

/** Per-stream Arcscan page - every row is independently checkable. */
function instanceUrl(id: bigint): string {
  const contract = SLUICE_ADDRESSES[arcTestnet.id];
  return `https://testnet.arcscan.app/token/${contract}/instance/${id.toString()}`;
}

function LedgerRow({ id }: { id: bigint }) {
  const { stream } = useStream(id);
  const now = useNow();
  if (!stream) {
    return (
      <tr className="border-t border-[var(--hairline)]">
        <td colSpan={7} className="px-3 py-3 text-xs text-zinc-600">
          loading #{id.toString()}…
        </td>
      </tr>
    );
  }
  const vested = liveVested(stream, now);
  const pct = stream.deposit > 0n ? Number((vested * 10_000n) / stream.deposit) / 100 : 0;
  const state = stream.canceled
    ? { label: "canceled", tone: "text-zinc-500" }
    : pct >= 100
      ? { label: "complete", tone: "text-zinc-400" }
      : { label: "streaming", tone: "text-emerald-400" };

  return (
    <tr className="border-t border-[var(--hairline)] transition-colors hover:bg-white/[0.02]">
      <td className="px-3 py-2.5 font-mono text-xs text-zinc-500">#{id.toString()}</td>
      <td className="px-3 py-2.5 font-mono text-xs text-zinc-400">
        {shortAddr(stream.employer)}
        <span className="mx-1.5 text-zinc-700">→</span>
        <span className="text-zinc-300">{shortAddr(stream.owner)}</span>
      </td>
      <td className="px-3 py-2.5 text-right font-mono text-xs text-zinc-300">
        {formatUsdc(stream.deposit)}
      </td>
      <td className="px-3 py-2.5 text-right font-mono text-xs text-cyan-300">
        {formatUsdcExact(stream.ratePerSecond)}
      </td>
      <td className="px-3 py-2.5 text-right font-mono text-xs text-emerald-300">
        {formatUsdc(vested)}
      </td>
      <td className="px-3 py-2.5">
        <div className="flex items-center gap-2">
          <div className="h-1 w-16 overflow-hidden rounded-full bg-white/[0.07]">
            <div className="h-full bg-cyan-400/70" style={{ width: `${Math.min(100, pct)}%` }} />
          </div>
          <span className={`font-mono text-[11px] ${state.tone}`}>{state.label}</span>
        </div>
      </td>
      <td className="px-3 py-2.5 text-right">
        <a
          href={instanceUrl(id)}
          target="_blank"
          rel="noreferrer"
          className="font-mono text-[11px] text-zinc-500 underline decoration-white/10 underline-offset-2 transition-colors hover:text-cyan-300"
        >
          arcscan ↗
        </a>
      </td>
    </tr>
  );
}

/**
 * The real contract state, on the landing page.
 *
 * Density is the point: a payroll product is judged on whether its numbers look
 * like a working system. Every figure here is read live from Arc, and every row
 * links to that stream's own explorer page, so none of it has to be taken on
 * trust.
 */
function LiveLedger() {
  const { data: refs, isLoading } = useStreamIds();
  const contract = SLUICE_ADDRESSES[arcTestnet.id];
  const ids = (refs ?? []).map((ref) => ref.id).slice(-6);

  return (
    <Reveal className="mt-8">
      <div className="overflow-hidden rounded-lg border border-[var(--hairline)] bg-[var(--panel)]">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--hairline)] px-4 py-3">
          <div className="flex items-center gap-2">
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-400" />
            </span>
            <span className="label text-zinc-300">Live contract state · Arc Testnet</span>
          </div>
          <a
            href={`https://testnet.arcscan.app/address/${contract}`}
            target="_blank"
            rel="noreferrer"
            className="font-mono text-[11px] text-zinc-500 transition-colors hover:text-cyan-300"
          >
            {contract ? shortAddr(contract) : ""} · verified ↗
          </a>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[680px] border-collapse">
            <thead>
              <tr className="label">
                <th className="px-3 py-2 text-left font-medium">Stream</th>
                <th className="px-3 py-2 text-left font-medium">Employer → Recipient</th>
                <th className="px-3 py-2 text-right font-medium">Size</th>
                <th className="px-3 py-2 text-right font-medium">USDC / sec</th>
                <th className="px-3 py-2 text-right font-medium">Vested</th>
                <th className="px-3 py-2 text-left font-medium">Progress</th>
                <th className="px-3 py-2 text-right font-medium">Proof</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && ids.length === 0 ? (
                <tr className="border-t border-[var(--hairline)]">
                  <td colSpan={7} className="px-3 py-6 text-center text-xs text-zinc-600">
                    Reading streams from Arc…
                  </td>
                </tr>
              ) : ids.length === 0 ? (
                <tr className="border-t border-[var(--hairline)]">
                  <td colSpan={7} className="px-3 py-6 text-center text-xs text-zinc-600">
                    No streams open yet.
                  </td>
                </tr>
              ) : (
                ids.map((id) => <LedgerRow key={id.toString()} id={id} />)
              )}
            </tbody>
          </table>
        </div>
      </div>
    </Reveal>
  );
}

/* ------------------------------------------------------------------ page */

const primaryLinkClass =
  "rounded-md bg-cyan-400 px-4 py-2.5 text-sm font-medium text-[#06121a] transition-colors hover:bg-cyan-300";

export function Landing() {
  const { isConnected } = useAccount();
  const sluice = useSluiceAddress();
  const { data: streamRefs } = useStreamIds();
  // Loosely typed call list: wagmi's generic inference blows its depth limit on a
  // heterogeneous batch this size.
  const metricCalls = [
    "totalEscrowed",
    "totalSettled",
    "totalMarketFees",
  ];
  const { data: metrics } = useReadContracts({
    contracts: [
      ...(sluice
        ? metricCalls.map((functionName) => ({
            address: sluice,
            abi: sluiceAbi,
            functionName,
            chainId: arcTestnet.id,
          }))
        : []),
      ...(TREASURY_ADDRESS
        ? [
            {
              address: TREASURY_ADDRESS,
              abi: treasuryAbi,
              functionName: "yieldEarned",
              chainId: arcTestnet.id,
            },
          ]
        : []),
    ],
    allowFailure: true,
    query: { enabled: Boolean(sluice), refetchInterval: 4_000 },
  });
  const readMetric = (index: number): bigint | undefined => {
    const entry = (
      metrics as ReadonlyArray<{ status: string; result?: unknown }> | undefined
    )?.[index];
    return entry?.status === "success" ? (entry.result as bigint) : undefined;
  };
  const escrowed = readMetric(0);
  const settled = readMetric(1);
  const marketFees = readMetric(2);
  const yieldEarned = readMetric(3);
  // Protocol revenue = marketplace take + treasury float yield. Rendered with
  // formatUsdcExact: early figures are sub-cent and must not display as 0.00.
  const revenue =
    marketFees !== undefined || yieldEarned !== undefined
      ? (marketFees ?? 0n) + (yieldEarned ?? 0n)
      : undefined;
  // Unique participants: every employer plus every current stream owner.
  const users = streamRefs
    ? new Set(
        streamRefs.flatMap((ref) => [
          ref.employer.toLowerCase(),
          ref.recipient.toLowerCase(),
        ]),
      ).size
    : undefined;

  return (
    <div className="pb-10">
      {/* Hero */}
      <section className="relative grid items-center gap-10 py-12 lg:grid-cols-2 lg:py-16">
        {/* Slow-drifting aurora. Sits behind everything and never intercepts
            pointer events, so it cannot interfere with the CTAs. */}
        <div
          aria-hidden="true"
          className="drift pointer-events-none absolute -top-24 right-0 -z-10 h-[420px] w-[560px] rounded-full bg-[radial-gradient(circle_at_center,rgba(34,211,238,0.16),rgba(52,211,153,0.08)_45%,transparent_70%)] blur-2xl"
        />
        <Reveal>
          <div className="label mb-5 flex items-center gap-2">
            <span className="h-1 w-1 rounded-full bg-cyan-400" />
            Streaming payroll · Arc L1
          </div>
          <h1 className="text-[3.25rem] font-semibold leading-[1.02] text-zinc-50">
            Payroll that{" "}
            <span className="relative whitespace-nowrap text-cyan-300">
              flows
              <span
                aria-hidden="true"
                className="absolute -bottom-1 left-0 h-px w-full bg-cyan-400/50"
              />
            </span>
            ,<br />
            block by block.
          </h1>
          <p className="mt-5 max-w-lg text-lg leading-relaxed text-zinc-400">
            Sluice streams USDC salaries every second on Arc. Taxes split
            themselves, future income becomes a sellable asset, and a staked
            pool insures every paycheck against employer default.
          </p>
          <div className="mt-7 flex flex-wrap items-center gap-3">
            <Link href="/dashboard" className={primaryLinkClass}>
              Launch App
            </Link>
            <Link
              href="/marketplace"
              className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-zinc-200 transition-colors hover:bg-white/10"
            >
              Explore the marketplace
            </Link>
          </div>
          {!isConnected ? (
            <p className="mt-3 text-xs text-zinc-600">
              Live on Arc Testnet - grab gas USDC at{" "}
              <a
                href="https://faucet.circle.com"
                target="_blank"
                rel="noreferrer"
                className="text-cyan-400 hover:text-cyan-300"
              >
                faucet.circle.com
              </a>{" "}
              and connect any EVM wallet.
            </p>
          ) : null}
        </Reveal>
        <Reveal delay={120}>
          <LiveStreamDemo />
        </Reveal>
      </section>

      {/* Live stats */}
      <section className="grid gap-6 border-y border-white/[0.06] py-6 sm:grid-cols-2 lg:grid-cols-4">
        <div className="text-center">
          <div className="font-mono text-3xl font-semibold tabular-nums text-cyan-300">
            {escrowed !== undefined ? `$${formatUsdc(escrowed)}` : "-"}
          </div>
          <div className="mt-1 text-xs uppercase tracking-wider text-zinc-500">
            USDC streamed
          </div>
        </div>
        <div className="text-center">
          <div className="font-mono text-3xl font-semibold tabular-nums text-emerald-300">
            {settled !== undefined ? `$${formatUsdc(settled)}` : "-"}
          </div>
          <div className="mt-1 text-xs uppercase tracking-wider text-zinc-500">
            USDC settled
          </div>
        </div>
        <div className="text-center">
          <div className="font-mono text-3xl font-semibold tabular-nums text-zinc-50">
            {users ?? "-"}
          </div>
          <div className="mt-1 text-xs uppercase tracking-wider text-zinc-500">
            Users
          </div>
        </div>
        <div className="text-center">
          <div className="font-mono text-3xl font-semibold tabular-nums text-amber-300">
            {revenue !== undefined ? `$${formatUsdcExact(revenue)}` : "-"}
          </div>
          <div className="mt-1 text-xs uppercase tracking-wider text-zinc-500">
            Revenue earned
          </div>
        </div>
      </section>

      <LiveLedger />

      {/* How it works */}
      <section className="py-16">
        <SectionHeading
          eyebrow="How it works"
          title="From escrow to paycheck in three moves"
          sub="No pay cycles, no batch files, no bank rails. One contract holds the water; the sluice gates do the rest."
        />
        <div className="mt-10 grid gap-px overflow-hidden rounded-lg border border-[var(--hairline)] bg-[var(--hairline)] md:grid-cols-3">
          {steps.map((step, index) => (
            <Reveal key={step.n} delay={index * 90} className="bg-[var(--panel)]">
              <div className="group h-full px-5 py-6 transition-colors hover:bg-[var(--panel-raised)]">
                <div className="flex items-baseline gap-3">
                  <span className="font-mono text-xs text-cyan-400/70">{step.n}</span>
                  <span className="h-px flex-1 bg-[var(--hairline)]" />
                </div>
                <h3 className="mt-4 text-base font-semibold text-zinc-100">{step.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-zinc-400">{step.body}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      {/* Features */}
      <section className="py-8">
        <SectionHeading
          eyebrow="Features"
          title="Income as a programmable asset"
          sub="Five primitives, one ERC-3525 contract. Everything below is live in this build - click through after connecting."
        />
        {/* A spec sheet, not a card grid: label column, prose, and the actual
            onchain entry point right-aligned so the claims stay checkable. */}
        <div className="mt-10 overflow-hidden rounded-lg border border-[var(--hairline)] bg-[var(--panel)]">
          {features.map((feature, index) => (
            <Reveal key={feature.title} delay={Math.min(index, 3) * 70}>
              <div className="group grid gap-x-6 gap-y-2 border-t border-[var(--hairline)] px-5 py-5 transition-colors first:border-t-0 hover:bg-[var(--panel-raised)] md:grid-cols-[128px_1fr_auto] md:items-baseline">
                <div className="label pt-0.5 text-cyan-400/70">{feature.tag}</div>
                <div className="min-w-0">
                  <h3 className="text-[15px] font-semibold text-zinc-100">{feature.title}</h3>
                  <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-zinc-400">
                    {feature.body}
                  </p>
                </div>
                <code className="truncate font-mono text-[11px] text-zinc-600 transition-colors group-hover:text-cyan-300/70 md:text-right">
                  {feature.fn}
                </code>
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      <RevenueSection sluice={sluice} />

      {/* Personas */}
      <section className="py-16">
        <SectionHeading
          eyebrow="Who it's for"
          title="Three sides of every salary"
        />
        {/* Columns divided by rules rather than three more boxes. The tick
            glyphs are replaced by hairline markers - fewer shapes, less noise. */}
        <div className="mt-10 grid gap-px overflow-hidden rounded-lg border border-[var(--hairline)] bg-[var(--hairline)] md:grid-cols-3">
          {personas.map((persona, index) => (
            <Reveal key={persona.title} delay={index * 90} className="bg-[var(--panel)]">
              <div className="h-full px-5 py-6">
                <h3 className="label text-zinc-300">{persona.title}</h3>
                <ul className="mt-4 space-y-3">
                  {persona.points.map((point) => (
                    <li
                      key={point}
                      className="flex gap-3 text-sm leading-relaxed text-zinc-400"
                    >
                      <span
                        aria-hidden="true"
                        className="mt-2 h-px w-3 shrink-0 bg-cyan-400/40"
                      />
                      {point}
                    </li>
                  ))}
                </ul>
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      {/* Rails */}
      <section className="rounded-2xl border border-white/[0.07] bg-white/[0.02] px-6 py-8">
        <div className="text-center text-xs font-semibold uppercase tracking-[0.2em] text-zinc-500">
          Built on
        </div>
        <div className="mt-5 grid gap-x-8 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
          {rails.map(([name, detail]) => (
            <div
              key={name}
              className="flex items-baseline justify-center gap-2 text-sm"
            >
              <span className="font-semibold text-zinc-200">{name}</span>
              <span className="text-zinc-500">· {detail}</span>
            </div>
          ))}
        </div>
      </section>

      {/* CTA */}
      <section className="py-16 text-center">
        <h2 className="text-[1.75rem] font-semibold text-zinc-50">
          Open the <span className="text-cyan-300">sluice</span>.
        </h2>
        <p className="mx-auto mt-3 max-w-md text-zinc-400">
          Open the app to stream your first salary, trade future income on the
          marketplace, and watch idle escrow earn yield - live on Arc Testnet.
        </p>
        <div className="mt-6 flex justify-center">
          <Link href="/dashboard" className={primaryLinkClass}>
            Launch App
          </Link>
        </div>
      </section>
    </div>
  );
}
