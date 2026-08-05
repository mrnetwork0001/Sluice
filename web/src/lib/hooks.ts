"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  useAccount,
  useChainId,
  usePublicClient,
  useReadContract,
  useReadContracts,
  useSwitchChain,
  useWriteContract,
} from "wagmi";
import { getPublicClient } from "wagmi/actions";
import { wagmiConfig } from "./wagmi";
import { arcTestnet } from "./arc";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { maxUint256, parseAbiItem, type BaseError } from "viem";
import { SLUICE_ADDRESSES, SLUICE_FROM_BLOCK, parseStream, sluiceAbi, type Stream } from "./sluice";
import { erc20Abi } from "./erc20Abi";

const streamCreatedEvent = parseAbiItem(
  "event StreamCreated(uint256 indexed streamId, address indexed employer, address indexed recipient, uint256 amount, uint256 durationSeconds, uint256 taxBps, address taxVault)",
);

/** The app's data home is Arc Testnet regardless of the wallet's current chain
 *  (the wallet only visits Base Sepolia transiently to burn). */
export function useSluiceAddress(): `0x${string}` | undefined {
  return SLUICE_ADDRESSES[arcTestnet.id];
}

export function useUsdcAddress(): `0x${string}` | undefined {
  const address = useSluiceAddress();
  const { data } = useReadContract({
    address,
    abi: sluiceAbi,
    functionName: "usdc",
    chainId: arcTestnet.id,
    query: { enabled: Boolean(address), staleTime: Infinity },
  });
  return data as `0x${string}` | undefined;
}

export function useUsdcBalance(account?: `0x${string}`) {
  const usdc = useUsdcAddress();
  return useReadContract({
    address: usdc,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: account ? [account] : undefined,
    chainId: arcTestnet.id,
    query: { enabled: Boolean(usdc && account), refetchInterval: 5_000 },
  });
}

export interface StreamRef {
  id: bigint;
  employer: `0x${string}`;
  recipient: `0x${string}`;
}

// Arc mints ~1s blocks and caps eth_getLogs at 10,000 blocks, so a naive scan
// from the deployment block takes minutes. Two cursors instead: `head` walks
// forward over new blocks each poll (instant for fresh activity), while `tail`
// walks backward one chunk per poll toward the deployment block — so the newest
// streams render within seconds and history fills in behind them.
const CHUNK = 9_999n;
interface ScanState {
  head: bigint;
  tail: bigint;
  floor: bigint;
  refs: Map<string, StreamRef>;
}
const streamScanCache = new Map<string, ScanState>();

/** All streams ever created, discovered from StreamCreated logs. */
export function useStreamIds() {
  const address = useSluiceAddress();
  const chainId = arcTestnet.id;
  const client = usePublicClient({ chainId: arcTestnet.id });
  return useQuery({
    queryKey: ["stream-ids", chainId, address],
    enabled: Boolean(client && address),
    refetchInterval: 4_000,
    queryFn: async (): Promise<StreamRef[]> => {
      const cacheKey = `${chainId}:${address}`;
      const latest = await client!.getBlockNumber();
      const floor = SLUICE_FROM_BLOCK[chainId] ?? 0n;
      let cache = streamScanCache.get(cacheKey);
      if (!cache) {
        // Start at the head: one chunk back from latest covers recent activity.
        const start = latest - CHUNK > floor ? latest - CHUNK : floor;
        cache = { head: start - 1n, tail: start, floor, refs: new Map() };
        streamScanCache.set(cacheKey, cache);
      }

      const scan = async (fromBlock: bigint, toBlock: bigint) => {
        const logs = await client!.getLogs({ address, event: streamCreatedEvent, fromBlock, toBlock });
        for (const log of logs) {
          const id = log.args.streamId!;
          cache!.refs.set(id.toString(), {
            id,
            employer: log.args.employer!,
            recipient: log.args.recipient!,
          });
        }
      };

      // 1) Forward: everything minted since the last poll.
      try {
        let from = cache.head + 1n;
        while (from <= latest) {
          const to = from + CHUNK > latest ? latest : from + CHUNK;
          await scan(from, to);
          cache.head = to;
          from = to + 1n;
        }
      } catch {
        /* transient RPC error — cursor stays put, retried next poll */
      }

      // 2) Backward: one chunk of history per poll until the deployment block.
      if (cache.tail > cache.floor) {
        const to = cache.tail - 1n;
        const from = to - CHUNK > cache.floor ? to - CHUNK : cache.floor;
        try {
          await scan(from, to);
          cache.tail = from;
        } catch {
          /* transient — retry the same range next poll */
        }
      }

      return [...cache.refs.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    },
  });
}

/** Full on-chain state for one stream. */
export function useStream(id: bigint | undefined) {
  const address = useSluiceAddress();
  const enabled = Boolean(address && id !== undefined);
  const contract = { address: address!, abi: sluiceAbi, chainId: arcTestnet.id } as const;
  const { data, isLoading, error } = useReadContracts({
    contracts: enabled
      ? [
          { ...contract, functionName: "streams", args: [id!] },
          { ...contract, functionName: "ownerOf", args: [id!] },
          { ...contract, functionName: "remainingValue", args: [id!] },
          { ...contract, functionName: "availableToWithdraw", args: [id!] },
        ]
      : [],
    allowFailure: true,
    query: { enabled, refetchInterval: 5_000 },
  });

  const stream: Stream | undefined = useMemo(() => {
    if (!data || data.length < 4 || data.some((entry) => entry?.status !== "success")) {
      return undefined;
    }
    const [streamsResult, ownerResult, remainingResult, availableResult] = data;
    return parseStream(
      id!,
      streamsResult!.result as never,
      ownerResult!.result as `0x${string}`,
      remainingResult!.result as bigint,
      availableResult!.result as bigint,
    );
  }, [data, id]);

  return { stream, isLoading, error };
}

/** Wall-clock seconds, ticking so vesting UIs animate between refetches. */
export function useNow(intervalMs = 1_000): number {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const timer = setInterval(() => setNow(Math.floor(Date.now() / 1000)), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}

export type TxStatus =
  | { phase: "idle" }
  | { phase: "approving" }
  | { phase: "confirming" }
  | { phase: "success"; hash: `0x${string}`; label: string }
  | { phase: "error"; message: string };

interface SendOptions {
  functionName: string;
  args: readonly unknown[];
  /** When set, ensures the Sluice contract has a USDC allowance ≥ this before sending. */
  usdcApproval?: bigint;
  /** Target contract override — defaults to the Sluice contract. */
  to?: { address: `0x${string}`; abi: readonly unknown[] };
  /** Run the tx on this chain, switching the wallet there (and back) as needed. */
  chainId?: number;
  /** Generic ERC-20 approval on the tx chain (replaces usdcApproval for overrides). */
  approval?: { token: `0x${string}`; spender: `0x${string}`; amount: bigint };
  /** Success banner label, e.g. "Withdrew 120 USDC". */
  label: string;
  onSuccess?: () => void | Promise<void>;
}

/** Shared write pipeline: optional approve → (chain switch) → tx → wait → refresh. */
export function useSluiceWrite() {
  const sluice = useSluiceAddress();
  const usdc = useUsdcAddress();
  const currentChainId = useChainId();
  const { address: account } = useAccount();
  const client = usePublicClient();
  const { writeContractAsync } = useWriteContract();
  const { switchChainAsync } = useSwitchChain();
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<TxStatus>({ phase: "idle" });

  const send = useCallback(
    async ({ functionName, args, usdcApproval, to, chainId, approval, label, onSuccess }: SendOptions) => {
      const target = to ?? (sluice ? { address: sluice, abi: sluiceAbi as readonly unknown[] } : undefined);
      if (!target || !client || !account) {
        setStatus({ phase: "error", message: "Connect a wallet first." });
        return;
      }
      const homeChainId = currentChainId;
      const txChainId = chainId ?? currentChainId;
      const txClient = txChainId === currentChainId ? client : getPublicClient(wagmiConfig, { chainId: txChainId as never });
      if (!txClient) {
        setStatus({ phase: "error", message: `No RPC configured for chain ${txChainId}` });
        return;
      }
      try {
        if (txChainId !== homeChainId) {
          await switchChainAsync({ chainId: txChainId });
        }
        const approvalSpec =
          approval ??
          (usdcApproval !== undefined && usdc
            ? { token: usdc, spender: target.address, amount: usdcApproval }
            : undefined);
        if (approvalSpec) {
          const allowance = (await txClient.readContract({
            address: approvalSpec.token,
            abi: erc20Abi,
            functionName: "allowance",
            args: [account, approvalSpec.spender],
          })) as bigint;
          if (allowance < approvalSpec.amount) {
            setStatus({ phase: "approving" });
            const approveHash = await writeContractAsync({
              address: approvalSpec.token,
              abi: erc20Abi,
              functionName: "approve",
              args: [approvalSpec.spender, maxUint256],
              chainId: txChainId as never,
            });
            await txClient.waitForTransactionReceipt({ hash: approveHash });
          }
        }
        setStatus({ phase: "confirming" });
        const hash = await writeContractAsync({
          address: target.address,
          abi: target.abi as never,
          functionName: functionName as never,
          args: args as never,
          chainId: txChainId as never,
        });
        const receipt = await txClient.waitForTransactionReceipt({ hash });
        if (receipt.status !== "success") throw new Error("Transaction reverted");
        if (txChainId !== homeChainId) {
          await switchChainAsync({ chainId: homeChainId }).catch(() => {});
        }
        await queryClient.invalidateQueries();
        setStatus({ phase: "success", hash, label });
        await onSuccess?.();
      } catch (error) {
        if (txChainId !== homeChainId) {
          await switchChainAsync({ chainId: homeChainId }).catch(() => {});
        }
        const message =
          (error as BaseError)?.shortMessage ?? (error as Error)?.message ?? "Transaction failed";
        setStatus({ phase: "error", message });
      }
    },
    [sluice, usdc, account, client, currentChainId, writeContractAsync, switchChainAsync, queryClient],
  );

  const reset = useCallback(() => setStatus({ phase: "idle" }), []);
  return { send, status, reset, busy: status.phase === "approving" || status.phase === "confirming" };
}
