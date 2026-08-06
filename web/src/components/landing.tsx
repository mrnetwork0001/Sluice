"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useAccount, useReadContracts } from "wagmi";
import { useSluiceAddress, useStreamIds } from "@/lib/hooks";
import { sluiceAbi } from "@/lib/sluice";
import { formatUsdc } from "@/lib/format";
import { arcTestnet } from "@/lib/arc";
import { Badge, Card, ProgressBar } from "./ui";

/* ------------------------------------------------------------------ hero demo */

const DEMO_RATE = 1_929n; // µUSDC per tick (0.001929 USDC/s - a 5,000/30d stream)
const DEMO_TARGET = 5_000_000_000n; // 5,000 USDC

/** Purely visual per-second stream ticker for the hero. */
function LiveStreamDemo() {
  const [streamed, setStreamed] = useState(1_284_000_000n); // start mid-stream
  useEffect(() => {
    const timer = setInterval(() => {
      setStreamed((value) => (value + DEMO_RATE >= DEMO_TARGET ? 1_284_000_000n : value + DEMO_RATE));
    }, 1_000);
    return () => clearInterval(timer);
  }, []);

  const pct = Number((streamed * 10_000n) / DEMO_TARGET) / 100;
  const tax = (streamed * 800n) / 10_000n;

  return (
    <Card className="relative overflow-hidden border-cyan-400/20 bg-gradient-to-b from-cyan-400/[0.06] to-transparent">
      <div className="flex items-start justify-between">
        <div>
          <div className="font-mono text-xs text-zinc-500">Stream #1 · monthly salary</div>
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
        <div className="text-xs uppercase tracking-wider text-zinc-500">Streamed so far</div>
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
          <div className="mt-0.5 font-mono tabular-nums text-zinc-300">{formatUsdc(tax)} USDC</div>
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

function SectionHeading({ eyebrow, title, sub }: { eyebrow: string; title: string; sub?: string }) {
  return (
    <div className="mx-auto max-w-2xl text-center">
      <div className="text-xs font-semibold uppercase tracking-[0.2em] text-cyan-400">{eyebrow}</div>
      <h2 className="mt-2 text-3xl font-bold tracking-tight text-zinc-50">{title}</h2>
      {sub ? <p className="mt-3 text-zinc-400">{sub}</p> : null}
    </div>
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
  ["Foundry", "44 tests across payroll and cross-chain"],
];

/* ------------------------------------------------------------------ page */

const primaryLinkClass =
  "rounded-xl bg-gradient-to-r from-cyan-500 to-emerald-500 px-4 py-2 text-sm font-semibold text-zinc-950 transition hover:from-cyan-400 hover:to-emerald-400";

export function Landing() {
  const { isConnected } = useAccount();
  const sluice = useSluiceAddress();
  const { data: streamRefs } = useStreamIds();
  // Loosely typed call list: wagmi's generic inference blows its depth limit on a
  // heterogeneous batch this size.
  const metricCalls = ["totalEscrowed", "totalSettled", "totalTaxWithheld", "totalStreams"];
  const { data: metrics } = useReadContracts({
    contracts: sluice
      ? metricCalls.map((functionName) => ({
          address: sluice,
          abi: sluiceAbi,
          functionName,
          chainId: arcTestnet.id,
        }))
      : [],
    allowFailure: true,
    query: { enabled: Boolean(sluice), refetchInterval: 10_000 },
  });
  const readMetric = (index: number): bigint | undefined => {
    const entry = (metrics as ReadonlyArray<{ status: string; result?: unknown }> | undefined)?.[index];
    return entry?.status === "success" ? (entry.result as bigint) : undefined;
  };
  const escrowed = readMetric(0);
  const settled = readMetric(1);
  const taxWithheld = readMetric(2);
  const streamCount = readMetric(3);

  return (
    <div className="pb-10">
      {/* Hero */}
      <section className="grid items-center gap-10 py-12 lg:grid-cols-2 lg:py-16">
        <div>
          <h1 className="text-5xl font-black leading-[1.05] tracking-tight text-zinc-50">
            Payroll that{" "}
            <span className="bg-gradient-to-r from-cyan-400 to-emerald-400 bg-clip-text text-transparent">
              flows
            </span>
            ,<br />
            block by block.
          </h1>
          <p className="mt-5 max-w-lg text-lg leading-relaxed text-zinc-400">
            Sluice streams USDC salaries every second on Arc. Taxes split themselves, future
            income becomes a sellable asset, and a staked pool insures every paycheck against
            employer default.
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
        </div>
        <LiveStreamDemo />
      </section>

      {/* Live stats */}
      <section className="grid gap-6 border-y border-white/[0.06] py-6 sm:grid-cols-2 lg:grid-cols-4">
        <div className="text-center">
          <div className="font-mono text-3xl font-semibold tabular-nums text-cyan-300">
            {escrowed !== undefined ? formatUsdc(escrowed) : "-"}
          </div>
          <div className="mt-1 text-xs uppercase tracking-wider text-zinc-500">
            USDC streamed through Sluice
          </div>
        </div>
        <div className="text-center">
          <div className="font-mono text-3xl font-semibold tabular-nums text-emerald-300">
            {settled !== undefined ? formatUsdc(settled) : "-"}
          </div>
          <div className="mt-1 text-xs uppercase tracking-wider text-zinc-500">
            USDC settled to workers
          </div>
        </div>
        <div className="text-center">
          <div className="font-mono text-3xl font-semibold tabular-nums text-zinc-50">
            {streamCount !== undefined ? streamCount.toString() : (streamRefs?.length ?? "-")}
          </div>
          <div className="mt-1 text-xs uppercase tracking-wider text-zinc-500">
            salary streams opened
          </div>
        </div>
        <div className="text-center">
          <div className="font-mono text-3xl font-semibold tabular-nums text-amber-300">
            {taxWithheld !== undefined ? formatUsdc(taxWithheld) : "-"}
          </div>
          <div className="mt-1 text-xs uppercase tracking-wider text-zinc-500">
            USDC auto-withheld as tax
          </div>
        </div>
      </section>

      {/* How it works */}
      <section className="py-16">
        <SectionHeading
          eyebrow="How it works"
          title="From escrow to paycheck in three moves"
          sub="No pay cycles, no batch files, no bank rails. One contract holds the water; the sluice gates do the rest."
        />
        <div className="mt-10 grid gap-4 md:grid-cols-3">
          {steps.map((step) => (
            <Card key={step.n}>
              <div className="font-mono text-sm font-bold text-cyan-400">{step.n}</div>
              <h3 className="mt-2 text-lg font-semibold text-zinc-100">{step.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-zinc-400">{step.body}</p>
            </Card>
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
        <div className="mt-10 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {features.map((feature) => (
            <Card key={feature.title} className="flex flex-col">
              <Badge tone="cyan">{feature.tag}</Badge>
              <h3 className="mt-3 text-base font-semibold text-zinc-100">{feature.title}</h3>
              <p className="mt-2 flex-1 text-sm leading-relaxed text-zinc-400">{feature.body}</p>
              <div className="mt-4 truncate rounded-lg bg-black/30 px-3 py-2 font-mono text-[11px] text-zinc-500">
                {feature.fn}
              </div>
            </Card>
          ))}
        </div>
      </section>

      {/* Personas */}
      <section className="py-16">
        <SectionHeading eyebrow="Who it's for" title="Three sides of every salary" />
        <div className="mt-10 grid gap-4 md:grid-cols-3">
          {personas.map((persona) => (
            <Card key={persona.title}>
              <h3 className="text-base font-semibold text-zinc-100">{persona.title}</h3>
              <ul className="mt-3 space-y-2.5">
                {persona.points.map((point) => (
                  <li key={point} className="flex gap-2.5 text-sm leading-relaxed text-zinc-400">
                    <span className="mt-0.5 text-emerald-400">✓</span>
                    {point}
                  </li>
                ))}
              </ul>
            </Card>
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
            <div key={name} className="flex items-baseline justify-center gap-2 text-sm">
              <span className="font-semibold text-zinc-200">{name}</span>
              <span className="text-zinc-500">· {detail}</span>
            </div>
          ))}
        </div>
      </section>

      {/* CTA */}
      <section className="py-16 text-center">
        <h2 className="text-3xl font-bold tracking-tight text-zinc-50">
          Open the <span className="bg-gradient-to-r from-cyan-400 to-emerald-400 bg-clip-text text-transparent">sluice</span>.
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
