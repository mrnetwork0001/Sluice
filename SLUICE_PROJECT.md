# Sluice — Project Specification & Architecture

> Corporate payroll & treasury platform on **Arc L1** (USDC gas, sub-second finality).
> Built for the Programmable Money Hackathon on Arc.

## What Sluice Does

Employers stream USDC salaries block-by-block. Unstreamed escrow funds dynamically
earn yield, tax/compliance splits are handled automatically, and employees can sell
their future stream receivables at a discount for instant liquidity.

## Network Configuration (Arc Testnet)

| Item | Value |
|---|---|
| Chain ID | `5042002` (hex `0x4CEF52`) |
| RPC URL | `https://rpc.testnet.arc.network` |
| Explorer | `https://testnet.arcscan.app` |
| USDC address | `0x3600000000000000000000000000000000000000` |
| Gas token | USDC |

## 5 Core Features

1. **Semi-Fungible Tokens (ERC-3525) for streams** — every stream is minted as an SFT
   whose *value* is the remaining streamable USDC balance. Streams can be split,
   merged, or transferred.
2. **P2P Stream Discounting (Factoring)** — employees list their SFT streams for sale
   at a discount (e.g. sell a $10,000 stream for $9,500 USDC upfront) to Liquidity
   Providers (LPs).
3. **Cross-Chain Escrow Auto-Yield Routing** — Circle Gateway + CCTP pool idle payroll
   deposits across EVM chains (Arbitrum, Base, Ethereum) into a high-yield treasury
   vault, rebalancing dynamically.
4. **Self-Insured Streams (Credit Default Pools)** — employees pay a 0.5% premium into
   a pool that automatically covers salary streams if an employer defaults.
5. **Stream-to-DeFi Auto-Triggers** — employees set automated routing rules
   (e.g. auto-swap 20% to EURC via Circle Swap Kit on withdrawal).

## Smart Contract Surface (`contracts/Sluice.sol`, ERC-3525)

- `createStream(address recipient, uint256 amount, uint256 durationSeconds, uint256 taxBps, address taxVault)`
- `withdrawFromStream(uint256 streamId, uint256 amount)` — applies the tax split
- `listStreamForSale(uint256 streamId, uint256 salePrice)`
- `buyStream(uint256 streamId)` — swaps SFT owner, transfers discounted payment
- `borrowSalaryAdvance(uint256 streamId, uint256 advanceAmount)` — capped at 50% of stream value
- `stakeInsurancePool(uint256 amount)` / `claimDefaultCoverage(uint256 streamId)`

USDC has **6 decimals** — all rate math is per-second with 6-decimal precision.

## Repository Architecture

```
Sluice/
├── SLUICE_PROJECT.md          # this file — canonical spec
├── foundry.toml               # Foundry config (src = contracts)
├── contracts/
│   ├── Sluice.sol             # main ERC-3525 streaming payroll contract
│   └── erc3525/               # minimal self-contained ERC-3525 implementation
├── test/
│   └── Sluice.t.sol           # unit tests (rate math, splits, marketplace)
├── script/
│   └── Deploy.s.sol           # Arc testnet deploy script
└── web/                       # Next.js + TypeScript frontend
    └── (Circle App Kit: Swap Kit, Unified Balance Kit; Arc chain config)
```

## Milestones

### Phase 1 — Smart Contracts (Solidity + Foundry) — ✅ DONE (16/16 tests passing)
1. `forge init` workspace, `src = contracts`.
2. `Sluice.sol` inheriting ERC-3525.
3. Implement stream lifecycle, marketplace, advances, insurance pool (methods above).
4. Arc testnet USDC wired in.
5. Tests in `test/Sluice.t.sol`:
   - block-by-block rate calculations (6 decimals)
   - ERC-3525 value splits (partial stream transfer to another address)
   - discount marketplace purchase validation

### Phase 2 — Frontend + Circle SDK Integration (Next.js) — ✅ DONE
- ✅ Next.js 16 App Router app in `web/` (Tailwind v4, wagmi v3, viem), builds clean.
- ✅ Wallet connect (injected + "Demo wallet" mock connector that sends real txs to
  anvil's unlocked accounts), chain switcher (Anvil / Arc Testnet).
- ✅ Dashboard (`/`): stat tiles, incoming/outgoing stream cards with live per-second
  vesting animation (client-side ticking between RPC refreshes).
- ✅ Stream detail (`/streams/[id]`): withdraw with tax-split preview, salary advance,
  insure/claim coverage, ERC-3525 split, list/delist, employer cancel.
- ✅ Create stream (`/create`), Marketplace (`/marketplace` incl. insurance-pool
  staking), Automation (`/automation`).
- ✅ Swap Kit auto-triggers: rules in localStorage per wallet, executed after each
  withdrawal via `@circle-fin/swap-kit` + `adapter-viem-v2`; falls back to a recorded
  "simulated" run on chains the kit doesn't support (Arc testnet, anvil).
- ✅ Stream discovery via `StreamCreated` logs (no indexer needed).
- ✅ Local demo: `./dev.sh` (anvil + `script/DeployLocal.s.sol` seed + dev server);
  verified end-to-end headlessly — screenshots in `docs/screenshots/`.

### Phase 3 — Cross-Chain Infrastructure — ✅ DONE (chain-abstracted payroll)
- ✅ `contracts/crosschain/MockCCTPMessenger.sol` — CCTP v2-shaped burn/mint +
  hook messenger (domains: Arc 26, Base 6); `web/scripts/relayer.mjs` plays
  Circle's attestation service across two anvils (8545 Arc / 8546 Base 31338).
- ✅ `SluiceGate.sol` — hooked CCTP mints dispatch into Sluice: **fund a stream
  from any chain** (FUND_STREAM hook → `createStreamFor`, employer keeps cancel
  rights), **buy a listed stream from any chain** (BUY_STREAM → `buyStreamFor`,
  refunds if delisted/underpaid), and `withdrawToChain` exits net salary via
  CCTP burn (tax stays on Arc).
- ✅ `SluiceTreasury.sol` + adapters — idle escrow above a 40% liquidity buffer
  is swept (`Sluice.sweepIdle`), `rebalance()` splits it 50/50 across an Arc
  money market (4.2%) and a Base `RemoteYieldVault` (8.6%, reached via hooked
  CCTP burn); withdrawals auto-recall liquidity (`_push` → `treasury.recall`);
  `requestRemoteReturn` + relayer bring the remote position home with yield.
- ✅ UI: Treasury page (NAV, per-venue positions with chain badges, sweep /
  rebalance / recall, on-chain activity feed), fund-from select on Create,
  payout-destination select on Withdraw, "Buy from Base via CCTP" on listings.
- ✅ 10 cross-chain forge tests (26 total); every flow driven in the browser.
- Twin-chain demo: `./dev.sh` boots both anvils + deploys + relayer + web.
  Address JSONs are written to `web/src/lib/deployments.<chainId>.json`.

### Phase 4 — Testnet stretch
- Swap the mock messenger for `@circle-fin/bridge-kit` + real CCTP v2 domains
  (interfaces intentionally mirror it); Gateway unified balances on dashboard.

## Design Decisions

- **ERC-3525 implementation**: self-contained minimal implementation vendored under
  `contracts/erc3525/` (avoids fragile external deps; slot = stream cohort,
  value = remaining streamable USDC).
- **Streaming math**: `ratePerSecond = amount / durationSeconds` (6-decimal USDC);
  vested = `rate * elapsed`, capped at total. Withdrawal splits `taxBps` to `taxVault`.
- **Marketplace**: escrow-free listing — buyer pays sale price in USDC directly to
  seller, SFT ownership transfers atomically in `buyStream`.
- **Advance**: max cumulative 50% of remaining stream value; repaid implicitly by
  reducing withdrawable balance.
- **Insurance**: stakers deposit USDC into pool; insured streams (0.5% premium) can
  claim remaining balance from pool if employer's escrow is underfunded (default).
