"use client";

import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { usePublicClient } from "wagmi";
import { parseAbiItem } from "viem";
import { arcTestnet } from "./arc";
import { SLUICE_ADDRESSES, SLUICE_FROM_BLOCK } from "./sluice";
import { formatUsdc, shortAddr } from "./format";

/**
 * Protocol-wide activity: every human-relevant Sluice event since deployment,
 * newest first, each row carrying its tx hash so the UI can link to Arcscan.
 * Same chunked + session-cached scan as the treasury feed - Arc's RPC caps
 * getLogs at 10,000 blocks, so we page from the deploy block once and then only
 * scan new blocks per poll.
 */

const protocolEvents = [
  parseAbiItem(
    "event StreamCreated(uint256 indexed streamId, address indexed employer, address indexed recipient, uint256 amount, uint256 durationSeconds, uint256 taxBps, address taxVault)",
  ),
  parseAbiItem(
    "event StreamWithdrawal(uint256 indexed streamId, address indexed to, uint256 amount, uint256 tax)",
  ),
  parseAbiItem(
    "event StreamListed(uint256 indexed streamId, address indexed seller, uint256 salePrice)",
  ),
  parseAbiItem(
    "event StreamSold(uint256 indexed streamId, address indexed seller, address indexed buyer, uint256 salePrice)",
  ),
  parseAbiItem("event MarketFeePaid(uint256 indexed streamId, uint256 fee)"),
  parseAbiItem("event SalaryAdvance(uint256 indexed streamId, address indexed to, uint256 amount)"),
  parseAbiItem("event StreamInsured(uint256 indexed streamId, uint256 premium)"),
  parseAbiItem(
    "event StreamCanceled(uint256 indexed streamId, uint256 paidOut, uint256 refunded, uint256 shortfall)",
  ),
  parseAbiItem("event InsuranceStaked(address indexed staker, uint256 amount, uint256 shares)"),
  parseAbiItem("event EscrowSwept(uint256 amount)"),
  parseAbiItem("event EscrowRecalled(uint256 amount)"),
  parseAbiItem(
    "event StreamToppedUp(uint256 indexed streamId, address indexed employer, uint256 amount, uint64 newDuration)",
  ),
] as const;

export interface ProtocolActivityEntry {
  block: bigint;
  txHash: `0x${string}`;
  text: string;
}

function describe(eventName: string, args: Record<string, unknown>): string {
  const id = args.streamId !== undefined ? `#${(args.streamId as bigint).toString()}` : "";
  switch (eventName) {
    case "StreamCreated":
      return `Stream ${id} opened - ${formatUsdc(args.amount as bigint)} USDC to ${shortAddr(args.recipient as `0x${string}`)}`;
    case "StreamWithdrawal": {
      const tax = args.tax as bigint;
      return `Stream ${id} withdrawal - ${formatUsdc(args.amount as bigint)} USDC${tax > 0n ? ` (${formatUsdc(tax)} tax auto-split)` : ""}`;
    }
    case "StreamListed":
      return (args.salePrice as bigint) === 0n
        ? `Stream ${id} delisted`
        : `Stream ${id} listed for sale at ${formatUsdc(args.salePrice as bigint)} USDC`;
    case "StreamSold":
      return `Stream ${id} sold to ${shortAddr(args.buyer as `0x${string}`)} for ${formatUsdc(args.salePrice as bigint)} USDC`;
    case "MarketFeePaid":
      return `Protocol earned ${formatUsdc(args.fee as bigint, 4)} USDC take on the stream ${id} sale`;
    case "SalaryAdvance":
      return `Stream ${id} salary advance - ${formatUsdc(args.amount as bigint)} USDC drawn early`;
    case "StreamInsured":
      return `Stream ${id} insured - ${formatUsdc(args.premium as bigint, 4)} USDC premium to the pool`;
    case "StreamCanceled":
      return `Stream ${id} canceled - ${formatUsdc(args.paidOut as bigint)} paid out, ${formatUsdc(args.refunded as bigint)} refunded`;
    case "InsuranceStaked":
      return `${shortAddr(args.staker as `0x${string}`)} staked ${formatUsdc(args.amount as bigint)} USDC in the insurance pool`;
    case "EscrowSwept":
      return `${formatUsdc(args.amount as bigint)} USDC of idle escrow swept to the yield treasury`;
    case "EscrowRecalled":
      return `${formatUsdc(args.amount as bigint)} USDC recalled from the treasury for a withdrawal`;
    case "StreamToppedUp":
      return `Stream ${id} topped up with ${formatUsdc(args.amount as bigint)} USDC`;
    default:
      return eventName;
  }
}

const cache = {
  address: undefined as string | undefined,
  scannedTo: 0n,
  entries: [] as ProtocolActivityEntry[],
};

export function useProtocolActivity(limit = 25): UseQueryResult<ProtocolActivityEntry[]> {
  const client = usePublicClient({ chainId: arcTestnet.id });
  const sluice = SLUICE_ADDRESSES[arcTestnet.id];
  return useQuery({
    queryKey: ["protocol-activity", arcTestnet.id, sluice],
    enabled: Boolean(client && sluice),
    refetchInterval: 6_000,
    queryFn: async (): Promise<ProtocolActivityEntry[]> => {
      if (cache.address !== sluice) {
        cache.address = sluice;
        cache.scannedTo = SLUICE_FROM_BLOCK[arcTestnet.id] - 1n;
        cache.entries = [];
      }
      const latest = await client!.getBlockNumber();
      let from = cache.scannedTo + 1n;
      while (from <= latest) {
        const to = from + 9_998n > latest ? latest : from + 9_998n;
        const logs = await client!.getLogs({
          address: sluice!,
          events: protocolEvents,
          fromBlock: from,
          toBlock: to,
        });
        for (const log of logs) {
          cache.entries.push({
            block: log.blockNumber ?? 0n,
            txHash: log.transactionHash as `0x${string}`,
            text: describe(log.eventName, log.args as Record<string, unknown>),
          });
        }
        cache.scannedTo = to;
        from = to + 1n;
      }
      return [...cache.entries].sort((a, b) => (a.block > b.block ? -1 : 1)).slice(0, limit);
    },
  });
}
