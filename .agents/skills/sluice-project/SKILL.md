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
- **Tests**: `test/Sluice.t.sol` + `test/CrossChain.t.sol` (26 total). Run with `forge test`.
- Foundry config uses `src = "contracts"`, not `src`.
- **Verification**: every deployed contract MUST be source-verified. Arcscan and Base Sepolia both run Blockscout (no API key): `./script/verify-all.sh` re-verifies the whole live set from `web/src/lib/deployments.<chainId>.json` and is idempotent. Run it after ANY redeploy - `forge verify-contract <addr> <path:Name> --verifier blockscout --verifier-url https://testnet.arcscan.app/api --compiler-version 0.8.29 --num-of-optimizations 200 --constructor-args <abi-encoded>`.
- **Cross-chain**: `contracts/crosschain/` — REAL Circle CCTP v2 via canonical `TokenMessengerV2` `0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA` (Arc domain 26 / Base Sepolia domain 6), attested by Circle Iris; interfaces in `CCTPInterfaces.sol`. There is NO mock messenger — it was deleted. SluiceGate (fund/buy from any chain, `withdrawToChain` exit), SluiceTreasury + adapters (idle escrow yield, 40% buffer, auto-recall), ERC4626Adapter (real Morpho USDC vault on Arc, 3.5%), RemoteYieldVault on Base Sepolia (8.6%). Relayer: `web/scripts/cctp-relayer.mjs` — it only DELIVERS attested messages and runs their hooks (CCTP does not auto-execute hooks). No local anvils: everything runs against live Arc Testnet + Base Sepolia; addresses in `web/src/lib/deployments.<chainId>.json`, which is what the app loads. `dev.sh` no longer exists — run `cd web && npm run dev`. WARNING: `script/Deploy.s.sol` rewrites the Arc JSON with only the `sluice` key, wiping cross-chain wiring — re-run `DeployCrossChain` + `AddEarnAdapter` after a redeploy.
