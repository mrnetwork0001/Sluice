import { encodeAbiParameters } from "viem";
import { arcTestnet } from "./arc";
import depArc from "./deployments.5042002.json";
import depBase from "./deployments.84532.json";

/**
 * Real cross-chain topology over Circle CCTP v2: Arc Testnet (domain 26) and
 * Base Sepolia (domain 6), joined by the canonical TokenMessengerV2 and the
 * Sluice attestation relayer (web/scripts/cctp-relayer.mjs). Nothing mocked -
 * burns are real, attestations come from Circle's Iris API, mints are real USDC.
 */

export const ARC_DOMAIN = 26;
export const BASE_DOMAIN = 6;
export const BASE_SEPOLIA_CHAIN_ID = 84532;

/** Solana Devnet has no EVM chain id - it is reachable by CCTP domain only. */
export const SOLANA_DOMAIN = 5;

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

/**
 * Every remote chain payroll can be funded from or paid out to.
 *
 * CCTP v2 deploys TokenMessengerV2 at the SAME canonical address on all of these
 * (verified onchain), and SluiceGate already burns to an arbitrary destination
 * domain - so adding a chain is configuration, not a contract change. Each USDC
 * address below was verified live to report symbol=USDC, decimals=6.
 */
export const REMOTE_SIDES: ChainSide[] = [
  BASE_SIDE,
  {
    chainId: 11155111,
    domain: 0,
    label: "Ethereum Sepolia",
    usdc: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238",
    messenger: TOKEN_MESSENGER_V2,
  },
  {
    chainId: 43113,
    domain: 1,
    label: "Avalanche Fuji",
    usdc: "0x5425890298aed601595a70AB815c96711a31Bc65",
    messenger: TOKEN_MESSENGER_V2,
  },
  {
    chainId: 11155420,
    domain: 2,
    label: "OP Sepolia",
    usdc: "0x5fd84259d66Cd46123540766Be93DFE6D43130D7",
    messenger: TOKEN_MESSENGER_V2,
  },
  {
    chainId: 421614,
    domain: 3,
    label: "Arbitrum Sepolia",
    usdc: "0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d",
    messenger: TOKEN_MESSENGER_V2,
  },
];

/** All sides including Arc, for lookups by chain id or domain. */
export const ALL_SIDES: ChainSide[] = [ARC_SIDE, ...REMOTE_SIDES];

export function sideByChainId(chainId: number | undefined): ChainSide | undefined {
  return ALL_SIDES.find((side) => side.chainId === chainId);
}

export function sideByDomain(domain: number): ChainSide | undefined {
  return ALL_SIDES.find((side) => side.domain === domain);
}

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

const BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

/**
 * Decode a base58 Solana address into CCTP's bytes32 recipient.
 *
 * A Solana pubkey is already 32 bytes, so it maps straight onto the same field
 * an EVM address gets left-padded into - which is why SluiceGate needs no change
 * to pay out to Solana. Implemented here rather than pulling bs58 in: it is a
 * dozen lines, and the alternative is depending on a package that only happens
 * to be hoisted today.
 *
 * Returns undefined for anything that is not a valid 32-byte key, so the UI can
 * refuse to burn to an address that could never receive the mint.
 */
export function solanaAddressToBytes32(address: string): `0x${string}` | undefined {
  const trimmed = address.trim();
  if (!trimmed) return undefined;

  const bytes: number[] = [];
  for (const char of trimmed) {
    let carry = BASE58_ALPHABET.indexOf(char);
    if (carry < 0) return undefined;
    for (let i = 0; i < bytes.length; i += 1) {
      carry += bytes[i]! * 58;
      bytes[i] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }
  // Each leading '1' encodes a leading zero byte.
  for (const char of trimmed) {
    if (char !== "1") break;
    bytes.push(0);
  }

  if (bytes.length !== 32) return undefined;
  const hex = bytes
    .reverse()
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  return `0x${hex}` as `0x${string}`;
}

/** True when `address` is a well-formed 32-byte Solana pubkey. */
export function isValidSolanaAddress(address: string): boolean {
  return solanaAddressToBytes32(address) !== undefined;
}

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

// Hook action ids - mirror SluiceHooks in SluiceGate.sol.
const FUND_STREAM = 0;
const BUY_STREAM = 1;
const FUND_BATCH = 4;
const FUND_BATCH_EXACT = 5;

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

/**
 * Payload for a cross-chain payroll run. Allocation is by basis points rather
 * than fixed amounts because CCTP deducts a transfer fee - the exact arriving
 * amount is unknown when the burn is signed, but a percentage split always
 * applies cleanly to whatever lands.
 */
export function encodeFundBatchHook(params: {
  employer: `0x${string}`;
  recipients: readonly `0x${string}`[];
  shareBps: readonly bigint[];
  durationSeconds: bigint;
  taxBps: bigint;
  taxVault: `0x${string}`;
}): `0x${string}` {
  const payload = encodeAbiParameters(
    [
      { type: "address" },
      { type: "address[]" },
      { type: "uint256[]" },
      { type: "uint256" },
      { type: "uint256" },
      { type: "address" },
    ],
    [
      params.employer,
      params.recipients as `0x${string}`[],
      params.shareBps as bigint[],
      params.durationSeconds,
      params.taxBps,
      params.taxVault,
    ],
  );
  return encodeAbiParameters(hookEnvelope, [FUND_BATCH, payload]);
}

/**
 * Cross-chain payroll with exact per-employee amounts. The burn carries fee
 * headroom; the gate opens the streams at their exact sizes and refunds whatever
 * is left over on Arc.
 */
export function encodeFundBatchExactHook(params: {
  employer: `0x${string}`;
  recipients: readonly `0x${string}`[];
  amounts: readonly bigint[];
  durationSeconds: bigint;
  taxBps: bigint;
  taxVault: `0x${string}`;
}): `0x${string}` {
  const payload = encodeAbiParameters(
    [
      { type: "address" },
      { type: "address[]" },
      { type: "uint256[]" },
      { type: "uint256" },
      { type: "uint256" },
      { type: "address" },
    ],
    [
      params.employer,
      params.recipients as `0x${string}`[],
      params.amounts as bigint[],
      params.durationSeconds,
      params.taxBps,
      params.taxVault,
    ],
  );
  return encodeAbiParameters(hookEnvelope, [FUND_BATCH_EXACT, payload]);
}

/** Human label for a CCTP domain id. */
export function domainLabel(domain: number): string {
  if (domain === ARC_DOMAIN) return "Arc";
  if (domain === SOLANA_DOMAIN) return "Solana Devnet";
  return sideByDomain(domain)?.label ?? `Domain ${domain}`;
}
