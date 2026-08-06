"use client";

import { useMemo, useRef, useState } from "react";
import { useAccount } from "wagmi";
import { useSluiceWrite, useUsdcBalance } from "@/lib/hooks";
import { formatUsdc, formatUsdcExact, parseUsdc, shortAddr } from "@/lib/format";
import { Badge, Button, Card, CardTitle, Field, PageHeader, Stat, TxBanner, inputClass } from "@/components/ui";
import { useChainId } from "wagmi";
import {
  ARC_DOMAIN,
  BASE_SIDE,
  FINALITY_FAST,
  GATE_ADDRESS,
  addressToBytes32,
  crossChainEnabled,
  encodeFundBatchHook,
  encodeFundBatchExactHook,
  fastMaxFee,
  hookDestinationCaller,
  messengerAbi,
} from "@/lib/crosschain";

const durationUnits = [
  { label: "days", seconds: 86_400 },
  { label: "weeks", seconds: 604_800 },
  { label: "hours", seconds: 3_600 },
  { label: "minutes", seconds: 60 },
];

type AllocationMode = "amount" | "percent";

interface Row {
  line: number;
  raw: string;
  address?: `0x${string}`;
  /** Exact USDC in amount mode; computed share in percent mode. */
  amount?: bigint;
  /** Basis points in percent mode. */
  bps?: bigint;
  error?: string;
}

const SAMPLE_AMOUNT = `0x70997970C51812dc3A010C7d01b50e0d17dc79C8, 2500
0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC, 1800
0x90F79bf6EB2c4f870365E785982E1f101E93b906, 3200`;

const SAMPLE_PERCENT = `0x70997970C51812dc3A010C7d01b50e0d17dc79C8, 45
0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC, 30
0x90F79bf6EB2c4f870365E785982E1f101E93b906, 25`;

/**
 * Accepts "address, value" per line. In amount mode the value is USDC; in
 * percent mode it is a share of the total budget, and shares are converted to
 * basis points with the last valid row absorbing the rounding remainder so the
 * run always allocates exactly 100%.
 */
function parseRoster(text: string, mode: AllocationMode, budget: bigint): Row[] {
  const rows = text
    .split("\n")
    .map((raw, index) => ({ raw: raw.trim(), line: index + 1 }))
    .filter((row) => row.raw.length > 0 && !row.raw.toLowerCase().startsWith("address"))
    .map<Row>((row) => {
      const [addressPart, valuePart] = row.raw.split(/[,;\t]/).map((part) => part?.trim());
      if (!addressPart || !valuePart) {
        return { ...row, error: mode === "amount" ? "Expected: address, amount" : "Expected: address, percent" };
      }
      if (!/^0x[0-9a-fA-F]{40}$/.test(addressPart)) {
        return { ...row, error: "Invalid address" };
      }
      if (mode === "amount") {
        try {
          const amount = parseUsdc(valuePart);
          if (amount === 0n) return { ...row, error: "Amount must be > 0" };
          return { ...row, address: addressPart as `0x${string}`, amount };
        } catch {
          return { ...row, error: "Invalid amount" };
        }
      }
      const percent = Number(valuePart.replace("%", ""));
      if (!Number.isFinite(percent) || percent <= 0 || percent > 100) {
        return { ...row, error: "Percent must be 1–100" };
      }
      return { ...row, address: addressPart as `0x${string}`, bps: BigInt(Math.round(percent * 100)) };
    });

  if (mode === "amount") return rows;

  // Percent mode: validate the split totals 100% and derive per-row amounts.
  const valid = rows.filter((row) => !row.error);
  const totalBps = valid.reduce((sum, row) => sum + (row.bps ?? 0n), 0n);
  if (valid.length > 0 && totalBps !== 10_000n) {
    const off = Number(totalBps) / 100;
    return rows.map((row) =>
      row.error ? row : { ...row, error: `Shares total ${off}% — must be exactly 100%` },
    );
  }
  let allocated = 0n;
  return rows.map((row, index) => {
    if (row.error) return row;
    const isLast = index === rows.length - 1;
    const amount = isLast ? budget - allocated : (budget * (row.bps ?? 0n)) / 10_000n;
    allocated += amount;
    return { ...row, amount };
  });
}

export default function PayrollPage() {
  const { address, isConnected } = useAccount();
  const { data: balance } = useUsdcBalance(address);
  const { send, status, reset, busy } = useSluiceWrite();
  const fileInput = useRef<HTMLInputElement>(null);

  const [mode, setMode] = useState<AllocationMode>("amount");
  const [budget, setBudget] = useState("");
  const [fundFrom, setFundFrom] = useState<"arc" | "base">("arc");
  const [roster, setRoster] = useState("");
  const [durationValue, setDurationValue] = useState("30");
  const [durationUnit, setDurationUnit] = useState(86_400);
  const [taxPct, setTaxPct] = useState("8");
  const [taxVault, setTaxVault] = useState("0x000000000000000000000000000000000000dEaD");

  const parsedBudget = useMemo(() => {
    try {
      return parseUsdc(budget);
    } catch {
      return 0n;
    }
  }, [budget]);
  const rows = useMemo(() => parseRoster(roster, mode, parsedBudget), [roster, mode, parsedBudget]);
  const valid = rows.filter((row) => !row.error);
  const invalid = rows.filter((row) => row.error);
  const total = mode === "percent" ? parsedBudget : valid.reduce((sum, row) => sum + (row.amount ?? 0n), 0n);
  const chainId = useChainId();
  const canCrossChain = crossChainEnabled(chainId);
  const crossChainRun = canCrossChain && fundFrom === "base";

  const durationSeconds = Math.floor(Number(durationValue || 0) * durationUnit);
  const taxBps = Math.round(Number(taxPct || 0) * 100);
  const validTaxVault = taxBps === 0 || /^0x[0-9a-fA-F]{40}$/.test(taxVault);
  const perSecond = durationSeconds > 0 ? total / BigInt(durationSeconds) : 0n;
  const shortfall = balance !== undefined && total > (balance as bigint);

  const canRun =
    !busy &&
    isConnected &&
    valid.length > 0 &&
    invalid.length === 0 &&
    durationSeconds > 0 &&
    validTaxVault &&
    taxBps <= 10_000 &&
    total > 0n &&
    (crossChainRun || !shortfall);

  const onFile = async (file: File) => setRoster(await file.text());

  return (
    <div>
      <PageHeader
        title="Payroll run"
        sub="Open salary streams for your whole team in a single transaction — paste a roster or drop a CSV."
      />

      <div className="grid gap-4 lg:grid-cols-[1.15fr_1fr]">
        <Card>
          <CardTitle hint={mode === "amount" ? "address, amount per line" : "address, percent per line"}>
            Roster
          </CardTitle>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            {(["amount", "percent"] as const).map((option) => (
              <button
                key={option}
                onClick={() => {
                  setMode(option);
                  setRoster("");
                }}
                className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
                  mode === option
                    ? "bg-cyan-400/15 text-cyan-300 ring-1 ring-inset ring-cyan-400/30"
                    : "bg-white/5 text-zinc-400 hover:text-zinc-200"
                }`}
              >
                {option === "amount" ? "Exact amounts" : "Split a total budget"}
              </button>
            ))}
          </div>
          {mode === "percent" ? (
            <div className="mb-3">
              <Field
                label="Total payroll budget (USDC)"
                hint="Each row takes a percentage of this — shares must total 100%"
              >
                <input
                  className={inputClass}
                  placeholder="100000"
                  value={budget}
                  onChange={(event) => setBudget(event.target.value)}
                />
              </Field>
            </div>
          ) : null}
          <textarea
            className={`${inputClass} min-h-[190px] resize-y`}
            placeholder={
              mode === "amount"
                ? `0xEmployeeAddress, 2500\n0xAnotherEmployee, 1800`
                : `0xEmployeeAddress, 45\n0xAnotherEmployee, 30\n0xThirdEmployee, 25`
            }
            value={roster}
            onChange={(event) => setRoster(event.target.value)}
          />
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <input
              ref={fileInput}
              type="file"
              accept=".csv,.txt"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void onFile(file);
              }}
            />
            <Button variant="ghost" onClick={() => fileInput.current?.click()}>
              Upload CSV
            </Button>
            <Button
              variant="ghost"
              onClick={() => setRoster(mode === "amount" ? SAMPLE_AMOUNT : SAMPLE_PERCENT)}
            >
              Use sample
            </Button>
            {roster ? (
              <Button variant="ghost" onClick={() => setRoster("")}>
                Clear
              </Button>
            ) : null}
            <span className="text-xs text-zinc-500">
              CSV columns: address, {mode === "amount" ? "amount (USDC)" : "percent"}
            </span>
          </div>

          {rows.length > 0 ? (
            <div className="mt-4 max-h-64 space-y-1.5 overflow-y-auto">
              {rows.map((row) => (
                <div
                  key={row.line}
                  className={`flex items-center justify-between gap-3 rounded-lg border px-3 py-2 text-sm ${
                    row.error
                      ? "border-red-400/25 bg-red-400/5"
                      : "border-white/[0.07] bg-black/20"
                  }`}
                >
                  <span className="font-mono text-xs text-zinc-400">
                    {row.error ? `line ${row.line}: ${row.raw.slice(0, 40)}` : shortAddr(row.address!)}
                  </span>
                  {row.error ? (
                    <Badge tone="red">{row.error}</Badge>
                  ) : (
                    <span className="font-mono tabular-nums text-emerald-300">
                      {row.bps !== undefined ? (
                        <span className="mr-2 text-cyan-300">{Number(row.bps) / 100}%</span>
                      ) : null}
                      {formatUsdc(row.amount ?? 0n)} USDC
                    </span>
                  )}
                </div>
              ))}
            </div>
          ) : null}
        </Card>

        <div className="space-y-4">
          <Card>
            <CardTitle>Terms for every stream in this run</CardTitle>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Duration">
                <input
                  className={inputClass}
                  value={durationValue}
                  onChange={(event) => setDurationValue(event.target.value)}
                />
              </Field>
              <Field label="Unit">
                <select
                  className={inputClass}
                  value={durationUnit}
                  onChange={(event) => setDurationUnit(Number(event.target.value))}
                >
                  {durationUnits.map((unit) => (
                    <option key={unit.label} value={unit.seconds}>
                      {unit.label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Tax withholding (%)">
                <input
                  className={inputClass}
                  value={taxPct}
                  onChange={(event) => setTaxPct(event.target.value)}
                />
              </Field>
              <Field label="Tax vault">
                <input
                  className={inputClass}
                  value={taxVault}
                  disabled={taxBps === 0}
                  onChange={(event) => setTaxVault(event.target.value)}
                />
              </Field>
            </div>
          </Card>

          <div className="grid grid-cols-2 gap-4">
            <Stat label="Employees" value={valid.length} sub={invalid.length > 0 ? `${invalid.length} rows need fixing` : "rows parsed"} />
            <Stat
              label="Total payroll"
              value={formatUsdc(total)}
              sub="USDC escrowed now"
              accent="text-emerald-300"
            />
          </div>

          {canCrossChain ? (
            <Card>
              <CardTitle hint="CCTP v2">Funding source</CardTitle>
              <select
                className={inputClass}
                value={fundFrom}
                onChange={(event) => setFundFrom(event.target.value as "arc" | "base")}
              >
                <option value="arc">This wallet on Arc Testnet</option>
                <option value="base">Treasury on Base Sepolia — via CCTP</option>
              </select>
              {fundFrom === "base" ? (
                <p className="mt-2 text-xs leading-relaxed text-zinc-500">
                  One burn on Base Sepolia funds the entire run; Circle attests and the gate opens
                  every stream on Arc.{" "}
                  {mode === "percent" ? (
                    <>
                      CCTP deducts a transfer fee, so the exact arriving amount is unknown when you
                      sign — percentages apply cleanly to whatever lands.
                    </>
                  ) : (
                    <>
                      The burn carries fee headroom so every employee gets their exact amount, and
                      any surplus is refunded to you on Arc.
                    </>
                  )}
                </p>
              ) : null}
            </Card>
          ) : null}

          <Card>
            <CardTitle hint={`${valid.length} streams · 1 transaction`}>Run payroll</CardTitle>
            {total > 0n ? (
              <p className="mb-3 text-xs leading-relaxed text-zinc-500">
                Streams at{" "}
                <span className="font-mono text-cyan-300">{formatUsdcExact(perSecond)} USDC/s</span>{" "}
                combined
                {taxBps > 0 ? (
                  <>
                    {" "}
                    · {taxPct}% withheld to{" "}
                    <span className="font-mono">{shortAddr(taxVault)}</span> on every withdrawal
                  </>
                ) : null}
                . Escrow is pulled once and the whole run settles atomically — if one row is bad,
                nothing is created.
              </p>
            ) : null}
            {shortfall ? (
              <p className="mb-3 text-xs text-amber-300">
                Wallet holds {formatUsdc(balance as bigint)} USDC — {formatUsdc(total - (balance as bigint))} short
                of this run.
              </p>
            ) : null}
            <Button
              disabled={!canRun}
              onClick={() => {
                const vault = (taxBps === 0
                  ? "0x0000000000000000000000000000000000000000"
                  : taxVault) as `0x${string}`;
                if (crossChainRun && GATE_ADDRESS && address) {
                  void send({
                    to: { address: BASE_SIDE.messenger, abi: messengerAbi },
                    chainId: BASE_SIDE.chainId,
                    functionName: "depositForBurnWithHook",
                    args: [
                      total + fastMaxFee(total),
                      ARC_DOMAIN,
                      addressToBytes32(GATE_ADDRESS),
                      BASE_SIDE.usdc,
                      hookDestinationCaller(),
                      fastMaxFee(total),
                      FINALITY_FAST,
                      mode === "percent"
                        ? encodeFundBatchHook({
                            employer: address,
                            recipients: valid.map((row) => row.address!),
                            shareBps: valid.map((row) => row.bps!),
                            durationSeconds: BigInt(durationSeconds),
                            taxBps: BigInt(taxBps),
                            taxVault: vault,
                          })
                        : encodeFundBatchExactHook({
                            employer: address,
                            recipients: valid.map((row) => row.address!),
                            amounts: valid.map((row) => row.amount!),
                            durationSeconds: BigInt(durationSeconds),
                            taxBps: BigInt(taxBps),
                            taxVault: vault,
                          }),
                    ],
                    approval: {
                      token: BASE_SIDE.usdc,
                      spender: BASE_SIDE.messenger,
                      amount: total + fastMaxFee(total),
                    },
                    label: `Burned ${formatUsdc(total)} USDC on Base Sepolia — ${valid.length} streams open on Arc once Circle attests`,
                  });
                  return;
                }
                void send({
                  functionName: "createStreamBatch",
                  args: [
                    valid.map((row) => row.address!),
                    valid.map((row) => row.amount!),
                    BigInt(durationSeconds),
                    BigInt(taxBps),
                    vault,
                  ],
                  usdcApproval: total,
                  label: `Payroll run complete — ${valid.length} streams opened for ${formatUsdc(total)} USDC`,
                });
              }}
            >
              {busy
                ? "Running payroll…"
                : crossChainRun
                  ? `Fund ${valid.length} streams from Base via CCTP`
                  : `Open ${valid.length || ""} streams in one transaction`}
            </Button>
            <TxBanner status={status} onDismiss={reset} />
          </Card>
        </div>
      </div>
    </div>
  );
}
