/**
 * Arc (domain 26) -> Solana Devnet (domain 5) delivery leg for cctp-relayer.mjs.
 *
 * The relayer's EVM path calls MessageTransmitterV2.receiveMessage with viem.
 * Solana needs a different stack entirely: an Anchor program call whose account
 * ORDER is load-bearing, because MessageTransmitter CPIs into TokenMessengerMinter
 * and forwards `remainingAccounts` verbatim.
 *
 * Every program id, PDA seed and account position here is taken from Circle's own
 * reference implementation (circle-cctp-crosschain-transfer, src/lib/solana-utils.ts
 * and src/hooks/use-cross-chain-transfer.ts), not from memory.
 *
 * Two facts that decide whether a transfer arrives at all:
 *   1. `mintRecipient` in the burn IS the recipient's Associated Token Account,
 *      not their wallet - the program asserts recipient_token_account == mint_recipient.
 *   2. CCTP does NOT create that ATA. If it is missing the mint fails, so we
 *      prepend an idempotent create instruction when we can, and refuse loudly
 *      when we cannot.
 *
 * Requires SOLANA_PRIVATE_KEY (base58 secret key) for a devnet-funded keypair.
 * SluiceGate sets destinationCaller = bytes32(0), so ANY keypair may deliver.
 */

import { createRequire } from "node:module";
import * as anchor from "@coral-xyz/anchor";
import {
  ComputeBudgetProgram,
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
} from "@solana/web3.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
} from "@solana/spl-token";
import bs58 from "bs58";

const require = createRequire(import.meta.url);
const messageTransmitterIdl = require("./idl/message_transmitter.json");
const tokenMessengerMinterIdl = require("./idl/token_messenger_minter.json");

export const SOLANA_DOMAIN = 5;
const SOLANA_RPC = process.env.SOLANA_RPC ?? "https://api.devnet.solana.com";
const SOLANA_USDC = new PublicKey("4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU");

/** Arc USDC left-padded to bytes32 - the token_pair seed for domain 26. */
const ARC_USDC_BYTES32 = "0x0000000000000000000000003600000000000000000000000000000000000000";

const hexToBuffer = (hex) => Buffer.from(hex.replace(/^0x/, ""), "hex");

function pda(label, programId, extras = []) {
  const seeds = [Buffer.from(label)];
  for (const extra of extras) {
    seeds.push(
      typeof extra === "string"
        ? Buffer.from(extra)
        : Buffer.isBuffer(extra)
          ? extra
          : extra.toBuffer(),
    );
  }
  return PublicKey.findProgramAddressSync(seeds, programId)[0];
}

/** Returns null when SOLANA_PRIVATE_KEY is absent, so the relayer can run EVM-only. */
export function initSolana() {
  const secret = process.env.SOLANA_PRIVATE_KEY;
  if (!secret) return null;

  const connection = new Connection(SOLANA_RPC, "confirmed");
  const keypair = Keypair.fromSecretKey(bs58.decode(secret.trim()));
  const provider = new anchor.AnchorProvider(connection, new anchor.Wallet(keypair), {
    commitment: "confirmed",
  });
  const messageTransmitter = new anchor.Program(messageTransmitterIdl, provider);
  const tokenMessengerMinter = new anchor.Program(tokenMessengerMinterIdl, provider);
  return { connection, keypair, messageTransmitter, tokenMessengerMinter };
}

/**
 * Deliver an attested Arc burn on Solana.
 *
 * @param ctx        result of initSolana()
 * @param attested   { message, attestation } hex strings from Iris
 * @param ownerHint  optional base58 wallet pubkey. Needed ONLY to create a
 *                   missing ATA - the burn message carries the ATA, and the
 *                   owner is not recoverable from it.
 */
export async function deliverToSolana(ctx, attested, ownerHint) {
  const { connection, keypair, messageTransmitter, tokenMessengerMinter } = ctx;
  const message = hexToBuffer(attested.message);

  // Header layout: sourceDomain at byte 4, nonce spans [12, 44).
  const sourceDomain = message.readUInt32BE(4);
  const nonce = message.subarray(12, 44);
  const remoteDomain = String(sourceDomain);

  // Body starts at 148: version(4) + burnToken(32) + mintRecipient(32).
  const mintRecipient = new PublicKey(message.subarray(148 + 36, 148 + 68));

  const mtProgram = messageTransmitter.programId;
  const tmmProgram = tokenMessengerMinter.programId;

  const messageTransmitterAccount = pda("message_transmitter", mtProgram);
  const tokenMessengerAccount = pda("token_messenger", tmmProgram);
  const tokenMinterAccount = pda("token_minter", tmmProgram);
  const localToken = pda("local_token", tmmProgram, [SOLANA_USDC]);
  const custodyTokenAccount = pda("custody", tmmProgram, [SOLANA_USDC]);
  const remoteTokenMessenger = pda("remote_token_messenger", tmmProgram, [remoteDomain]);
  const tokenPair = pda("token_pair", tmmProgram, [
    remoteDomain,
    hexToBuffer(ARC_USDC_BYTES32),
  ]);
  const usedNonce = pda("used_nonce", mtProgram, [nonce]);
  const authorityPda = pda("message_transmitter_authority", mtProgram, [tmmProgram]);
  const mtEventAuthority = pda("__event_authority", mtProgram);
  const tmmEventAuthority = pda("__event_authority", tmmProgram);

  // The fee recipient rotates - read it rather than hardcoding.
  const tokenMessengerState =
    await tokenMessengerMinter.account.tokenMessenger.fetch(tokenMessengerAccount);
  const { getAssociatedTokenAddressSync } = await import("@solana/spl-token");
  const feeRecipientTokenAccount = getAssociatedTokenAddressSync(
    SOLANA_USDC,
    tokenMessengerState.feeRecipient,
    true,
  );

  const preInstructions = [ComputeBudgetProgram.setComputeUnitLimit({ units: 500_000 })];

  // CCTP cannot create the destination ATA. Create it ourselves if we know the
  // owner; otherwise fail loudly rather than burning compute on a doomed mint.
  const recipientInfo = await connection.getAccountInfo(mintRecipient);
  if (!recipientInfo) {
    if (!ownerHint) {
      throw new Error(
        `Recipient token account ${mintRecipient.toBase58()} does not exist and no owner ` +
          `pubkey is known, so it cannot be created. The mint would fail.`,
      );
    }
    const owner = new PublicKey(ownerHint);
    const expected = getAssociatedTokenAddressSync(SOLANA_USDC, owner, true);
    if (!expected.equals(mintRecipient)) {
      throw new Error(
        `Owner ${ownerHint} derives ATA ${expected.toBase58()}, but the burn targeted ` +
          `${mintRecipient.toBase58()}. Refusing to deliver.`,
      );
    }
    preInstructions.push(
      createAssociatedTokenAccountIdempotentInstruction(
        keypair.publicKey,
        mintRecipient,
        owner,
        SOLANA_USDC,
        TOKEN_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID,
      ),
    );
  }

  // ORDER IS LOAD-BEARING: MessageTransmitter prepends authority_pda as signer
  // and forwards these verbatim to handle_receive_finalized_message.
  const remainingAccounts = [
    { pubkey: tokenMessengerAccount, isSigner: false, isWritable: false },
    { pubkey: remoteTokenMessenger, isSigner: false, isWritable: false },
    { pubkey: tokenMinterAccount, isSigner: false, isWritable: true },
    { pubkey: localToken, isSigner: false, isWritable: true },
    { pubkey: tokenPair, isSigner: false, isWritable: false },
    { pubkey: feeRecipientTokenAccount, isSigner: false, isWritable: true },
    { pubkey: mintRecipient, isSigner: false, isWritable: true },
    { pubkey: custodyTokenAccount, isSigner: false, isWritable: true },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: tmmEventAuthority, isSigner: false, isWritable: false },
    { pubkey: tmmProgram, isSigner: false, isWritable: false },
  ];

  // Anchor's generated types diverge from .methods at runtime; Circle casts here too.
  const signature = await messageTransmitter.methods
    .receiveMessage({ message, attestation: hexToBuffer(attested.attestation) })
    .accounts({
      payer: keypair.publicKey,
      caller: keypair.publicKey,
      authorityPda,
      messageTransmitter: messageTransmitterAccount,
      usedNonce,
      receiver: tmmProgram,
      systemProgram: SystemProgram.programId,
      eventAuthority: mtEventAuthority,
      program: mtProgram,
    })
    .remainingAccounts(remainingAccounts)
    .preInstructions(preInstructions)
    .rpc();

  return { signature, mintRecipient: mintRecipient.toBase58() };
}

/** Preflight: confirm the Arc->Solana route and our keypair are actually usable. */
export async function solanaPreflight(ctx) {
  const { connection, keypair, tokenMessengerMinter } = ctx;
  const tmmProgram = tokenMessengerMinter.programId;
  const remoteTokenMessenger = pda("remote_token_messenger", tmmProgram, ["26"]);
  const tokenPair = pda("token_pair", tmmProgram, ["26", hexToBuffer(ARC_USDC_BYTES32)]);
  const [balance, remoteInfo, pairInfo] = await Promise.all([
    connection.getBalance(keypair.publicKey),
    connection.getAccountInfo(remoteTokenMessenger),
    connection.getAccountInfo(tokenPair),
  ]);
  return {
    relayer: keypair.publicKey.toBase58(),
    solBalance: balance / 1e9,
    arcRouteRegistered: Boolean(remoteInfo),
    arcUsdcPairRegistered: Boolean(pairInfo),
  };
}
