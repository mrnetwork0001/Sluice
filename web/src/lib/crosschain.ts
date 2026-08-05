import { encodeAbiParameters } from "viem";
import { arcTestnet } from "./arc";
import depArc from "./deployments.5042002.json";
import depBase from "./deployments.84532.json";

/**
 * Real cross-chain topology over Circle CCTP v2: Arc Testnet (domain 26) and
 * Base Sepolia (domain 6), joined by the canonical TokenMessengerV2 and the
 * Sluice attestation relayer (web/scripts/cctp-relayer.mjs). Nothing mocked —
 * burns are real, attestations come from Circle's Iris API, mints are real USDC.
 */

export const ARC_DOMAIN = 26;
export const BASE_DOMAIN = 6;
export const BASE_SEPOLIA_CHAIN_ID = 84532;

/** Canonical CCTP v2 TokenMessenger (same address on Arc Testnet + Base Sepolia). */
export const TOKEN_MESSENGER_V2 = "0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA" as const;

/** CCTP v2 finality thresholds: fast (fee ≤ maxFee) vs standard (free). */
export const FINALITY_FAST = 1000;
export const FINALITY_STANDARD = 2000;

const ZERO = "0x0000000000000000000000000000000000000000";
const defined = (value: string | undefined): `0x${string}` | undefined =>
  value && value !== ZERO ? (value as `0x${string}`) : undefined;

export interface ChainSide {
  chainId: number;
  domain: number;
  label: string;
  usdc: `0x${string}`;
  messenger: `0x${string}`;
}

export const ARC_SIDE: ChainSide = {
  chainId: arcTestnet.id,
  domain: ARC_DOMAIN,
  label: "Arc Testnet",
  usdc: "0x3600000000000000000000000000000000000000",
  messenger: TOKEN_MESSENGER_V2,
};

export const BASE_SIDE: ChainSide = {
  chainId: BASE_SEPOLIA_CHAIN_ID,
  domain: BASE_DOMAIN,
  label: "Base Sepolia",
  usdc: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
  messenger: TOKEN_MESSENGER_V2,
};

export const GATE_ADDRESS = defined((depArc as unknown as Record<string, string | undefined>).gate);
export const TREASURY_ADDRESS = defined((depArc as unknown as Record<string, string | undefined>).treasury);
export const REMOTE_VAULT_ADDRESS = defined((depBase as unknown as Record<string, string | undefined>).remoteVault);
export const RELAYER_ADDRESS = defined((depArc as unknown as Record<string, string | undefined>).relayer);

const arcJson = depArc as unknown as Record<string, number | string | undefined>;
export const TREASURY_FROM_BLOCK = BigInt(
  (arcJson.treasuryFromBlock as number | undefined) ?? (arcJson.fromBlock as number | undefined) ?? 0,
);

/** Cross-chain UI is live once the gate is deployed and wired. The app's data
 *  home is always Arc, so the wallet's momentary chain is irrelevant here. */
export function crossChainEnabled(_chainId?: number): boolean {
  return GATE_ADDRESS !== undefined;
}

/** Left-pad an EVM address into CCTP's bytes32 representation. */
export function addressToBytes32(address: `0x${string}`): `0x${string}` {
  return `0x${address.slice(2).padStart(64, "0")}` as `0x${string}`;
}

export const ZERO_BYTES32 =
  "0x0000000000000000000000000000000000000000000000000000000000000000" as const;

/**
 * destinationCaller for hooked burns: locked to the Sluice relayer so nobody can
 * deliver the mint without also executing the hook.
 */
export function hookDestinationCaller(): `0x${string}` {
  return RELAYER_ADDRESS ? addressToBytes32(RELAYER_ADDRESS) : ZERO_BYTES32;
}

/** Fast-transfer fee cap for user burns leaving Base Sepolia: 0.1%. */
export function fastMaxFee(amount: bigint): bigint {
  const fee = amount / 1_000n;
  return fee > 0n ? fee : 1n;
}

/** CCTP v2 TokenMessenger ABI (from the verified implementation). */
export const messengerAbi = [
  {
    type: "function",
    name: "depositForBurn",
    stateMutability: "nonpayable",
    inputs: [
      { name: "amount", type: "uint256" },
      { name: "destinationDomain", type: "uint32" },
      { name: "mintRecipient", type: "bytes32" },
      { name: "burnToken", type: "address" },
      { name: "destinationCaller", type: "bytes32" },
      { name: "maxFee", type: "uint256" },
      { name: "minFinalityThreshold", type: "uint32" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "depositForBurnWithHook",
    stateMutability: "nonpayable",
    inputs: [
      { name: "amount", type: "uint256" },
      { name: "destinationDomain", type: "uint32" },
      { name: "mintRecipient", type: "bytes32" },
      { name: "burnToken", type: "address" },
      { name: "destinationCaller", type: "bytes32" },
      { name: "maxFee", type: "uint256" },
      { name: "minFinalityThreshold", type: "uint32" },
      { name: "hookData", type: "bytes" },
    ],
    outputs: [],
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
  if (domain === BASE_DOMAIN) return "Base Sepolia";
  return `Domain ${domain}`;
}
