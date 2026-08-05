#!/usr/bin/env node
/**
 * Sluice CCTP v2 attestation relayer — real Circle infrastructure, no mocks.
 *
 * Discovery: watches Circle's TokenMessengerV2 on Arc Testnet and Base Sepolia
 * for burns involving Sluice contracts and enqueues them durably.
 * Processing: per-message state machine with independent steps and bounded
 * retries — no head-of-line blocking, transient failures never abandon funds:
 *   pending → delivered (MessageTransmitterV2.receiveMessage after Iris attests)
 *           → done      (hook executed on the recipient, if the burn carried one)
 * A message is only poisoned after MAX_ATTEMPTS distinct failures, loudly.
 * Also retries RemoteReturnRequested → vault.exitToArc until it succeeds.
 *
 * Usage: node web/scripts/cctp-relayer.mjs   (reads PRIVATE_KEY from ./.env)
 */
import { createPublicClient, createWalletClient, http, parseAbi, defineChain, decodeEventLog } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const env = Object.fromEntries(
  readFileSync(join(root, ".env"), "utf8").trim().split("\n").map((line) => line.split("=")),
);
const depArc = JSON.parse(readFileSync(join(root, "web/src/lib/deployments.5042002.json")));
const depBase = JSON.parse(readFileSync(join(root, "web/src/lib/deployments.84532.json")));

const account = privateKeyToAccount(env.PRIVATE_KEY);
const IRIS = "https://iris-api-sandbox.circle.com";
const TOKEN_MESSENGER = "0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA";
const MESSAGE_TRANSMITTER = "0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275";
const STATE_FILE = join(root, "web/scripts/.cctp-relayer-state.json");
const MAX_ATTEMPTS = 6;

const messengerAbi = parseAbi([
  "event DepositForBurn(address indexed burnToken, uint256 amount, address indexed depositor, bytes32 mintRecipient, uint32 destinationDomain, bytes32 destinationTokenMessenger, bytes32 destinationCaller, uint256 maxFee, uint32 indexed minFinalityThreshold, bytes hookData)",
]);
const transmitterAbi = parseAbi(["function receiveMessage(bytes message, bytes attestation)"]);
const hookAbi = parseAbi(["function onCCTPHook(uint32 sourceDomain, uint256 amount, bytes hookData)"]);
const treasuryEvents = parseAbi(["event RemoteReturnRequested(address indexed vault, uint32 indexed domain)"]);
const vaultAbi = parseAbi(["function exitToArc() returns (uint256)", "function principal() view returns (uint256)"]);
const erc20Transfer = parseAbi(["event Transfer(address indexed from, address indexed to, uint256 value)"]);

const arcChain = defineChain({
  id: 5042002, name: "Arc Testnet",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 6 },
  rpcUrls: { default: { http: ["https://rpc.testnet.arc.network"] } },
});
const baseChain = defineChain({
  id: 84532, name: "Base Sepolia",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["https://sepolia.base.org"] } },
});

const sides = {
  arc: {
    key: "arc", chain: arcChain, domain: 26, chunk: 9_998n, usdc: "0x3600000000000000000000000000000000000000",
    hookReceivers: new Set([depArc.gate?.toLowerCase(), depArc.treasury?.toLowerCase()].filter(Boolean)),
    ourDepositors: new Set([depArc.gate?.toLowerCase(), depArc.remoteAdapter?.toLowerCase()].filter(Boolean)),
  },
  base: {
    key: "base", chain: baseChain, domain: 6, chunk: 998n, usdc: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
    hookReceivers: new Set([depBase.remoteVault?.toLowerCase()].filter(Boolean)),
    ourDepositors: new Set([depBase.remoteVault?.toLowerCase()].filter(Boolean)),
  },
};
for (const side of Object.values(sides)) {
  side.pub = createPublicClient({ chain: side.chain, transport: http() });
  side.wallet = createWalletClient({ account, chain: side.chain, transport: http() });
}
const byDomain = { 26: sides.arc, 6: sides.base };

const state = existsSync(STATE_FILE)
  ? JSON.parse(readFileSync(STATE_FILE, "utf8"))
  : { messages: {}, lastBlock: {}, returns: {} };
state.messages ??= {};
state.returns ??= {};
state.lastBlock ??= {};
const saveState = () => writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));

const fmt = (amount) => `${(Number(amount) / 1e6).toFixed(4)} USDC`;
const log = (msg) => console.log(`[cctp-relayer ${new Date().toISOString().slice(11, 19)}] ${msg}`);
const bytes32ToAddress = (b) => ("0x" + b.slice(26)).toLowerCase();

async function fetchAttestation(sourceDomain, txHash) {
  const res = await fetch(`${IRIS}/v2/messages/${sourceDomain}?transactionHash=${txHash}`);
  if (!res.ok) return null;
  const body = await res.json();
  const message = body.messages?.[0];
  if (!message || message.status !== "complete" || !message.attestation) return null;
  return message;
}

// ------------------------------------------------------------------ discovery

async function discoverBurns(src) {
  const dstDomains = Object.keys(byDomain).map(Number).filter((d) => d !== src.domain);
  const latest = await src.pub.getBlockNumber();
  const cursorKey = `burns:${src.key}`;
  let from = state.lastBlock[cursorKey] ? BigInt(state.lastBlock[cursorKey]) + 1n : latest - 500n;
  if (from < 0n) from = 0n;
  while (from <= latest) {
    let span = src.chunk;
    let to = from + span > latest ? latest : from + span;
    let logs;
    // Adaptive: public RPCs reject ranges by block count OR result count; halve
    // until accepted so a busy range can never wedge the cursor.
    for (;;) {
      try {
        logs = await src.pub.getContractEvents({
          address: TOKEN_MESSENGER, abi: messengerAbi, eventName: "DepositForBurn",
          fromBlock: from, toBlock: to,
        });
        break;
      } catch (error) {
        if (span <= 25n) throw error;
        span /= 2n;
        to = from + span > latest ? latest : from + span;
      }
    }
    for (const eventLog of logs) {
      const burn = eventLog.args;
      const dst = byDomain[Number(burn.destinationDomain)];
      if (!dst) continue;
      const recipient = bytes32ToAddress(burn.mintRecipient);
      const ours =
        src.ourDepositors.has(burn.depositor.toLowerCase()) ||
        dst.hookReceivers.has(recipient) ||
        src.hookReceivers.has(burn.depositor.toLowerCase());
      if (!ours) continue;
      const id = `${src.key}:${eventLog.transactionHash}:${eventLog.logIndex}`;
      if (!state.messages[id]) {
        state.messages[id] = {
          srcKey: src.key,
          dstKey: dst.key,
          txHash: eventLog.transactionHash,
          recipient,
          burnAmount: burn.amount.toString(),
          maxFee: burn.maxFee.toString(),
          hookData: burn.hookData,
          status: "pending", // pending -> delivered -> done | poison
          minted: null,
          attempts: 0,
          note: "",
        };
        log(`queued ${id.slice(0, 40)}… ${fmt(burn.amount)} → ${dst.chain.name} (${recipient.slice(0, 10)}…)`);
      }
    }
    state.lastBlock[cursorKey] = String(to); // always advances — queue holds the work
    saveState();
    from = to + 1n;
  }
}

// ----------------------------------------------------------------- processing

function poisonIfExhausted(id, msg, error) {
  msg.attempts += 1;
  msg.note = String(error?.shortMessage ?? error?.message ?? error).slice(0, 200);
  if (msg.attempts >= MAX_ATTEMPTS) {
    msg.status = "poison";
    log(`POISONED ${id} after ${MAX_ATTEMPTS} attempts — MANUAL ACTION NEEDED: ${msg.note}`);
  } else {
    log(`retry ${msg.attempts}/${MAX_ATTEMPTS} for ${id.slice(0, 40)}…: ${msg.note}`);
  }
}

async function processMessage(id, msg) {
  const src = sides[msg.srcKey];
  const dst = sides[msg.dstKey];

  if (msg.status === "pending") {
    const attested = await fetchAttestation(src.domain, msg.txHash);
    if (!attested) return; // not attested yet — not a failure, no attempt burned
    try {
      const hash = await dst.wallet.writeContract({
        address: MESSAGE_TRANSMITTER, abi: transmitterAbi, functionName: "receiveMessage",
        args: [attested.message, attested.attestation],
      });
      const receipt = await dst.pub.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") throw new Error(`receiveMessage reverted (${hash})`);
      let minted = 0n;
      for (const logEntry of receipt.logs) {
        if (logEntry.address.toLowerCase() !== dst.usdc.toLowerCase()) continue;
        try {
          const parsed = decodeEventLog({ abi: erc20Transfer, data: logEntry.data, topics: logEntry.topics });
          if (
            parsed.args.from === "0x0000000000000000000000000000000000000000" &&
            parsed.args.to.toLowerCase() === msg.recipient
          ) {
            minted = parsed.args.value;
          }
        } catch {}
      }
      msg.minted = minted.toString();
      msg.status = "delivered";
      msg.attempts = 0;
      log(`${src.chain.name} → ${dst.chain.name}: delivered ${fmt(minted)} to ${msg.recipient}`);
    } catch (error) {
      const text = String(error?.shortMessage ?? error?.message ?? "");
      if (/nonce.*(already|used)/i.test(text)) {
        // An earlier attempt (only we can deliver — destinationCaller is locked)
        // already landed; fall back to a conservative minted lower bound.
        msg.minted = (BigInt(msg.burnAmount) - BigInt(msg.maxFee)).toString();
        msg.status = "delivered";
        msg.attempts = 0;
        log(`already delivered on-chain: ${id.slice(0, 40)}… (using conservative minted bound)`);
      } else {
        poisonIfExhausted(id, msg, error);
        return;
      }
    }
  }

  if (msg.status === "delivered") {
    const hasHook = msg.hookData && msg.hookData !== "0x" && dst.hookReceivers.has(msg.recipient);
    if (!hasHook) {
      msg.status = "done";
      return;
    }
    try {
      const hash = await dst.wallet.writeContract({
        address: msg.recipient, abi: hookAbi, functionName: "onCCTPHook",
        args: [src.domain, BigInt(msg.minted), msg.hookData],
      });
      const receipt = await dst.pub.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") throw new Error(`hook reverted (${hash})`);
      msg.status = "done";
      log(`  hook executed on ${msg.recipient} (${hash})`);
    } catch (error) {
      poisonIfExhausted(id, msg, error);
    }
  }
}

// --------------------------------------------------------------- vault exits

async function discoverReturnRequests() {
  if (!depArc.treasury || !depBase.remoteVault) return;
  const arc = sides.arc;
  const latest = await arc.pub.getBlockNumber();
  const cursorKey = "returns:arc";
  let from = state.lastBlock[cursorKey] ? BigInt(state.lastBlock[cursorKey]) + 1n : latest - 500n;
  if (from < 0n) from = 0n;
  while (from <= latest) {
    const to = from + 9_998n > latest ? latest : from + 9_998n;
    const logs = await arc.pub.getContractEvents({
      address: depArc.treasury, abi: treasuryEvents, eventName: "RemoteReturnRequested",
      fromBlock: from, toBlock: to,
    });
    for (const eventLog of logs) {
      const id = `ret:${eventLog.transactionHash}:${eventLog.logIndex}`;
      if (!state.returns[id]) {
        state.returns[id] = { vault: eventLog.args.vault, status: "pending", attempts: 0 };
        log(`queued vault exit request ${id.slice(0, 30)}…`);
      }
    }
    state.lastBlock[cursorKey] = String(to);
    saveState();
    from = to + 1n;
  }
}

async function processReturns() {
  for (const [id, req] of Object.entries(state.returns)) {
    if (req.status !== "pending") continue;
    try {
      // An empty vault means an earlier exit already burned everything home.
      const principal = await sides.base.pub.readContract({
        address: req.vault, abi: vaultAbi, functionName: "principal",
      });
      if (principal === 0n) {
        req.status = "done";
        log(`vault already empty — exit request ${id.slice(0, 30)}… complete`);
        continue;
      }
      const hash = await sides.base.wallet.writeContract({
        address: req.vault, abi: vaultAbi, functionName: "exitToArc",
      });
      const receipt = await sides.base.pub.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") throw new Error(`exitToArc reverted (${hash})`);
      req.status = "done";
      log(`Base Sepolia vault exitToArc executed (${hash})`);
    } catch (error) {
      req.attempts += 1;
      if (req.attempts >= MAX_ATTEMPTS) {
        req.status = "poison";
        log(`POISONED exit request ${id} — MANUAL ACTION NEEDED: ${error?.shortMessage ?? error?.message}`);
      } else {
        log(`exitToArc retry ${req.attempts}/${MAX_ATTEMPTS}: ${error?.shortMessage ?? error?.message}`);
      }
    }
  }
}

// --------------------------------------------------------------------- main

log(`relayer ${account.address}`);
log(`Arc gate=${depArc.gate ?? "?"} treasury=${depArc.treasury ?? "?"} | Base vault=${depBase.remoteVault ?? "?"}`);

let busy = false;
setInterval(async () => {
  if (busy) return;
  busy = true;
  try {
    await discoverBurns(sides.arc);
    await discoverBurns(sides.base);
    await discoverReturnRequests();
    for (const [id, msg] of Object.entries(state.messages)) {
      if (msg.status === "done" || msg.status === "poison") continue;
      await processMessage(id, msg);
    }
    await processReturns();
    saveState();
  } catch (error) {
    log(`poll error: ${error?.shortMessage ?? error?.message ?? error}`);
  } finally {
    busy = false;
  }
}, 4_000);
