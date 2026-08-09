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
// solana-delivery.mjs reads process.env; propagate the .env value so the leg
// works however the relayer is launched (pm2, systemd, bare node).
if (env.SOLANA_PRIVATE_KEY && !process.env.SOLANA_PRIVATE_KEY) {
  process.env.SOLANA_PRIVATE_KEY = env.SOLANA_PRIVATE_KEY;
}
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

/**
 * Additional CCTP v2 destinations. TokenMessengerV2 lives at the same canonical
 * address on every one of these, so a chain is pure configuration. `chunk` is the
 * getLogs window each public RPC tolerates - they differ a lot, and the scanner
 * halves adaptively on failure, so these are starting points rather than limits.
 */
const extraChains = [
  { key: "ethereum", id: 11155111, name: "Ethereum Sepolia", domain: 0, chunk: 498n,
    rpc: "https://ethereum-sepolia-rpc.publicnode.com",
    usdc: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238",
    currency: { name: "Ether", symbol: "ETH", decimals: 18 } },
  { key: "avalanche", id: 43113, name: "Avalanche Fuji", domain: 1, chunk: 1_998n,
    rpc: "https://api.avax-test.network/ext/bc/C/rpc",
    usdc: "0x5425890298aed601595a70AB815c96711a31Bc65",
    currency: { name: "Avax", symbol: "AVAX", decimals: 18 } },
  { key: "optimism", id: 11155420, name: "OP Sepolia", domain: 2, chunk: 998n,
    rpc: "https://sepolia.optimism.io",
    usdc: "0x5fd84259d66Cd46123540766Be93DFE6D43130D7",
    currency: { name: "Ether", symbol: "ETH", decimals: 18 } },
  { key: "arbitrum", id: 421614, name: "Arbitrum Sepolia", domain: 3, chunk: 9_998n,
    rpc: "https://sepolia-rollup.arbitrum.io/rpc",
    usdc: "0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d",
    currency: { name: "Ether", symbol: "ETH", decimals: 18 } },
];

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

// These carry no Sluice contracts, so they have no hook receivers or depositors
// of ours: they are pure payout destinations plus funding sources.
for (const extra of extraChains) {
  sides[extra.key] = {
    key: extra.key,
    chain: defineChain({
      id: extra.id, name: extra.name, nativeCurrency: extra.currency,
      rpcUrls: { default: { http: [extra.rpc] } },
    }),
    domain: extra.domain,
    chunk: extra.chunk,
    usdc: extra.usdc,
    hookReceivers: new Set(),
    ourDepositors: new Set(),
  };
}

for (const side of Object.values(sides)) {
  side.pub = createPublicClient({ chain: side.chain, transport: http() });
  side.wallet = createWalletClient({ account, chain: side.chain, transport: http() });
}

const byDomain = Object.fromEntries(Object.values(sides).map((side) => [side.domain, side]));

const { initSolana, deliverToSolana } = await import("./solana-delivery.mjs");
const solanaCtx = initSolana();
if (solanaCtx) {
  const { solanaPreflight } = await import("./solana-delivery.mjs");
  const pre = await solanaPreflight(solanaCtx);
  console.log(
    `[cctp-relayer] Solana leg ready: relayer ${pre.relayer}, ${pre.solBalance} SOL, ` +
      `Arc route ${pre.arcRouteRegistered ? "registered" : "MISSING"}, ` +
      `USDC pair ${pre.arcUsdcPairRegistered ? "registered" : "MISSING"}`,
  );
  if (pre.solBalance === 0) console.log("[cctp-relayer] WARNING: Solana relayer has 0 SOL - deliveries will fail");
} else {
  console.log("[cctp-relayer] Solana leg disabled (set SOLANA_PRIVATE_KEY to enable)");
}

/**
 * Solana Devnet is a destination only - it has no EVM chain id and no viem
 * client, so it is deliberately NOT a `side`. Registering it here stops the
 * discovery loop from silently dropping Arc->Solana burns, and delivery branches
 * on `dst.solana` further down.
 */
const SOLANA_DOMAIN = 5;
byDomain[SOLANA_DOMAIN] = { key: "solana", domain: SOLANA_DOMAIN, solana: true, hookReceivers: new Set() };

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
      // A Solana recipient is a full 32-byte pubkey; truncating it to 20 bytes
      // the way EVM addresses are unpacked would corrupt it, and the corrupted
      // value would then be persisted into relayer state.
      const recipient = dst.solana ? burn.mintRecipient : bytes32ToAddress(burn.mintRecipient);
      const ours = dst.solana
        ? src.ourDepositors.has(burn.depositor.toLowerCase()) ||
          src.hookReceivers.has(burn.depositor.toLowerCase())
        : src.ourDepositors.has(burn.depositor.toLowerCase()) ||
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
        log(`queued ${id.slice(0, 40)}… ${fmt(burn.amount)} → ${dst.chain?.name ?? "Solana Devnet"} (${recipient.slice(0, 10)}…)`);
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
  const dst = sides[msg.dstKey] ?? byDomain[SOLANA_DOMAIN];

  // Solana delivery is a different stack: an Anchor program call, not an EVM
  // writeContract. It also terminates here - there is no hook to execute
  // afterwards, because a Solana payout is a plain mint to the recipient's ATA.
  if (msg.dstKey === "solana") {
    if (!solanaCtx) {
      log(`skip ${id}: Arc→Solana burn found but SOLANA_PRIVATE_KEY is not set`);
      return;
    }
    if (msg.status !== "pending") return;
    const attested = await fetchAttestation(src.domain, msg.txHash);
    if (!attested) return;
    try {
      const { signature, mintRecipient } = await deliverToSolana(
        solanaCtx,
        attested,
        msg.solanaOwner,
      );
      msg.status = "done";
      msg.attempts = 0;
      msg.solanaSignature = signature;
      log(`Arc → Solana Devnet: minted to ${mintRecipient} (${signature})`);
    } catch (error) {
      msg.attempts = (msg.attempts ?? 0) + 1;
      msg.lastError = String(error?.message ?? error).slice(0, 300);
      if (msg.attempts >= MAX_ATTEMPTS) msg.status = "poison";
      log(`Arc → Solana delivery failed (${msg.attempts}/${MAX_ATTEMPTS}): ${msg.lastError}`);
    }
    saveState();
    return;
  }

  if (msg.status === "pending") {
    // An unfunded destination is an operator problem, not a message problem:
    // burning retry attempts on it poisons messages that would deliver fine the
    // moment gas arrives. Wait, warn once a minute, and keep the message fresh.
    const gas = await dst.pub.getBalance({ address: account.address });
    if (gas === 0n) {
      const now = Date.now();
      if (!msg.gasWarnedAt || now - msg.gasWarnedAt > 60_000) {
        msg.gasWarnedAt = now;
        log(`HOLD ${id.slice(0, 28)}…: relayer has 0 gas on ${dst.chain.name} - fund ${account.address} to deliver`);
      }
      return;
    }
    const attested = await fetchAttestation(src.domain, msg.txHash);
    if (!attested) return; // not attested yet — not a failure, no attempt burned
    try {
      let hash;
      try {
        hash = await dst.wallet.writeContract({
          address: MESSAGE_TRANSMITTER, abi: transmitterAbi, functionName: "receiveMessage",
          args: [attested.message, attested.attestation],
        });
      } catch (error) {
        // Some public RPCs (Fuji's load balancer notably) fail gas ESTIMATION
        // with "state not available for pending block" / "missing or invalid
        // parameters" even though the transaction itself is fine. Retry once
        // with an explicit limit - receiveMessage + mint fits comfortably.
        const text = String(error?.shortMessage ?? error?.message ?? error);
        if (!/state not available|missing or invalid parameters|estimate/i.test(text)) throw error;
        hash = await dst.wallet.writeContract({
          address: MESSAGE_TRANSMITTER, abi: transmitterAbi, functionName: "receiveMessage",
          args: [attested.message, attested.attestation],
          gas: 400_000n,
        });
      }
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
    let span = 9_998n;
    let to = from + span > latest ? latest : from + span;
    let logs;
    // Same adaptive halving as burn discovery: the Arc RPC rejects ranges by
    // block count or result size, and a rejected range must not wedge the cursor.
    for (;;) {
      try {
        logs = await arc.pub.getContractEvents({
          address: depArc.treasury, abi: treasuryEvents, eventName: "RemoteReturnRequested",
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

// Deliveries are paid by this wallet ON THE DESTINATION chain - a side with
// zero native balance can discover burns but never mint them. Say so up front.
for (const side of Object.values(sides)) {
  if (side.solana) continue;
  try {
    const gas = await side.pub.getBalance({ address: account.address });
    const sym = side.chain.nativeCurrency?.symbol ?? "gas";
    log(
      gas === 0n
        ? `WARNING: 0 ${sym} on ${side.chain.name} - deliveries TO this chain will hold until ${account.address} is funded`
        : `gas on ${side.chain.name}: ${(Number(gas) / 1e18).toFixed(4)} ${sym}`,
    );
  } catch {
    log(`gas on ${side.chain.name}: unreadable (RPC error)`);
  }
}

let busy = false;
setInterval(async () => {
  if (busy) return;
  busy = true;
  // Each step is isolated: one flaky RPC must not abort discovery on the other
  // chains or - worse - the delivery of already-queued messages.
  const step = async (label, fn) => {
    try {
      await fn();
    } catch (error) {
      log(`${label} error: ${error?.shortMessage ?? error?.message ?? error}`);
    }
  };
  try {
    // Every EVM side is a funding source: remote chains carry no Sluice
    // contracts, but fund-from-anywhere burns TO our hook receivers originate
    // there, so all of them get scanned - not just Arc and Base.
    for (const side of Object.values(sides)) {
      if (side.solana) continue;
      await step(`discover ${side.key}`, () => discoverBurns(side));
    }
    await step("returns", discoverReturnRequests);
    for (const [id, msg] of Object.entries(state.messages)) {
      if (msg.status === "done" || msg.status === "poison") continue;
      await step(`deliver ${id.slice(0, 28)}…`, () => processMessage(id, msg));
    }
    await step("exits", processReturns);
    saveState();
  } finally {
    busy = false;
  }
}, 4_000);
