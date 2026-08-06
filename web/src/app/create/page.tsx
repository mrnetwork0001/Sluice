"use client";

import { useMemo, useState } from "react";
import { useAccount } from "wagmi";
import { useSluiceWrite, useUsdcBalance } from "@/lib/hooks";
import { formatUsdc, formatUsdcExact, parseUsdc } from "@/lib/format";
import { useChainId } from "wagmi";
import {
  ARC_DOMAIN,
  BASE_SIDE,
  FINALITY_FAST,
  GATE_ADDRESS,
  addressToBytes32,
  crossChainEnabled,
  encodeFundStreamHook,
  fastMaxFee,
  hookDestinationCaller,
  messengerAbi,
} from "@/lib/crosschain";
import { Button, Card, CardTitle, Field, PageHeader, TxBanner, inputClass } from "@/components/ui";

const durationUnits = [
  { label: "minutes", seconds: 60 },
  { label: "hours", seconds: 3_600 },
  { label: "days", seconds: 86_400 },
  { label: "weeks", seconds: 604_800 },
];

export default function CreateStreamPage() {
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const canCrossChain = crossChainEnabled(chainId);
  const { data: balance } = useUsdcBalance(address);
  const { send, status, reset, busy } = useSluiceWrite();

  const [recipient, setRecipient] = useState("");
  const [amount, setAmount] = useState("");
  const [durationValue, setDurationValue] = useState("30");
  const [durationUnit, setDurationUnit] = useState(86_400);
  const [taxPct, setTaxPct] = useState("8");
  const [taxVault, setTaxVault] = useState("");
  const [fundFrom, setFundFrom] = useState<"arc" | "base">("arc");

  const parsedAmount = useMemo(() => {
    try {
      return parseUsdc(amount);
    } catch {
      return undefined;
    }
  }, [amount]);
  const durationSeconds = Math.floor(Number(durationValue || 0) * durationUnit);
  const taxBps = Math.round(Number(taxPct || 0) * 100);
  const validRecipient = /^0x[0-9a-fA-F]{40}$/.test(recipient);
  const validTaxVault = taxBps === 0 || /^0x[0-9a-fA-F]{40}$/.test(taxVault);
  const ratePerSecond =
    parsedAmount !== undefined && durationSeconds > 0
      ? parsedAmount / BigInt(durationSeconds)
      : undefined;

  const canSubmit =
    !busy &&
    isConnected &&
    validRecipient &&
    validTaxVault &&
    parsedAmount !== undefined &&
    parsedAmount > 0n &&
    durationSeconds > 0 &&
    taxBps >= 0 &&
    taxBps <= 10_000;

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader
        title="Create a salary stream"
        sub="Escrow USDC once - it flows to your employee every second, tax withheld automatically."
      />
      <Card>
        <CardTitle>Stream terms</CardTitle>
        <div className="space-y-4">
          <Field label="Recipient (employee)">
            <input
              className={inputClass}
              placeholder="0x…"
              value={recipient}
              onChange={(event) => setRecipient(event.target.value)}
            />
          </Field>
          <Field
            label="Total amount (USDC)"
            hint={
              balance !== undefined ? (
                <>Wallet balance: {formatUsdc(balance as bigint)} USDC</>
              ) : undefined
            }
          >
            <input
              className={inputClass}
              placeholder="5000.00"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Duration">
              <input
                className={inputClass}
                placeholder="30"
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
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Tax withholding (%)">
              <input
                className={inputClass}
                placeholder="8"
                value={taxPct}
                onChange={(event) => setTaxPct(event.target.value)}
              />
            </Field>
            <Field label="Tax vault address">
              <input
                className={inputClass}
                placeholder={taxBps === 0 ? "not needed at 0%" : "0x…"}
                value={taxVault}
                disabled={taxBps === 0}
                onChange={(event) => setTaxVault(event.target.value)}
              />
            </Field>
          </div>
          {canCrossChain ? (
            <Field
              label="Fund from"
              hint={
                fundFrom === "base"
                  ? "Burns real USDC on Base Sepolia via CCTP v2; Circle attests, the relayer delivers, and the gate opens the stream on Arc (~20s)."
                  : undefined
              }
            >
              <select
                className={inputClass}
                value={fundFrom}
                onChange={(event) => setFundFrom(event.target.value as "arc" | "base")}
              >
                <option value="arc">This wallet on Arc Testnet</option>
                <option value="base">This wallet on Base Sepolia - via CCTP</option>
              </select>
            </Field>
          ) : null}
        </div>

        {ratePerSecond !== undefined ? (
          <div className="mt-5 rounded-xl border border-cyan-400/15 bg-cyan-400/5 px-4 py-3 text-sm text-zinc-300">
            Streams at{" "}
            <span className="font-mono text-cyan-300">{formatUsdcExact(ratePerSecond)} USDC/s</span>
            {taxBps > 0 ? (
              <>
                {" "}
                - employee nets{" "}
                <span className="font-mono text-emerald-300">
                  {formatUsdc((parsedAmount! * BigInt(10_000 - taxBps)) / 10_000n)}
                </span>{" "}
                USDC after {taxPct}% tax
              </>
            ) : null}
            .
          </div>
        ) : null}

        <div className="mt-5">
          <Button
            disabled={!canSubmit}
            onClick={() => {
              if (parsedAmount === undefined || !address) return;
              const vault = (taxBps === 0
                ? "0x0000000000000000000000000000000000000000"
                : taxVault) as `0x${string}`;
              if (fundFrom === "base" && GATE_ADDRESS) {
                void send({
                  to: { address: BASE_SIDE.messenger, abi: messengerAbi },
                  chainId: BASE_SIDE.chainId,
                  functionName: "depositForBurnWithHook",
                  // Burn amount + fee headroom so the stream opens at (about) the
                  // requested size after Circle's fast-transfer fee.
                  args: [
                    parsedAmount + fastMaxFee(parsedAmount),
                    ARC_DOMAIN,
                    addressToBytes32(GATE_ADDRESS),
                    BASE_SIDE.usdc,
                    hookDestinationCaller(),
                    fastMaxFee(parsedAmount),
                    FINALITY_FAST,
                    encodeFundStreamHook({
                      employer: address,
                      recipient: recipient as `0x${string}`,
                      durationSeconds: BigInt(durationSeconds),
                      taxBps: BigInt(taxBps),
                      taxVault: vault,
                    }),
                  ],
                  approval: {
                    token: BASE_SIDE.usdc,
                    spender: BASE_SIDE.messenger,
                    amount: parsedAmount + fastMaxFee(parsedAmount),
                  },
                  label: `Burned ${formatUsdc(parsedAmount)} USDC on Base Sepolia - Circle attests and the stream opens on Arc in ~20s`,
                });
              } else {
                void send({
                  functionName: "createStream",
                  args: [
                    recipient as `0x${string}`,
                    parsedAmount,
                    BigInt(durationSeconds),
                    BigInt(taxBps),
                    vault,
                  ],
                  usdcApproval: parsedAmount,
                  label: `Stream of ${formatUsdc(parsedAmount)} USDC created`,
                });
              }
            }}
          >
            {busy
              ? "Working…"
              : fundFrom === "base"
                ? "Fund from Base via CCTP"
                : "Escrow & start streaming"}
          </Button>
        </div>
        <TxBanner status={status} onDismiss={reset} />
      </Card>
    </div>
  );
}
