import { encodeAbiParameters } from "viem";
import depA from "./deployments.31337.json";
import depB from "./deployments.31338.json";
import { anvilLocal, anvilLocalB } from "./wagmi";

/**
 * Cross-chain demo topology: two local anvils playing Arc (CCTP domain 26) and
 * Base (domain 6), joined by the mock CCTP messengers + the relayer. On real
 * testnets the same flows route through Circle's Bridge Kit / CCTP v2.
 */

export const ARC_DOMAIN = 26;
export const BASE_DOMAIN = 6;

/**
 * Cross-chain flows currently run against the local twin-chain rig (mock CCTP
 * messenger + relayer). On other chains — including the real Arc Testnet, where
 * only the core Sluice contract is deployed — the cross-chain UI is hidden until
 * the Bridge Kit / real-CCTP integration lands.
 */
export const CROSSCHAIN_DEMO_CHAIN_ID = anvilLocal.id;

export function crossChainEnabled(chainId: number): boolean {
  return chainId === CROSSCHAIN_DEMO_CHAIN_ID;
}

export interface ChainSide {
  chainId: number;
  domain: number;
  label: string;
  usdc: `0x${string}`;
  messenger: `0x${string}`;
}

export const ARC_SIDE: ChainSide = {
  chainId: anvilLocal.id,
  domain: ARC_DOMAIN,
  label: "Arc (local)",
  usdc: depA.usdc as `0x${string}`,
  messenger: depA.messenger as `0x${string}`,
};

export const BASE_SIDE: ChainSide = {
  chainId: anvilLocalB.id,
  domain: BASE_DOMAIN,
  label: "Base (local)",
  usdc: depB.usdc as `0x${string}`,
  messenger: depB.messenger as `0x${string}`,
};

export const GATE_ADDRESS = depA.gate as `0x${string}`;
export const TREASURY_ADDRESS = depA.treasury as `0x${string}`;
export const REMOTE_VAULT_ADDRESS = depB.remoteVault as `0x${string}`;

export const messengerAbi = [
  {
    type: "function",
    name: "depositForBurn",
    stateMutability: "nonpayable",
    inputs: [
      { name: "amount", type: "uint256" },
      { name: "destinationDomain", type: "uint32" },
      { name: "mintRecipient", type: "address" },
    ],
    outputs: [{ type: "uint64" }],
  },
  {
    type: "function",
    name: "depositForBurnWithHook",
    stateMutability: "nonpayable",
    inputs: [
      { name: "amount", type: "uint256" },
      { name: "destinationDomain", type: "uint32" },
      { name: "mintRecipient", type: "address" },
      { name: "hookData", type: "bytes" },
    ],
    outputs: [{ type: "uint64" }],
  },
] as const;

// Hook action ids — mirror SluiceHooks in SluiceGate.sol.
const FUND_STREAM = 0;
const BUY_STREAM = 1;

const hookEnvelope = [{ type: "uint8" }, { type: "bytes" }] as const;

/** Payload for funding a stream from another chain via the gate. */
export function encodeFundStreamHook(params: {
  employer: `0x${string}`;
  recipient: `0x${string}`;
  durationSeconds: bigint;
  taxBps: bigint;
  taxVault: `0x${string}`;
}): `0x${string}` {
  const payload = encodeAbiParameters(
    [
      { type: "address" },
      { type: "address" },
      { type: "uint256" },
      { type: "uint256" },
      { type: "address" },
    ],
    [params.employer, params.recipient, params.durationSeconds, params.taxBps, params.taxVault],
  );
  return encodeAbiParameters(hookEnvelope, [FUND_STREAM, payload]);
}

/** Payload for buying a listed stream from another chain via the gate. */
export function encodeBuyStreamHook(buyer: `0x${string}`, streamId: bigint): `0x${string}` {
  const payload = encodeAbiParameters([{ type: "address" }, { type: "uint256" }], [buyer, streamId]);
  return encodeAbiParameters(hookEnvelope, [BUY_STREAM, payload]);
}

/** Human label for a CCTP domain id. */
export function domainLabel(domain: number): string {
  if (domain === ARC_DOMAIN) return "Arc";
  if (domain === BASE_DOMAIN) return "Base";
  return `Domain ${domain}`;
}
