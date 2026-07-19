#!/usr/bin/env bash
# One-command twin-chain demo: Arc anvil + Base anvil + seeded deployments +
# CCTP relayer + Next.js dev server.
set -euo pipefail
cd "$(dirname "$0")"

RPC_A=http://127.0.0.1:8545
RPC_B=http://127.0.0.1:8546
SLUICE=0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512

rpc_up() {
  curl -sf -X POST -H 'Content-Type: application/json' \
    --data '{"method":"eth_chainId","params":[],"id":1,"jsonrpc":"2.0"}' "$1" >/dev/null
}

wait_rpc() { until rpc_up "$1"; do sleep 0.3; done; }

if ! rpc_up "$RPC_A"; then
  echo "▸ starting anvil (Arc local, :8545)…"
  anvil --silent &
  wait_rpc "$RPC_A"
fi

if ! rpc_up "$RPC_B"; then
  echo "▸ starting anvil (Base local, :8546, chain 31338)…"
  anvil --silent --port 8546 --chain-id 31338 &
  wait_rpc "$RPC_B"
fi

code=$(curl -sf -X POST -H 'Content-Type: application/json' \
  --data "{\"method\":\"eth_getCode\",\"params\":[\"$SLUICE\",\"latest\"],\"id\":1,\"jsonrpc\":\"2.0\"}" "$RPC_A")
if [[ "$code" == *'"result":"0x"'* ]]; then
  echo "▸ deploying Base side + Arc side, seeding demo data…"
  forge script script/DeployLocalB.s.sol --rpc-url "$RPC_B" --broadcast
  forge script script/DeployLocal.s.sol --rpc-url "$RPC_A" --broadcast
fi

if ! pgrep -f "relayer.mjs" >/dev/null; then
  echo "▸ starting CCTP relayer…"
  node web/scripts/relayer.mjs &
fi

echo "▸ starting web app (http://localhost:3000, or next free port)…"
cd web && npm run dev
