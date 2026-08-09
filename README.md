

# Sluice

### Payroll that flows, block by block.

**Streaming USDC payroll and treasury infrastructure on [Arc](https://arc.network) -
salaries vest every second, taxes split themselves, income becomes a liquid asset,
and idle escrow earns yield across chains.**

*Built for the Programmable Money Hackathon · DeFi Track*

<img src="docs/screenshots/02-dashboard.png" alt="Sluice dashboard" width="850"/>


---

## Table of Contents

- [Why Sluice](#why-sluice)
- [Live Features](#live-features)
- [Architecture](#architecture)
- [How the Core Flows Work](#how-the-core-flows-work)
- [Quick Start](#quick-start)
- [Testing](#testing)
- [Live on Arc Testnet](#live-on-arc-testnet)
- [Repository Layout](#repository-layout)
- [Technology Stack](#technology-stack)
- [Roadmap & Planned Integrations](#roadmap--planned-integrations)
- [Screenshots](#screenshots)
- [Security & Disclaimers](#security--disclaimers)

---

## Why Sluice

Payroll is the largest recurring money flow on earth, and it still runs like a
1970s batch job:

- Workers deliver value **every second** but are paid **every 30 days** - between
  pay runs they are effectively their employer's unsecured creditors.
- Tax withholding is manual back-office work, reconciled after the fact.
- Payroll escrow is one of the largest pools of **dead capital** in any company.
- Future income is real economic value that workers **cannot access, sell, or
  insure**.

Sluice rebuilds payroll as programmable money on Arc - Circle's L1 where **USDC is
the gas token** and finality is sub-second. An employer escrows salary once; from
that block onward the money *flows*.

## Live Features

Everything below is implemented, tested, and clickable in this repository today.

### Per-second salary streaming
Employers open a stream with an amount, duration, tax rate, and tax vault
(`createStream`). Salary vests continuously at a fixed USDC-per-second rate with
6-decimal precision; employees withdraw any vested amount at any time.

### Onchain tax & compliance splits
Every withdrawal automatically routes the configured basis points to a designated
tax vault **before** the employee is paid - compliance enforced by the contract,
not the back office. Configurable per stream (e.g. 8% payroll tax, 0% contractor).

### Streams are ERC-3525 semi-fungible tokens
Each stream is an SFT whose **token value equals the remaining streamable USDC**.
A vendored, minimal ERC-3525 implementation (`contracts/erc3525/`) supports:
- **Split** - carve part of a salary off to another address; deposit, rate, and
  vesting schedule carry over pro-rata with exact math.
- **Merge** - combine same-schedule, same-employer streams.
- **Transfer** - whole streams change owners; the new owner collects all future flow.

### P2P stream factoring marketplace
Employees list streams for sale at a discount (`listStreamForSale`); any liquidity
provider buys them (`buyStream`) - payment goes straight to the seller and the SFT
transfers atomically. Future income becomes instant liquidity, on standard rails.
The protocol takes **0.5% of the ask** (`MARKET_FEE_BPS`) at purchase - the only
fee anywhere in Sluice, charged at the seller's windfall moment, never on payroll.

### Self-repaying salary advances
`borrowSalaryAdvance` lets a stream owner draw up to **50% of unwithdrawn value**
immediately - zero interest, zero liquidation risk. The advance repays itself as
salary continues to vest.

### Credit-default insurance pool
Employees pay a one-time **0.5% premium** (`insureStream`) into a share-based pool
underwritten by USDC stakers (`stakeInsurancePool`). If the employer cancels a
stream early, the unvested shortfall is claimable from the pool
(`claimDefaultCoverage`). Stakers earn every premium.

### Stream-to-DeFi auto-triggers (Circle Swap Kit)
Per-wallet automation rules run after every withdrawal - e.g. *"swap 20% of each
paycheck to EURC."* Executed through `@circle-fin/swap-kit` with the connected
wallet; on chains the kit does not yet route, the trigger records a labeled
simulated run through the identical code path.

### Chain-abstracted payroll (CCTP burn-and-mint + hooks)
Arc settles; every other chain is an on/off ramp. Via `SluiceGate`:
- **Fund from any chain** - a single CCTP burn with a `FUND_STREAM` hook opens the
  stream on Arc; the employer keeps cancel rights.
- **Withdraw to any chain** - `withdrawToChain` pays tax on Arc and burns the net
  amount to the employee's chosen destination: Base, Ethereum, Arbitrum and OP
  Sepolia, Avalanche Fuji - or **Solana Devnet** via `withdrawToDomain`, where
  the relayer delivers the mint to the recipient's USDC token account with a v0
  transaction + address lookup table. All six are live and proven in production.
- **Buy a stream from any chain** - a burn with a `BUY_STREAM` hook settles the
  marketplace purchase atomically on mint; over-payments and vanished listings
  refund automatically.

The word "bridge" appears nowhere in the UI.

### Cross-chain auto-yield treasury
Idle escrow above a **40% liquidity buffer** sweeps into `SluiceTreasury`
(`sweepIdle`, permissionless), which rebalances across yield venues - a local Arc
money market and a remote vault reached via hooked CCTP transfer. Withdrawals that
outrun the buffer **auto-recall liquidity mid-transaction**; remote positions come
home with their accrued yield through a hooked CCTP return. Full NAV accounting and
an on-chain activity feed. NAV above swept principal is protocol revenue,
claimable with `claimYield` - principal coverage is never touched.

### Business model: free for payroll, revenue is the float
Streams, withdrawals, advances and insurance carry **zero protocol fee**; premiums
accrue entirely to stakers. Revenue comes from two switchable surfaces, both live
and both readable on-chain from the landing page: **float yield** (idle escrow
auto-routed to yield venues; `SluiceTreasury.yieldEarned()` above principal is
claimable protocol revenue) and the **0.5% marketplace take**
(`totalMarketFees`). The same model payroll processors have run for decades -
earn on the pre-funded window - except auditable by anyone.

### Full product frontend
Next.js 16 App Router app: marketing landing, live dashboard with per-second
vesting animation, stream detail (withdraw / advance / insure / split / sell),
marketplace, treasury console, and automation rules - all wired to the live Arc
Testnet deployment. An **employer / employee switcher** in the sidebar scopes
the navigation to the role: employers get the full product, employees get the
paycheck side (dashboard, marketplace, automation, onboarding) with creation
surfaces hidden - presentation only, so deep links keep working and the
contracts remain the real permission layer.

## Architecture

```mermaid
flowchart LR
    subgraph Base["Any CCTP chain — 5 EVM testnets + Solana Devnet (yield vault: Base Sepolia)"]
        LP[LP / Employer wallet]
        MB[TokenMessengerV2]
        RV[RemoteYieldVault<br/>8.6% APY]
    end

    subgraph Arc["Arc L1 — USDC gas, sub-second finality"]
        MA[TokenMessengerV2]
        GATE[SluiceGate<br/>hook dispatcher]
        SLUICE[Sluice.sol<br/>ERC-3525 streams · marketplace<br/>advances · insurance pool]
        TRES[SluiceTreasury<br/>NAV · buffer · recall]
        AMM[Morpho USDC Vault<br/>ERC-4626 · 3.5% APY]
    end

    REL((Sluice relayer /<br/>Circle Iris attestation))

    LP -- "burn + hook<br/>(fund · buy)" --> MB
    MB <-- messages --> REL
    REL <-- messages --> MA
    MA -- "mint + onCCTPHook" --> GATE
    GATE -- "createStreamFor<br/>buyStreamFor<br/>withdrawFromStreamFor" --> SLUICE
    SLUICE -- "sweepIdle ⇄ recall" --> TRES
    TRES --> AMM
    TRES -- "hooked CCTP<br/>deposit / return" --> MA
    MA -.-> RV
```

**Six contracts deployed live — every one source-verified on its explorer**, all
running against native Arc USDC and Circle's canonical CCTP v2:

| Contract | Purpose | Live on |
|---|---|---|
| [`Sluice.sol`](contracts/Sluice.sol) | Core payroll: ERC-3525 streams, vesting, tax splits, marketplace (0.5% take), advances, insurance pool, escrow-liability accounting | [Arc ✅](https://testnet.arcscan.app/address/0xE4B8E984B63165846008d936e4B5D5c6D6d5BCE4) |
| [`crosschain/SluiceGate.sol`](contracts/crosschain/SluiceGate.sol) | CCTP hook receiver - cross-chain funding, buyouts, withdrawal exits | [Arc ✅](https://testnet.arcscan.app/address/0xe3510af408bffbd2Cf7629CB5Fc25da745DA7671) |
| [`crosschain/SluiceTreasury.sol`](contracts/crosschain/SluiceTreasury.sol) | Idle-escrow yield router: sweep / rebalance / recall, NAV, `claimYield` revenue | [Arc ✅](https://testnet.arcscan.app/address/0x52fC38aDB7BC3A5DC049BD21b8838436031be4fc) |
| [`crosschain/ERC4626Adapter.sol`](contracts/crosschain/ERC4626Adapter.sol) | Real ERC-4626 adapter - deposits idle escrow into the Morpho USDC vault on Arc | [Arc ✅](https://testnet.arcscan.app/address/0x547612eb7e88577a80Ad5636EC8dF93e80EC3864) |
| [`crosschain/YieldAdapters.sol`](contracts/crosschain/YieldAdapters.sol) | `CCTPRemoteAdapter` - routes escrow to the remote vault via hooked CCTP burns | [Arc ✅](https://testnet.arcscan.app/address/0xe132B4Cd7F451d3CA7a026b7b129B705a13f843D) |
| [`crosschain/RemoteYieldVault.sol`](contracts/crosschain/RemoteYieldVault.sol) | Destination-chain vault; accrues APY, exits home with yield | [Base Sepolia ✅](https://sepolia.basescan.org/address/0x95c46545a6eE4D1D604e739E227C5Db8d417AC97) |

Also in source but never deployed: the vendored ERC-3525 base
([`erc3525/`](contracts/erc3525/)), the canonical CCTP v2 interfaces
([`CCTPInterfaces.sol`](contracts/crosschain/CCTPInterfaces.sol)), and Foundry
test fixtures ([`mocks/`](contracts/mocks/), plus `ReserveYieldAdapter`) that
exist only so the 50-test suite can run without live chains - nothing mocked
ships in the deployment above.

> **No mock messenger.** Cross-chain transfers go through Circle's canonical
> `TokenMessengerV2` and are attested by Circle's Iris API; the local
> [`web/scripts/cctp-relayer.mjs`](web/scripts/cctp-relayer.mjs) only *delivers*
> attested messages and invokes their hooks — it does not stand in for CCTP.
> Circle's **Bridge Kit** is deliberately not used: it does not express the
> `depositForBurnWithHook` payloads Sluice's gate depends on.

## How the Core Flows Work

**Stream lifecycle** - employer escrows `amount` USDC → SFT minted to employee with
value = amount → vests at `amount / duration` per second → withdrawals burn SFT
value, split tax, pay net → employer cancellation pays out vested, refunds
unvested (insured streams: the shortfall becomes a pool claim).

**Cross-chain fund** - employer burns USDC on chain B with an ABI-encoded
`(FUND_STREAM, employer, recipient, duration, taxBps, taxVault)` hook → relayer
delivers → messenger mints to `SluiceGate` and invokes `onCCTPHook` → gate opens
the stream with the minted funds, crediting the original employer.

**Treasury cycle** - anyone calls `sweepIdle()` (safe by construction: only
escrow above the 40% buffer moves) → `rebalance()` allocates 50/50 to the Arc
money market and, via hooked CCTP, the remote vault → any withdrawal exceeding
Sluice's local balance triggers `treasury.recall()` inside `_push` →
`requestRemoteReturn()` + relayer bring the remote position home **with yield**.

## Quick Start

**No setup needed: the app is live at [www.sluiceapp.xyz](https://www.sluiceapp.xyz)** —
connect any EVM wallet and it offers to add Arc Testnet automatically.

To run it locally instead — requirements: Node 20+ and an injected wallet
(MetaMask or similar).

```bash
git clone --recurse-submodules https://github.com/mrnetwork0001/Sluice.git
cd Sluice/web && npm install && npm run dev
```

Open `http://localhost:3000` and connect your wallet — the app offers to add
**Arc Testnet** (chain `5042002`) automatically. Fund it from the faucet linked in
the app; on Arc, USDC *is* the gas token, so one faucet claim covers both.

There is no local chain to boot and no seed data to generate: the app talks
directly to the live Arc Testnet deployment listed below.

Optional environment (only for the Circle-hosted features — see
[`web/.env.local.example`](web/.env.local.example)):

| Variable | Enables |
|---|---|
| `NEXT_PUBLIC_CIRCLE_APP_ID` | MPC wallet onboarding at `/onboard` |
| `CIRCLE_API_KEY` | server-side Circle Wallets + Swap Kit proxy |

**Cross-chain flows need the relayer.** Funding or exiting via Base Sepolia
requires the CCTP relayer to deliver attested messages and execute their hooks:

```bash
PRIVATE_KEY=0x... node web/scripts/cctp-relayer.mjs
```

Without it a burn is still attested by Circle, but nothing mints on the
destination chain — the stream will not appear.

The relayer wallet pays gas **on the destination chain** of every delivery, so
it needs a small native balance on each chain you fund from or withdraw to
(Base Sepolia ETH, Sepolia ETH, Fuji AVAX, …). It prints a per-chain gas report
at startup and HOLDs deliveries to unfunded chains - without poisoning them -
until the wallet is topped up, at which point they deliver automatically.

For Solana Devnet payouts, additionally set `SOLANA_PRIVATE_KEY` (base58 secret
of a devnet-funded keypair) in the same `.env` - the startup preflight reports
`Solana leg ready` with the SOL balance and Circle route registrations, and the
first delivery creates a persistent address lookup table it reuses thereafter.

**In production none of this runs locally**: the live site's relayer is a pm2
app on a VPS (`pm2 start web/scripts/cctp-relayer.mjs --name sluice-relayer`),
reading the same address JSONs from its clone of this repo. Updating it after
a redeploy is `git pull && pm2 restart sluice-relayer`.

**Where to see each feature**

| Feature | Where to click |
|---|---|
| Live vesting, withdraw, advance, insure, split, sell | Dashboard → any stream card |
| Withdraw to another chain | Stream detail → *"Pay out on …"* (5 EVM testnets + Solana Devnet) |
| Fund a stream from another chain | Create Stream → *Fund from: Base via CCTP* |
| Buy a stream cross-chain | Marketplace → *"Buy from Base via CCTP ⚡"* |
| Treasury sweep / rebalance / recall + activity feed | Treasury tab |
| Swap Kit auto-triggers + history | Automation tab |
| Seedless employee wallet (Circle MPC) | `/onboard` |

## Testing

```bash
forge test          # 50 tests
forge test -vvv     # verbose traces
```

Coverage spans per-second rate math (6-decimal precision), ERC-3525 value splits
and merges, marketplace validation, advance caps, insurance premiums/claims,
cancellation settlement, and the entire cross-chain stack - hooked funding,
cross-chain buyouts (including refund paths), withdrawal exits, treasury
sweep/rebalance/recall bounds, and remote yield returns. The test suite plays the
CCTP relayer itself, so cross-chain flows are exercised deterministically in one
EVM. CI (GitHub Actions) enforces `forge fmt`, the build, and the full suite on
every push.

## Live on Arc Testnet

The core Sluice contract is **deployed, seeded, and streaming** on the real Arc
Testnet - per-second vesting, tax splits, marketplace, advances, and the
insurance pool all run against native USDC:

| | |
|---|---|
| **Sluice (core payroll)** | [`0xE4B8E984B63165846008d936e4B5D5c6D6d5BCE4`](https://testnet.arcscan.app/address/0xE4B8E984B63165846008d936e4B5D5c6D6d5BCE4) |
| **SluiceGate (CCTP entry/exit)** | [`0xe3510af408bffbd2Cf7629CB5Fc25da745DA7671`](https://testnet.arcscan.app/address/0xe3510af408bffbd2Cf7629CB5Fc25da745DA7671) |
| **SluiceTreasury (auto-yield)** | [`0x52fC38aDB7BC3A5DC049BD21b8838436031be4fc`](https://testnet.arcscan.app/address/0x52fC38aDB7BC3A5DC049BD21b8838436031be4fc) |
| **Morpho USDC Vault via Circle Earn (3.5%)** | [`0x547612eb7e88577a80Ad5636EC8dF93e80EC3864`](https://testnet.arcscan.app/address/0x547612eb7e88577a80Ad5636EC8dF93e80EC3864) |
| **CCTP Remote Adapter** | [`0xe132B4Cd7F451d3CA7a026b7b129B705a13f843D`](https://testnet.arcscan.app/address/0xe132B4Cd7F451d3CA7a026b7b129B705a13f843D) |
| **RemoteYieldVault (Base Sepolia, 8.6%)** | [`0x95c46545a6eE4D1D604e739E227C5Db8d417AC97`](https://sepolia.basescan.org/address/0x95c46545a6eE4D1D604e739E227C5Db8d417AC97) |
| Chain ID | `5042002` (`0x4CEF52`) |
| RPC | `https://rpc.testnet.arc.network` |
| Explorer | `https://testnet.arcscan.app` |
| USDC (native gas) | `0x3600000000000000000000000000000000000000` |

These are the addresses the app actually loads, from
[`web/src/lib/deployments.5042002.json`](web/src/lib/deployments.5042002.json)
and [`deployments.84532.json`](web/src/lib/deployments.84532.json).

**All six are source-verified** - click any address to read the Solidity and call
it from the explorer's Read/Write tabs. Arcscan and Base Sepolia's explorer both
run Blockscout, so verification needs no API key.

**Auto-triggers are real swaps too.** Withdrawal rules route a slice of each
paycheck through Circle Swap Kit on Arc — live quotes come from Circle's routing
service and the conversion is an on-chain transaction
([example: 0.20 USDC → 0.15503 EURC](https://testnet.arcscan.app/tx/0xce142d92140cc758c0df8d170010628c50f9991045a7cb3bb9118abaa4de495f)).
EURC on Arc is `0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a`. Because Swap Kit's
API blocks cross-origin browser calls, quote/route requests are forwarded by a
server-side proxy (`web/src/app/api/circle/[...path]/route.ts`) — the swap itself
is still signed and broadcast by the user's wallet.

**Cross-chain runs on real Circle CCTP v2 — nothing is mocked.** Burns go through
the canonical `TokenMessengerV2`
(`0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA`, Arc domain 26 ↔ Base Sepolia
domain 6), Circle's Iris API attests them, and the Sluice relayer
([`web/scripts/cctp-relayer.mjs`](web/scripts/cctp-relayer.mjs)) delivers each
mint via `MessageTransmitterV2.receiveMessage` and executes its hook. Yield is
paid in real USDC from pre-funded reserves. Verified end-to-end on the live
testnets: a 0.10 USDC withdrawal exited Arc and landed as **0.092 USDC on Base
Sepolia** (net of 8% tax); a 2.00 USDC burn on Base Sepolia opened a salary
stream on Arc through the gate hook; and the treasury swept escrow, split it
across both chains, and recalled the remote position home with its yield. The
current deployment was exercised the same way on day one: withdrawal with an 8%
tax split, a self-repaying advance, an insured stream, a sweep + rebalance that
CCTP-routed half the idle escrow to Base Sepolia, and a live marketplace sale
that paid the 0.5% protocol take (`totalMarketFees` reads `2500` on-chain).

**The full withdrawal matrix has since been proven from the live site**:
streams funded from Avalanche Fuji, and salaries withdrawn to Base Sepolia,
Ethereum Sepolia, Arbitrum Sepolia, OP Sepolia, Avalanche Fuji **and Solana
Devnet** - every delivery executed by the hosted relayer, ending in a real
balance on the destination chain's explorer. The Solana leg crosses the
EVM/SVM boundary with the same Circle-attested messages, delivered as v0
transactions against the CCTP Solana programs.

### Redeploying

The full set, in order (each script writes the address JSONs the next one and the
frontend read). `Deploy.s.sol` also wires `setFeeRecipient` to the deployer:

```bash
export PRIVATE_KEY=0x...   # funded with Arc testnet USDC + Base Sepolia ETH
forge script script/Deploy.s.sol --rpc-url arc_testnet --broadcast
SLUICE=0x... FROM_BLOCK=... \
  forge script script/DeployCrossChain.s.sol --rpc-url arc_testnet --broadcast
ARC_TREASURY=0x... \
  forge script script/DeployBaseVault.s.sol --rpc-url https://sepolia.base.org --broadcast
SLUICE=0x... TREASURY=0x... REMOTE_VAULT=0x... GATE=0x... LOCAL_ADAPTER=0x... \
  FROM_BLOCK=... TREASURY_FROM_BLOCK=... \
  forge script script/AddRemoteAdapter.s.sol --rpc-url arc_testnet --broadcast
```

> **Seeding caveat:** `script/SeedArc.s.sol` fails in Foundry's local simulation —
> Arc's USDC calls a blocklist precompile (`0x1800…0001`) the local EVM cannot
> execute, and `--skip-simulation` does not bypass script-phase execution. Seed
> with direct transactions instead (`cast send` of `approve`, `createStream`,
> `stakeInsurancePool`), which never touch a local EVM.

**Re-verify after every deploy.** Verification is not automatic, and an
unverified contract is unreadable to anyone evaluating this. One command
re-verifies the whole live set, reading addresses straight from the deployment
JSONs so it stays correct after a redeploy:

```bash
./script/verify-all.sh
```

It is idempotent - already-verified contracts report as passes - so it is safe to
run any time, and should be run immediately after any redeploy.

> **Careful:** `script/Deploy.s.sol` rewrites
> `web/src/lib/deployments.5042002.json` with only the `sluice` key, dropping the
> `gate` / `treasury` / adapter / `fromBlock` entries and disabling every
> cross-chain feature. Re-run `script/DeployCrossChain.s.sol` and
> `script/AddEarnAdapter.s.sol` afterwards, or restore the other keys by hand.

If contracts changed, regenerate the typed ABIs (keep the whole expression on one
line — the Next.js SWC parser rejects a line-broken `] as const`):

```bash
python3 - <<'EOF'
import json, subprocess
for target, name, out in [
    ("contracts/Sluice.sol:Sluice", "sluiceAbi", "web/src/lib/sluiceAbi.ts"),
    ("contracts/crosschain/SluiceTreasury.sol:SluiceTreasury", "treasuryAbi", "web/src/lib/treasuryAbi.ts"),
]:
    abi = json.loads(subprocess.check_output(["forge", "inspect", target, "abi", "--json"]))
    open(out, "w").write(f"export const {name} = {json.dumps(abi, indent=2)} as const;\n")
EOF
```

## Repository Layout

```
contracts/                    Sluice.sol · vendored ERC-3525
contracts/crosschain/         SluiceGate · SluiceTreasury · ERC4626Adapter
                              YieldAdapters · RemoteYieldVault · CCTPInterfaces
contracts/mocks/              MockUSDC · MockERC4626  (test fixtures only)
test/                         Sluice.t.sol · CrossChain.t.sol   (50 tests)
script/                       Deploy · DeployCrossChain · AddEarnAdapter
                              AddRemoteAdapter · DeployBaseVault
web/                          Next.js 16 app — wagmi v3 / viem / Tailwind v4
web/scripts/cctp-relayer.mjs  CCTP attestation delivery + hook execution
web/src/lib/                  chain configs · typed ABIs · deployment address JSONs
docs/                         screenshots · pitch deck · PITCH_DECK.md
```

## Technology Stack

| Layer | Technology |
|---|---|
| Settlement | **Arc L1** - USDC gas, sub-second finality |
| Contracts | Solidity 0.8.x, Foundry (via-IR), vendored ERC-3525 |
| Cross-chain | **Circle CCTP v2** — canonical `TokenMessengerV2` + hooks, Iris attestation, hosted delivery relayer; 5 EVM testnets + Solana Devnet (Anchor / v0 + lookup table) |
| Stablecoin tooling | **Swap Kit** (real USDC→EURC auto-conversion), **Gateway / Unified Balance Kit** (unified cross-chain balance), **Circle Wallets** (MPC onboarding), Morpho USDC vault via ERC-4626 (the vault Circle Earn surfaces on Arc) |
| Frontend | Next.js 16 (App Router), wagmi v3, viem, TanStack Query, Tailwind v4 |
| Quality | 50 Foundry tests, GitHub Actions CI (fmt + build + test), manual end-to-end verification on live Arc + Base Sepolia |

## Roadmap & Planned Integrations

**Phase 1 - Production rails** — ✅ shipped
- [x] **Arc testnet deployment** of the full contract suite — live, addresses above
- [x] **Real CCTP v2** — canonical `TokenMessengerV2`, Circle Iris attestation,
      Arc domain 26 ↔ Base Sepolia domain 6. The mock messenger is gone.
- [x] **Circle Gateway / Unified Balance Kit** on the dashboard
- [x] **Circle Wallets** — seedless MPC onboarding for employees at `/onboard`
- [x] **Circle Earn** — idle escrow earns real yield in the Morpho USDC vault
- [x] Public deployment at **[sluiceapp.xyz](https://www.sluiceapp.xyz)** — frontend on Vercel, relayer on a VPS

**Phase 2 - Payroll operations** — partly shipped
- [x] Batch stream creation — paste a roster or drop a CSV, exact amounts or
      percentage splits, fundable from another chain
- [x] **EURC salary legs** — on-withdrawal FX via Swap Kit auto-triggers
- [x] Scheduled top-ups / recurring pay periods
- [ ] Org-level treasury policies and role-based access
- [ ] Streaming invoices for contractors (reverse direction)
- [x] More CCTP domains — Ethereum, Arbitrum, OP Sepolia, Avalanche Fuji all
      live for funding and payouts (adding one is configuration, not code)
- [x] **Solana Devnet payouts** — `withdrawToDomain` burns to the recipient's
      USDC token account; the relayer mints via the CCTP Solana programs with a
      v0 transaction + lookup table. Proven live, twice.
- [ ] **Solana funding** — the same `FUND_STREAM` hook with a Solana signer:
      the CCTP Solana program already supports `deposit_for_burn_with_hook`,
      so opening a stream from a Solana wallet is wallet UX, not new protocol work
- [x] Hosted relayer — runs as a pm2 app on a VPS; no local process needed

**Phase 3 - Deeper DeFi**
- [ ] Real yield venues behind the adapter interface (Aave-class money markets,
      tokenized T-bill vaults) with risk-weighted allocation targets
- [ ] Secondary-market order book for streams (bids, auctions, partial fills)
- [ ] Under-collateralized credit scoring from on-chain income history
- [ ] Insurance-pool tranching (junior/senior risk)

**Phase 4 - Reach**
- [ ] Fiat off-ramp partners on withdrawal (salary → bank account)
- [ ] Account-abstraction wallets & gas sponsorship for employees
- [ ] Mobile-first PWA
- [ ] Compliance modules: jurisdiction-aware withholding templates, exportable
      tax-vault reports

## Screenshots

| | |
|---|---|
| ![Landing](docs/screenshots/01-landing.png) | ![Stream detail](docs/screenshots/04-stream-detail.png) |
| ![Marketplace](docs/screenshots/07-marketplace.png) | ![Treasury](docs/screenshots/18-treasury-final.png) |

Full gallery in [`docs/screenshots/`](docs/screenshots). Pitch deck:
[`docs/Sluice_Checkpoint_Deck.pptx`](docs/Sluice_Checkpoint_Deck.pptx) ·
slide script in [`docs/PITCH_DECK.md`](docs/PITCH_DECK.md).

## Security & Disclaimers

This is **hackathon software** - unaudited, and not production-ready:

- The live deployment uses **native Arc USDC and Circle's attested CCTP v2** —
  nothing on the critical path is mocked. `MockUSDC` and `MockERC4626` remain in
  `contracts/mocks/` purely as Foundry test fixtures and are not deployed.
- `RemoteYieldVault` and the `ReserveYieldAdapter` model yield from pre-funded
  reserves rather than a real venue; the Arc-side `ERC4626Adapter` is real.
- `setGate` / `setTreasury` / `setFeeRecipient` are one-time, first-caller-wins wiring with **no
  ownership check**. The live instance is already wired, but any fresh deployment
  must be wired in the same transaction batch or an attacker can claim the gate —
  which is privileged (`withdrawFromStreamFor`). Production needs an owner,
  timelocks, and pausability.
- Withdrawals and salary advances do **not** clear an active marketplace listing
  on-chain (cancellation and splits do), so a stale ask can exceed the stream's
  remaining value. The app re-reads remaining value live and refuses the
  purchase; production would auto-delist on any value-reducing action.
- Insured cancellation refunds the unvested balance to the employer *and* records
  the same amount as a claimable shortfall, and nothing prevents `employer ==
  recipient`. A production build needs that guard plus a funded, underwritten pool.
- The relayer is permissionless by design (it only delivers Circle-attested
  messages) but it is a single hosted process — if it is down, cross-chain
  transfers are attested and queue until it returns (nothing is lost; deliveries
  to unfunded chains HOLD rather than fail). Production would run redundant
  relayers with a dedicated low-privilege gas key rather than the deployer key.
- The treasury's liquidity buffer bounds sweeps, but adapter risk, remote-return
  latency, and insurance-pool solvency all deserve formal modeling before real
  funds are involved.

## License

MIT - see [`LICENSE`](LICENSE). Built with Foundry, Circle developer tooling, and
the Arc network.
