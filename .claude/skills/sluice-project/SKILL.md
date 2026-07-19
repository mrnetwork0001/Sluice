---
name: sluice-project
description: Load the Sluice project spec (Arc L1 USDC payroll streaming platform) — architecture, Arc testnet config, contract surface, feature list, and milestones. Use whenever working on Sluice contracts, tests, or the web frontend, or when Arc/Circle configuration details are needed.
---

# Sluice Project Context

Read `SLUICE_PROJECT.md` at the repo root — it is the canonical spec. Key facts to
never get wrong:

- **Chain**: Arc Testnet, chain id `5042002` (`0x4CEF52`), RPC `https://rpc.testnet.arc.network`, explorer `https://testnet.arcscan.app`. Gas is paid in USDC.
- **USDC**: `0x3600000000000000000000000000000000000000`, **6 decimals**. All streaming rate math uses 6-decimal per-second precision.
- **Core contract**: `contracts/Sluice.sol`, an ERC-3525 SFT where token *value* = remaining streamable USDC. Slot groups streams; streams are splittable/mergeable/transferable.
- **Contract methods**: `createStream(recipient, amount, durationSeconds, taxBps, taxVault)`, `withdrawFromStream(streamId, amount)` (tax split), `listStreamForSale(streamId, salePrice)`, `buyStream(streamId)`, `borrowSalaryAdvance(streamId, advanceAmount)` (≤50% of value), `stakeInsurancePool(amount)`, `claimDefaultCoverage(streamId)`.
- **Frontend**: Next.js/TypeScript in `web/`, Circle `@circle-fin/app-kit` (Swap Kit + Unified Balance Kit), CCTP/Gateway for cross-chain treasury yield.
- **Tests**: `test/Sluice.t.sol` — rate calc (6 decimals), ERC-3525 value splits, marketplace purchase validation. Run with `forge test`.
- Foundry config uses `src = "contracts"`, not `src`.
