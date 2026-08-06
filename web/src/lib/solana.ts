"use client";

/**
 * Solana Devnet payout support.
 *
 * The subtle, expensive detail: CCTP's `mintRecipient` for a Solana destination
 * must be the recipient's USDC **Associated Token Account**, not their wallet
 * pubkey. The onchain program asserts
 * `recipient_token_account.key() == mint_recipient`, so burning to a wallet key
 * produces USDC that can never be minted.
 *
 * Worse, CCTP will not create that ATA - if it does not already exist the mint
 * fails and the burn is stranded. Base58 has no checksum, so a typo cannot be
 * caught by parsing alone; the only honest guard is to derive the ATA and check
 * onchain that it exists before letting anyone burn.
 */

import { PublicKey } from "@solana/web3.js";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";

/** Circle's USDC mint on Solana Devnet. */
export const SOLANA_USDC_MINT = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";

export const SOLANA_RPC = "https://api.devnet.solana.com";

/** Parse a base58 Solana address, returning undefined if it is not a 32-byte key. */
export function parseSolanaAddress(address: string): PublicKey | undefined {
  const trimmed = address.trim();
  if (!trimmed) return undefined;
  try {
    const key = new PublicKey(trimmed);
    return key.toBytes().length === 32 ? key : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The recipient's USDC associated token account - what CCTP must mint into.
 * Uses the Sync variant so this stays a pure derivation with no RPC call.
 */
export function usdcAtaFor(ownerAddress: string): PublicKey | undefined {
  const owner = parseSolanaAddress(ownerAddress);
  if (!owner) return undefined;
  try {
    // allowOwnerOffCurve=false: a PDA owner would not be a normal payout target.
    return getAssociatedTokenAddressSync(new PublicKey(SOLANA_USDC_MINT), owner, false);
  } catch {
    return undefined;
  }
}

/** CCTP wants the ATA as bytes32; a Solana pubkey already is 32 bytes. */
export function ataToBytes32(ata: PublicKey): `0x${string}` {
  return `0x${Buffer.from(ata.toBytes()).toString("hex")}` as `0x${string}`;
}

export type AtaStatus =
  | { state: "idle" }
  | { state: "checking" }
  | { state: "invalid" }
  | { state: "missing"; ata: string }
  | { state: "ready"; ata: string };

/**
 * Does the recipient's USDC token account exist on devnet?
 *
 * This is the guard that stops an unmintable burn: without it a typo, or a payee
 * who has simply never held USDC on Solana, results in USDC burned on Arc that
 * nothing can deliver.
 */
export async function checkUsdcAta(ownerAddress: string): Promise<AtaStatus> {
  const ata = usdcAtaFor(ownerAddress);
  if (!ata) return { state: "invalid" };

  try {
    const response = await fetch(SOLANA_RPC, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "getAccountInfo",
        params: [ata.toBase58(), { encoding: "base64" }],
      }),
    });
    const body = (await response.json()) as { result?: { value: unknown } };
    return body.result?.value
      ? { state: "ready", ata: ata.toBase58() }
      : { state: "missing", ata: ata.toBase58() };
  } catch {
    // A failed RPC must not be read as "exists" - that would permit the burn.
    return { state: "missing", ata: ata.toBase58() };
  }
}
