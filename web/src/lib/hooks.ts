"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  useAccount,
  useChainId,
  usePublicClient,
  useReadContract,
  useReadContracts,
  useWriteContract,
} from "wagmi";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { maxUint256, parseAbiItem, type BaseError } from "viem";
import { SLUICE_ADDRESSES, parseStream, sluiceAbi, type Stream } from "./sluice";
import { erc20Abi } from "./erc20Abi";

const streamCreatedEvent = parseAbiItem(
  "event StreamCreated(uint256 indexed streamId, address indexed employer, address indexed recipient, uint256 amount, uint256 durationSeconds, uint256 taxBps, address taxVault)",
);

export function useSluiceAddress(): `0x${string}` | undefined {
  const chainId = useChainId();
  return SLUICE_ADDRESSES[chainId];
}

export function useUsdcAddress(): `0x${string}` | undefined {
  const address = useSluiceAddress();
  const { data } = useReadContract({
    address,
    abi: sluiceAbi,
    functionName: "usdc",
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
    query: { enabled: Boolean(usdc && account), refetchInterval: 5_000 },
  });
}

export interface StreamRef {
  id: bigint;
  employer: `0x${string}`;
  recipient: `0x${string}`;
}

/** All streams ever created, discovered from StreamCreated logs. */
export function useStreamIds() {
  const address = useSluiceAddress();
  const chainId = useChainId();
  const client = usePublicClient();
  return useQuery({
    queryKey: ["stream-ids", chainId, address],
    enabled: Boolean(client && address),
    refetchInterval: 6_000,
    queryFn: async (): Promise<StreamRef[]> => {
      const logs = await client!.getLogs({
        address,
        event: streamCreatedEvent,
        fromBlock: 0n,
        toBlock: "latest",
      });
      return logs.map((log) => ({
        id: log.args.streamId!,
        employer: log.args.employer!,
        recipient: log.args.recipient!,
      }));
    },
  });
}

/** Full on-chain state for one stream. */
export function useStream(id: bigint | undefined) {
  const address = useSluiceAddress();
  const enabled = Boolean(address && id !== undefined);
  const contract = { address: address!, abi: sluiceAbi } as const;
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
  /** Success banner label, e.g. "Withdrew 120 USDC". */
  label: string;
  onSuccess?: () => void | Promise<void>;
}

/** Shared write pipeline: optional USDC approve → tx → wait → refresh reads. */
export function useSluiceWrite() {
  const sluice = useSluiceAddress();
  const usdc = useUsdcAddress();
  const { address: account } = useAccount();
  const client = usePublicClient();
  const { writeContractAsync } = useWriteContract();
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<TxStatus>({ phase: "idle" });

  const send = useCallback(
    async ({ functionName, args, usdcApproval, label, onSuccess }: SendOptions) => {
      if (!sluice || !client || !account) {
        setStatus({ phase: "error", message: "Connect a wallet first." });
        return;
      }
      try {
        if (usdcApproval !== undefined && usdc) {
          const allowance = (await client.readContract({
            address: usdc,
            abi: erc20Abi,
            functionName: "allowance",
            args: [account, sluice],
          })) as bigint;
          if (allowance < usdcApproval) {
            setStatus({ phase: "approving" });
            const approveHash = await writeContractAsync({
              address: usdc,
              abi: erc20Abi,
              functionName: "approve",
              args: [sluice, maxUint256],
            });
            await client.waitForTransactionReceipt({ hash: approveHash });
          }
        }
        setStatus({ phase: "confirming" });
        const hash = await writeContractAsync({
          address: sluice,
          abi: sluiceAbi,
          functionName: functionName as never,
          args: args as never,
        });
        const receipt = await client.waitForTransactionReceipt({ hash });
        if (receipt.status !== "success") throw new Error("Transaction reverted");
        await queryClient.invalidateQueries();
        setStatus({ phase: "success", hash, label });
        await onSuccess?.();
      } catch (error) {
        const message =
          (error as BaseError)?.shortMessage ?? (error as Error)?.message ?? "Transaction failed";
        setStatus({ phase: "error", message });
      }
    },
    [sluice, usdc, account, client, writeContractAsync, queryClient],
  );

  const reset = useCallback(() => setStatus({ phase: "idle" }), []);
  return { send, status, reset, busy: status.phase === "approving" || status.phase === "confirming" };
}
