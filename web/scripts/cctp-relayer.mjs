#!/usr/bin/env node
/**
 * Sluice CCTP v2 attestation relayer — real Circle infrastructure, no mocks.
 *
 * Watches Circle's TokenMessengerV2 on Arc Testnet and Base Sepolia for burns
 * that involve Sluice contracts, polls Circle's Iris attestation API until the
 * message is attested, delivers the mint via MessageTransmitterV2.receiveMessage,
 * and then executes the Sluice hook (fund stream / buy stream / treasury deposit
 * or return) as the authorized relayer. Also watches the Arc treasury for
 * RemoteReturnRequested and triggers the Base Sepolia vault's exitToArc.
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

const messengerAbi = parseAbi([
  "event DepositForBurn(address indexed burnToken, uint256 amount, address indexed depositor, bytes32 mintRecipient, uint32 destinationDomain, bytes32 destinationTokenMessenger, bytes32 destinationCaller, uint256 maxFee, uint32 indexed minFinalityThreshold, bytes hookData)",
]);
const transmitterAbi = parseAbi(["function receiveMessage(bytes message, bytes attestation)"]);
const hookAbi = parseAbi(["function onCCTPHook(uint32 sourceDomain, uint256 amount, bytes hookData)"]);
const treasuryEvents = parseAbi(["event RemoteReturnRequested(address indexed vault, uint32 indexed domain)"]);
const vaultAbi = parseAbi(["function exitToArc() returns (uint256)"]);
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
    chain: arcChain, domain: 26, usdc: "0x3600000000000000000000000000000000000000",
    hookReceivers: new Set([depArc.gate?.toLowerCase(), depArc.treasury?.toLowerCase()].filter(Boolean)),
    ourDepositors: new Set([depArc.gate?.toLowerCase(), depArc.remoteAdapter?.toLowerCase()].filter(Boolean)),
  },
  base: {
    chain: baseChain, domain: 6, usdc: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
    hookReceivers: new Set([depBase.remoteVault?.toLowerCase()].filter(Boolean)),
    ourDepositors: new Set([depBase.remoteVault?.toLowerCase()].filter(Boolean)),
  },
};
for (const side of Object.values(sides)) {
  side.pub = createPublicClient({ chain: side.chain, transport: http() });
  side.wallet = createWalletClient({ account, chain: side.chain, transport: http() });
}

const state = existsSync(STATE_FILE)
  ? JSON.parse(readFileSync(STATE_FILE, "utf8"))
  : { processed: {}, lastBlock: {}, requestedReturns: {} };
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

async function deliver(src, dst, burn, txHash) {
  const attested = await fetchAttestation(src.domain, txHash);
  if (!attested) return false; // not attested yet — retry next poll

  const hash = await dst.wallet.writeContract({
    address: MESSAGE_TRANSMITTER,
    abi: transmitterAbi,
    functionName: "receiveMessage",
    args: [attested.message, attested.attestation],
  });
  const receipt = await dst.pub.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error(`receiveMessage reverted (${hash})`);

  // Exact minted amount = the USDC Transfer from the zero address in the receipt
  // (net of any fast-transfer fee Circle collected).
  const recipient = bytes32ToAddress(burn.mintRecipient);
  let minted = 0n;
  for (const logEntry of receipt.logs) {
    if (logEntry.address.toLowerCase() !== dst.usdc.toLowerCase()) continue;
    try {
      const parsed = decodeEventLog({ abi: erc20Transfer, data: logEntry.data, topics: logEntry.topics });
      if (
        parsed.args.from === "0x0000000000000000000000000000000000000000" &&
        parsed.args.to.toLowerCase() === recipient
      ) {
        minted = parsed.args.value;
      }
    } catch {}
  }
  log(`${src.chain.name} → ${dst.chain.name}: delivered ${fmt(minted)} to ${recipient}`);

  if (burn.hookData && burn.hookData !== "0x" && dst.hookReceivers.has(recipient)) {
    const hookHash = await dst.wallet.writeContract({
      address: recipient,
      abi: hookAbi,
      functionName: "onCCTPHook",
      args: [src.domain, minted, burn.hookData],
    });
    const hookReceipt = await dst.pub.waitForTransactionReceipt({ hash: hookHash });
    log(`  hook ${hookReceipt.status === "success" ? "executed" : "REVERTED"} on ${recipient} (${hookHash})`);
  }
  return true;
}

async function scanBurns(key, src, dst) {
  const latest = await src.pub.getBlockNumber();
  const from = state.lastBlock[key] ? BigInt(state.lastBlock[key]) + 1n : latest - 500n;
  if (from > latest) return;
  // Chunk to respect getLogs range caps.
  for (let start = from; start <= latest; start += 9_999n) {
    const end = start + 9_998n > latest ? latest : start + 9_998n;
    const logs = await src.pub.getContractEvents({
      address: TOKEN_MESSENGER, abi: messengerAbi, eventName: "DepositForBurn",
      fromBlock: start, toBlock: end,
    });
    for (const eventLog of logs) {
      const burn = eventLog.args;
      if (Number(burn.destinationDomain) !== dst.domain) continue;
      const recipient = bytes32ToAddress(burn.mintRecipient);
      const ours =
        src.ourDepositors.has(burn.depositor.toLowerCase()) ||
        dst.hookReceivers.has(recipient) ||
        src.hookReceivers.has(burn.depositor.toLowerCase());
      if (!ours) continue;
      const id = `${key}:${eventLog.transactionHash}:${eventLog.logIndex}`;
      if (state.processed[id]) continue;
      try {
        const done = await deliver(src, dst, burn, eventLog.transactionHash);
        if (done) {
          state.processed[id] = true;
        } else {
          log(`awaiting attestation for ${eventLog.transactionHash.slice(0, 18)}… (${fmt(burn.amount)})`);
          state.lastBlock[key] = String(start - 1n > 0n ? start - 1n : 0n); // re-scan this range next poll
          saveState();
          return;
        }
      } catch (error) {
        log(`FAILED delivery ${eventLog.transactionHash.slice(0, 18)}…: ${error.shortMessage ?? error.message}`);
        state.processed[id] = true; // don't wedge the pipeline on a poison message
      }
    }
    state.lastBlock[key] = String(end);
    saveState();
  }
}

async function scanReturnRequests() {
  const arc = sides.arc;
  if (!depArc.treasury || !depBase.remoteVault) return;
  const latest = await arc.pub.getBlockNumber();
  const key = "returnRequests";
  const from = state.lastBlock[key] ? BigInt(state.lastBlock[key]) + 1n : latest - 500n;
  if (from > latest) return;
  for (let start = from; start <= latest; start += 9_999n) {
    const end = start + 9_998n > latest ? latest : start + 9_998n;
    const logs = await arc.pub.getContractEvents({
      address: depArc.treasury, abi: treasuryEvents, eventName: "RemoteReturnRequested",
      fromBlock: start, toBlock: end,
    });
    for (const eventLog of logs) {
      const id = `ret:${eventLog.transactionHash}:${eventLog.logIndex}`;
      if (state.requestedReturns[id]) continue;
      try {
        const hash = await sides.base.wallet.writeContract({
          address: eventLog.args.vault, abi: vaultAbi, functionName: "exitToArc",
        });
        await sides.base.pub.waitForTransactionReceipt({ hash });
        log(`Base Sepolia vault exitToArc triggered (${hash})`);
      } catch (error) {
        log(`exitToArc failed: ${error.shortMessage ?? error.message}`);
      }
      state.requestedReturns[id] = true;
    }
    state.lastBlock[key] = String(end);
    saveState();
  }
}

log(`relayer ${account.address}`);
log(`Arc gate=${depArc.gate ?? "?"} treasury=${depArc.treasury ?? "?"} | Base vault=${depBase.remoteVault ?? "?"}`);

let busy = false;
setInterval(async () => {
  if (busy) return;
  busy = true;
  try {
    await scanBurns("arc→base", sides.arc, sides.base);
    await scanBurns("base→arc", sides.base, sides.arc);
    await scanReturnRequests();
  } catch (error) {
    log(`poll error: ${error.shortMessage ?? error.message}`);
  } finally {
    busy = false;
  }
}, 4_000);
