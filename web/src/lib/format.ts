const USDC_DECIMALS = 6n;
const ONE_USDC = 10n ** USDC_DECIMALS;

/** Format a 6-decimal USDC amount as a human string, e.g. 1234500000n -> "1,234.50". */
export function formatUsdc(value: bigint, maxFraction = 2): string {
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const whole = abs / ONE_USDC;
  const frac = abs % ONE_USDC;
  const fracStr = frac.toString().padStart(6, "0").slice(0, Math.max(maxFraction, 2));
  const wholeStr = whole.toLocaleString("en-US");
  return `${negative ? "-" : ""}${wholeStr}.${fracStr}`;
}

/** Precise USDC formatting for tiny per-second rates (up to 6 decimals). */
export function formatUsdcExact(value: bigint): string {
  const whole = value / ONE_USDC;
  const frac = (value % ONE_USDC).toString().padStart(6, "0").replace(/0+$/, "");
  return frac.length > 0 ? `${whole.toLocaleString("en-US")}.${frac}` : whole.toLocaleString("en-US");
}

/** Parse a human USDC string ("1,234.56") into a 6-decimal bigint. Throws on bad input. */
export function parseUsdc(input: string): bigint {
  const cleaned = input.replace(/[,\s_]/g, "");
  if (!/^\d*(\.\d*)?$/.test(cleaned) || cleaned === "" || cleaned === ".") {
    throw new Error("Invalid amount");
  }
  const [whole = "0", frac = ""] = cleaned.split(".");
  const fracPadded = (frac + "000000").slice(0, 6);
  return BigInt(whole) * ONE_USDC + BigInt(fracPadded);
}

export function shortAddr(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export function formatDuration(totalSeconds: number): string {
  if (totalSeconds <= 0) return "0s";
  const units: Array<[string, number]> = [
    ["d", 86_400],
    ["h", 3_600],
    ["m", 60],
    ["s", 1],
  ];
  const parts: string[] = [];
  let rest = Math.floor(totalSeconds);
  for (const [label, size] of units) {
    if (rest >= size && parts.length < 2) {
      parts.push(`${Math.floor(rest / size)}${label}`);
      rest %= size;
    }
  }
  return parts.join(" ") || "0s";
}

export function formatBps(bps: number): string {
  return `${(bps / 100).toFixed(bps % 100 === 0 ? 0 : 2)}%`;
}
