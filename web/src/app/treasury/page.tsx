"use client";

import { useAccount, useChainId, usePublicClient, useReadContract, useReadContracts } from "wagmi";
import { useQuery } from "@tanstack/react-query";
import { parseAbiItem } from "viem";
import { useSluiceAddress, useSluiceWrite, useUsdcAddress } from "@/lib/hooks";
import { sluiceAbi } from "@/lib/sluice";
import { treasuryAbi } from "@/lib/treasuryAbi";
import { erc20Abi } from "@/lib/erc20Abi";
import { TREASURY_ADDRESS, crossChainEnabled, domainLabel } from "@/lib/crosschain";
import { formatUsdc } from "@/lib/format";
import { Badge, Button, Card, CardTitle, EmptyState, PageHeader, Stat, TxBanner } from "@/components/ui";

const activityEvents = [
  parseAbiItem("event Swept(uint256 amount)"),
  parseAbiItem("event Recalled(uint256 amount)"),
  parseAbiItem("event Rebalanced(uint256[] allocations)"),
  parseAbiItem("event RemoteReturnRequested(address indexed vault, uint32 indexed domain)"),
  parseAbiItem("event RemoteReturned(uint256 amount)"),
] as const;

interface ActivityEntry {
  block: bigint;
  text: string;
}

function useTreasuryActivity() {
  const client = usePublicClient();
  const chainId = useChainId();
  return useQuery({
    queryKey: ["treasury-activity", chainId],
    enabled: Boolean(client),
    refetchInterval: 6_000,
    queryFn: async (): Promise<ActivityEntry[]> => {
      const entries: ActivityEntry[] = [];
      for (const event of activityEvents) {
        const logs = await client!.getLogs({
          address: TREASURY_ADDRESS,
          event,
          fromBlock: 0n,
          toBlock: "latest",
        });
        for (const log of logs) {
          const args = log.args as Record<string, unknown>;
          let text = "";
          switch (event.name) {
            case "Swept":
              text = `Swept ${formatUsdc(args.amount as bigint)} USDC of idle escrow in from Sluice`;
              break;
            case "Recalled":
              text = `Recalled ${formatUsdc(args.amount as bigint)} USDC back to Sluice for a withdrawal`;
              break;
            case "Rebalanced":
              text = `Rebalanced — allocated [${(args.allocations as bigint[])
                .map((allocation) => formatUsdc(allocation))
                .join(" · ")}] USDC across venues`;
              break;
            case "RemoteReturnRequested":
              text = `Requested return from the ${domainLabel(Number(args.domain))} vault (relayer executing)`;
              break;
            case "RemoteReturned":
              text = `${formatUsdc(args.amount as bigint)} USDC came home from the remote vault via CCTP`;
              break;
          }
          entries.push({ block: log.blockNumber ?? 0n, text });
        }
      }
      return entries.sort((a, b) => (a.block > b.block ? -1 : 1)).slice(0, 30);
    },
  });
}

export default function TreasuryPage() {
  const { isConnected } = useAccount();
  const chainId = useChainId();
  const sluice = useSluiceAddress();
  const usdc = useUsdcAddress();
  const { send, status, reset, busy } = useSluiceWrite();
  const { data: activity } = useTreasuryActivity();

  const treasuryContract = { address: TREASURY_ADDRESS, abi: treasuryAbi } as const;
  const { data } = useReadContracts({
    contracts: sluice
      ? [
          { address: sluice, abi: sluiceAbi, functionName: "sweepableAmount" },
          { address: sluice, abi: sluiceAbi, functionName: "totalLiability" },
          { address: usdc ?? sluice, abi: erc20Abi, functionName: "balanceOf", args: [sluice] },
          { ...treasuryContract, functionName: "totalAssets" },
          { ...treasuryContract, functionName: "principal" },
          { ...treasuryContract, functionName: "yieldEarned" },
          { ...treasuryContract, functionName: "idle" },
          { ...treasuryContract, functionName: "adaptersInfo" },
        ]
      : [],
    allowFailure: true,
    query: { enabled: Boolean(sluice && usdc), refetchInterval: 4_000 },
  });

  const [sweepable, liability, sluiceHeld, nav, principal, yieldEarned, idle, adaptersInfo] = (
    data ?? []
  ).map((entry) => (entry?.status === "success" ? entry.result : undefined));

  const adapters = adaptersInfo as
    | readonly [readonly string[], readonly bigint[], readonly bigint[], readonly number[], readonly boolean[]]
    | undefined;

  if (!isConnected) {
    return (
      <div>
        <PageHeader title="Treasury" />
        <EmptyState
          title="Connect a wallet"
          body="The treasury view shows where idle payroll escrow is earning yield across chains."
        />
      </div>
    );
  }

  if (!crossChainEnabled(chainId)) {
    return (
      <div>
        <PageHeader
          title="Treasury"
          sub="Idle payroll escrow swept into cross-chain yield venues via CCTP, recalled on demand."
        />
        <EmptyState
          title="Coming to Arc Testnet with the Bridge Kit integration"
          body="The auto-yield treasury (sweep → rebalance across chains → auto-recall for withdrawals) is fully built and tested against a local CCTP rig — see SluiceTreasury.sol and the repo's ./dev.sh demo. It goes live here once real CCTP domains connect Arc to other chains."
        />
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Treasury"
        sub="Idle payroll escrow doesn't sleep — it's swept into yield venues across chains via CCTP and recalled on demand."
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="Treasury NAV"
          value={nav !== undefined ? formatUsdc(nav as bigint) : "—"}
          sub="idle + all venue positions"
          accent="text-cyan-300"
        />
        <Stat
          label="Yield earned"
          value={yieldEarned !== undefined ? `+${formatUsdc(yieldEarned as bigint)}` : "—"}
          sub="lifetime, accruing per second"
          accent="text-emerald-300"
        />
        <Stat
          label="Liquid in Sluice"
          value={sluiceHeld !== undefined ? formatUsdc(sluiceHeld as bigint) : "—"}
          sub={
            liability !== undefined
              ? `backing ${formatUsdc(liability as bigint)} of obligations (40% buffer)`
              : undefined
          }
        />
        <Stat
          label="Sweepable now"
          value={sweepable !== undefined ? formatUsdc(sweepable as bigint) : "—"}
          sub="idle escrow above the buffer"
        />
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardTitle hint="anyone can poke — the buffer makes it safe">Escrow routing</CardTitle>
          <div className="flex flex-wrap gap-2">
            <Button
              disabled={busy || !sweepable || (sweepable as bigint) === 0n}
              onClick={() =>
                void send({
                  functionName: "sweepIdle",
                  args: [],
                  label: "Idle escrow swept into the treasury",
                })
              }
            >
              Sweep idle escrow
            </Button>
            <Button
              variant="ghost"
              disabled={busy || !idle || (idle as bigint) === 0n}
              onClick={() =>
                void send({
                  to: treasuryContract,
                  functionName: "rebalance",
                  args: [],
                  label: "Treasury rebalanced across yield venues",
                })
              }
            >
              Rebalance to venues
            </Button>
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() =>
                void send({
                  to: treasuryContract,
                  functionName: "requestRemoteReturn",
                  args: [1n],
                  label: "Return requested — relayer is bringing the Base position home",
                })
              }
            >
              Recall from Base
            </Button>
          </div>
          <TxBanner status={status} onDismiss={reset} />
          <p className="mt-4 text-xs leading-relaxed text-zinc-500">
            Flow: <span className="text-zinc-300">sweepIdle()</span> moves everything above the 40%
            liquidity buffer here · <span className="text-zinc-300">rebalance()</span> splits it
            50/50 between the Arc money market and the Base vault (burned across via CCTP) · any
            withdrawal that outruns the buffer auto-recalls liquidity; remote funds come home with
            their yield through a hooked CCTP return.
          </p>
        </Card>

        <Card>
          <CardTitle hint={idle !== undefined ? `${formatUsdc(idle as bigint)} USDC idle` : undefined}>
            Yield venues
          </CardTitle>
          {adapters ? (
            <div className="space-y-3">
              {adapters[0].map((name, index) => (
                <div
                  key={name}
                  className="flex items-center justify-between rounded-xl border border-white/[0.07] bg-black/20 px-4 py-3"
                >
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-zinc-100">{name}</span>
                      <Badge tone={adapters[4][index] ? "amber" : "cyan"}>
                        {domainLabel(Number(adapters[3][index]))}
                        {adapters[4][index] ? " · via CCTP" : ""}
                      </Badge>
                    </div>
                    <div className="mt-0.5 text-xs text-zinc-500">
                      {(Number(adapters[1][index]) / 100).toFixed(1)}% APY
                    </div>
                  </div>
                  <div className="font-mono text-lg font-semibold tabular-nums text-emerald-300">
                    {formatUsdc(adapters[2][index])}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-zinc-500">Loading venues…</p>
          )}
        </Card>
      </div>

      <Card className="mt-4">
        <CardTitle hint="on-chain events">Activity</CardTitle>
        {!activity || activity.length === 0 ? (
          <p className="text-sm text-zinc-500">
            No treasury activity yet — sweep the idle escrow to start earning.
          </p>
        ) : (
          <div className="space-y-1.5">
            {activity.map((entry, index) => (
              <div key={index} className="flex items-baseline gap-3 text-sm">
                <span className="shrink-0 font-mono text-xs text-zinc-600">
                  #{entry.block.toString()}
                </span>
                <span className="text-zinc-300">{entry.text}</span>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
