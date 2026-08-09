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
import { SLUICE_ADDRESSES, parseStream, sluiceAbi, type Stream } from "./sluice";
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

/**
 * Stream discovery by direct enumeration rather than log scanning.
 *
 * Stream ids are sequential and never burned, so a couple of multicall batches
 * read the whole set from contract state - instant, immune to the RPC's
 * 10,000-block getLogs cap, and it yields the CURRENT owner (which log-based
 * discovery cannot: streams change hands via the marketplace).
 */
const PROBE_BATCH = 20;

/** All streams that exist, with their current owner. */
export function useStreamIds() {
  const address = useSluiceAddress();
  const client = usePublicClient({ chainId: arcTestnet.id });
  return useQuery({
    queryKey: ["stream-ids", arcTestnet.id, address],
    enabled: Boolean(client && address),
    refetchInterval: 5_000,
    queryFn: async (): Promise<StreamRef[]> => {
      const refs: StreamRef[] = [];
      for (let start = 1; ; start += PROBE_BATCH) {
        const ids = Array.from({ length: PROBE_BATCH }, (_, i) => BigInt(start + i));
        const results = await client!.multicall({
          contracts: ids.flatMap((id) => [
            { address: address!, abi: sluiceAbi, functionName: "ownerOf", args: [id] } as const,
            { address: address!, abi: sluiceAbi, functionName: "streams", args: [id] } as const,
          ]),
          allowFailure: true,
        });
        let live = 0;
        ids.forEach((id, index) => {
          const owner = results[index * 2];
          const stream = results[index * 2 + 1];
          if (owner?.status !== "success" || stream?.status !== "success") return;
          live += 1;
          refs.push({
            id,
            employer: (stream.result as readonly unknown[])[0] as `0x${string}`,
            recipient: owner.result as `0x${string}`,
          });
        });
        // A partial batch means we ran past the last minted stream.
        if (live < ids.length) break;
      }
      return refs;
    },
  });
}

/** Full onchain state for one stream. */
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
  | {
      phase: "success";
      hash: `0x${string}`;
      label: string;
      /** Chain the transaction landed on - picks the right block explorer. */
      chainId: number;
      /** Set when an ERC-20 approval was needed first. */
      approvalHash?: `0x${string}`;
    }
  | { phase: "error"; message: string };

interface SendOptions {
  functionName: string;
  args: readonly unknown[];
  /** When set, ensures the Sluice contract has a USDC allowance ≥ this before sending. */
  usdcApproval?: bigint;
  /** Target contract override - defaults to the Sluice contract. */
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
      // Sluice writes live on Arc unless a caller explicitly targets another
      // chain (cross-chain funding burns pass their source chainId). Defaulting
      // to the wallet's current chain sent withdrawals to codeless addresses
      // when the user had switched networks to check a balance.
      const txChainId = chainId ?? arcTestnet.id;
      const txClient = txChainId === currentChainId ? client : getPublicClient(wagmiConfig, { chainId: txChainId as never });
      if (!txClient) {
        setStatus({ phase: "error", message: `No RPC configured for chain ${txChainId}` });
        return;
      }
      try {
        if (txChainId !== homeChainId) {
          await switchChainAsync({ chainId: txChainId });
        }
        let approvalHash: `0x${string}` | undefined;
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
            approvalHash = approveHash;
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
        setStatus({ phase: "success", hash, label, chainId: txChainId, approvalHash });
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
