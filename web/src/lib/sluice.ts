import { sluiceAbi } from "./sluiceAbi";
import { arcTestnet } from "./arc";
import arcDeployment from "./deployments.5042002.json";

export { sluiceAbi };

const ZERO = "0x0000000000000000000000000000000000000000";
const arcSluice =
  (process.env.NEXT_PUBLIC_SLUICE_ADDRESS as `0x${string}` | undefined) ??
  (arcDeployment.sluice !== ZERO ? (arcDeployment.sluice as `0x${string}`) : undefined);

/**
 * Deployed Sluice addresses per chain. Arc Testnet is the only chain the app
 * connects to; the address is written to deployments.5042002.json by
 * `script/Deploy.s.sol` (NEXT_PUBLIC_SLUICE_ADDRESS overrides).
 */
export const SLUICE_ADDRESSES: Record<number, `0x${string}` | undefined> = {
  [arcTestnet.id]: arcSluice,
};

/**
 * First block worth scanning for Sluice events per chain. Public RPCs cap
 * eth_getLogs ranges (Arc testnet: 10,000 blocks), so scans start at the
 * deployment block and page forward in chunks.
 */
export const SLUICE_FROM_BLOCK: Record<number, bigint> = {
  [arcTestnet.id]: BigInt(arcDeployment.fromBlock ?? 0),
};

/** Parsed `streams(uint256)` tuple. */
export interface Stream {
  id: bigint;
  employer: `0x${string}`;
  start: bigint;
  duration: bigint;
  deposit: bigint;
  ratePerSecond: bigint;
  withdrawn: bigint;
  advanced: bigint;
  taxBps: number;
  taxVault: `0x${string}`;
  insured: boolean;
  canceled: boolean;
  salePrice: bigint;
  shortfall: bigint;
  /** Current SFT owner (the salary recipient). */
  owner: `0x${string}`;
  /** Remaining streamable USDC == ERC-3525 value. */
  remaining: bigint;
  /** Vested and withdrawable right now (on-chain view). */
  available: bigint;
}

type StreamTuple = readonly [
  `0x${string}`, // employer
  bigint, // start
  bigint, // duration
  bigint, // deposit
  bigint, // ratePerSecond
  bigint, // withdrawn
  bigint, // advanced
  number, // taxBps
  `0x${string}`, // taxVault
  boolean, // insured
  boolean, // canceled
  bigint, // salePrice
  bigint, // shortfall
];

export function parseStream(
  id: bigint,
  tuple: StreamTuple,
  owner: `0x${string}`,
  remaining: bigint,
  available: bigint,
): Stream {
  return {
    id,
    employer: tuple[0],
    start: tuple[1],
    duration: tuple[2],
    deposit: tuple[3],
    ratePerSecond: tuple[4],
    withdrawn: tuple[5],
    advanced: tuple[6],
    taxBps: Number(tuple[7]),
    taxVault: tuple[8],
    insured: tuple[9],
    canceled: tuple[10],
    salePrice: tuple[11],
    shortfall: tuple[12],
    owner,
    remaining,
    available,
  };
}

/** Client-side per-second vesting so the UI ticks between RPC refreshes. */
export function liveVested(stream: Stream, nowSeconds: number): bigint {
  const start = Number(stream.start);
  if (nowSeconds <= start) return 0n;
  const elapsed = BigInt(Math.floor(nowSeconds) - start);
  if (elapsed >= stream.duration) return stream.deposit;
  const vested = stream.ratePerSecond * elapsed;
  return vested > stream.deposit ? stream.deposit : vested;
}

export function liveAvailable(stream: Stream, nowSeconds: number): bigint {
  if (stream.canceled) return 0n;
  const vested = liveVested(stream, nowSeconds);
  const spent = stream.withdrawn + stream.advanced;
  return vested > spent ? vested - spent : 0n;
}

/** Max additional salary advance (cumulative advances capped at 50% of unwithdrawn). */
export function maxAdvance(stream: Stream): bigint {
  const cap = ((stream.deposit - stream.withdrawn) * 5_000n) / 10_000n;
  return cap > stream.advanced ? cap - stream.advanced : 0n;
}
