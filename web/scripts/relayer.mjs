#!/usr/bin/env node
/**
 * Sluice local CCTP relayer.
 *
 * Plays the role of Circle's attestation service for the twin-anvil demo:
 *  - watches DepositForBurn on both mock messengers and delivers each message to
 *    the destination chain's receiveMessage (minting USDC + firing the hook);
 *  - watches the Arc treasury for RemoteReturnRequested and triggers the Base
 *    vault's exitToArc so cross-chain yield positions come home.
 *
 * Usage: node web/scripts/relayer.mjs   (after both DeployLocal scripts have run)
 */
import { createPublicClient, createWalletClient, http, parseAbi, defineChain } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const depA = JSON.parse(readFileSync(join(root, "web/src/lib/deployments.31337.json")));
const depB = JSON.parse(readFileSync(join(root, "web/src/lib/deployments.31338.json")));

// anvil dev account #9 — the relayer's identity on both chains.
const relayer = privateKeyToAccount("0x2a871d0798f97d79848a013d4936a73bf4cc922c825d33c1cf7073dff6d409c6");

const messengerAbi = parseAbi([
  "event DepositForBurn(uint64 indexed nonce, uint32 indexed destinationDomain, address indexed burnSender, address mintRecipient, uint256 amount, bytes hookData)",
  "function receiveMessage(uint32 sourceDomain, uint64 nonce, address sourceSender, address recipient, uint256 amount, bytes hookData)",
]);
const treasuryAbi = parseAbi([
  "event RemoteReturnRequested(address indexed vault, uint32 indexed domain)",
]);
const vaultAbi = parseAbi(["function exitToArc() returns (uint256)"]);

const mkChain = (id, name, port) =>
  defineChain({
    id,
    name,
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [`http://127.0.0.1:${port}`] } },
  });

const chains = {
  arc: { chain: mkChain(31337, "Arc (local)", 8545), domain: 26, messenger: depA.messenger },
  base: { chain: mkChain(31338, "Base (local)", 8546), domain: 6, messenger: depB.messenger },
};

for (const side of Object.values(chains)) {
  side.pub = createPublicClient({ chain: side.chain, transport: http() });
  side.wallet = createWalletClient({ account: relayer, chain: side.chain, transport: http() });
  side.lastBlock = 0n;
}

const fmt = (amount) => `${(Number(amount) / 1e6).toFixed(2)} USDC`;
const log = (msg) => console.log(`[relayer ${new Date().toISOString().slice(11, 19)}] ${msg}`);

async function relayBurns(src, dst) {
  const latest = await src.pub.getBlockNumber();
  if (latest <= src.lastBlock) return;
  const logs = await src.pub.getContractEvents({
    address: src.messenger,
    abi: messengerAbi,
    eventName: "DepositForBurn",
    fromBlock: src.lastBlock + 1n,
    toBlock: latest,
  });
  src.lastBlock = latest;
  for (const event of logs) {
    const { nonce, destinationDomain, burnSender, mintRecipient, amount, hookData } = event.args;
    if (Number(destinationDomain) !== dst.domain) continue;
    try {
      const hash = await dst.wallet.writeContract({
        address: dst.messenger,
        abi: messengerAbi,
        functionName: "receiveMessage",
        args: [src.domain, nonce, burnSender, mintRecipient, amount, hookData],
      });
      await dst.pub.waitForTransactionReceipt({ hash });
      log(`${src.chain.name} → ${dst.chain.name}: delivered ${fmt(amount)} to ${mintRecipient} (nonce ${nonce})`);
    } catch (error) {
      log(`FAILED delivery nonce ${nonce}: ${error.shortMessage ?? error.message}`);
    }
  }
}

let treasuryLastBlock = 0n;
async function relayReturnRequests() {
  const arc = chains.arc;
  const latest = await arc.pub.getBlockNumber();
  if (latest <= treasuryLastBlock) return;
  const logs = await arc.pub.getContractEvents({
    address: depA.treasury,
    abi: treasuryAbi,
    eventName: "RemoteReturnRequested",
    fromBlock: treasuryLastBlock + 1n,
    toBlock: latest,
  });
  treasuryLastBlock = latest;
  for (const event of logs) {
    try {
      const hash = await chains.base.wallet.writeContract({
        address: event.args.vault,
        abi: vaultAbi,
        functionName: "exitToArc",
      });
      await chains.base.pub.waitForTransactionReceipt({ hash });
      log(`Base vault exitToArc triggered (${event.args.vault})`);
    } catch (error) {
      log(`FAILED exitToArc: ${error.shortMessage ?? error.message}`);
    }
  }
}

log(`watching Arc messenger ${chains.arc.messenger} and Base messenger ${chains.base.messenger}`);
setInterval(async () => {
  try {
    await relayBurns(chains.arc, chains.base);
    await relayBurns(chains.base, chains.arc);
    await relayReturnRequests();
  } catch (error) {
    log(`poll error: ${error.shortMessage ?? error.message}`);
  }
}, 700);
