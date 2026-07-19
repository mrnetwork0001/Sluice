# Sluice — Streaming Payroll on Arc

Corporate payroll & treasury platform for the **Programmable Money Hackathon on Arc**.
Employers stream USDC salaries block-by-block; tax splits are automatic; employees can
split, sell, insure, and borrow against their income streams — and auto-route each
paycheck into DeFi with Circle Swap Kit.

![Dashboard](docs/screenshots/02-dashboard.png)

## Features

| Feature | Where |
|---|---|
| ERC-3525 salary streams (value = remaining USDC; split/merge/transfer) | `contracts/Sluice.sol` |
| Per-second vesting with automatic tax withholding | `createStream` / `withdrawFromStream` |
| P2P stream factoring — sell future income at a discount | `listStreamForSale` / `buyStream` + Marketplace UI |
| Salary advances, capped at 50% of unwithdrawn value | `borrowSalaryAdvance` |
| Credit-default insurance pool (0.5% premium, staker-underwritten) | `stakeInsurancePool` / `claimDefaultCoverage` |
| Stream-to-DeFi auto-triggers (e.g. 20% of each paycheck → EURC) | Circle Swap Kit, `web/src/lib/automation.ts` |

More context: [SLUICE_PROJECT.md](SLUICE_PROJECT.md). Screenshots: [docs/screenshots/](docs/screenshots/).

## Quick start (local demo)

Requirements: [Foundry](https://getfoundry.sh), Node 20+.

```bash
./dev.sh
```

That starts anvil, deploys `MockUSDC` + `Sluice`, seeds three salary streams (one
insured, one listed at a 10% discount) and a 50,000 USDC insurance pool, then runs the
web app. Open the printed URL and click **Demo wallet** — it connects the seeded
employee account (anvil keeps dev accounts unlocked, so no browser wallet is needed).

To act as the employer or LP instead, import the standard anvil dev keys #0 / #2 into
MetaMask and use **Connect Wallet**.

## Tests

```bash
forge test
```

16 tests cover per-second rate math (6 decimals), ERC-3525 value splits, marketplace
validation, advance caps, insurance claims, and cancellation settlement.

## Arc Testnet

| | |
|---|---|
| Chain ID | `5042002` (`0x4CEF52`) |
| RPC | `https://rpc.testnet.arc.network` |
| Explorer | `https://testnet.arcscan.app` |
| USDC (native gas) | `0x3600000000000000000000000000000000000000` |

Deploy: `forge script script/Deploy.s.sol --rpc-url arc_testnet --broadcast` with a
funded `PRIVATE_KEY`, then set `NEXT_PUBLIC_SLUICE_ADDRESS` in `web/.env.local` and
regenerate the ABI if contracts changed:
`echo "export const sluiceAbi = $(forge inspect Sluice abi --json) as const;" > web/src/lib/sluiceAbi.ts`.

## Layout

```
contracts/           Sluice.sol + vendored minimal ERC-3525 + mocks
test/                Foundry tests
script/              Deploy.s.sol (Arc), DeployLocal.s.sol (seeded anvil demo)
web/                 Next.js app — wagmi/viem, Circle App Kit / Swap Kit / CCTP kits
```
