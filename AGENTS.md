# Sluice

Corporate payroll/treasury platform streaming USDC salaries on **Arc L1** (USDC gas,
sub-second finality). Canonical spec: `SLUICE_PROJECT.md` — read it before making
changes; the `sluice-project` skill loads the same context.

## Quick facts
- Arc Testnet: chain id `5042002` (`0x4CEF52`), RPC `https://rpc.testnet.arc.network`, explorer `https://testnet.arcscan.app`.
- USDC (gas + payroll token): `0x3600000000000000000000000000000000000000`, 6 decimals.
- Contracts live in `contracts/` (Foundry `src = "contracts"`); main contract `contracts/Sluice.sol` is an ERC-3525 SFT (token value = remaining streamable USDC).
- Tests: `forge test` (tests in `test/Sluice.t.sol`).
- Frontend: Next.js/TypeScript in `web/`, Circle App Kit (Swap Kit, Unified Balance Kit).

## Commands
- `forge build` / `forge test -vvv`
- `forge script script/Deploy.s.sol --rpc-url https://rpc.testnet.arc.network --broadcast` (needs `PRIVATE_KEY`)
- `cd web && npm run dev`
