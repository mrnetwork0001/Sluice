#!/usr/bin/env bash
# One-command local demo: anvil + seeded Sluice deployment + Next.js dev server.
set -euo pipefail
cd "$(dirname "$0")"

RPC=http://127.0.0.1:8545
SLUICE=0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512

if ! curl -sf -X POST -H 'Content-Type: application/json' \
    --data '{"method":"eth_chainId","params":[],"id":1,"jsonrpc":"2.0"}' "$RPC" >/dev/null; then
  echo "▸ starting anvil…"
  anvil --silent &
  until curl -sf -X POST -H 'Content-Type: application/json' \
      --data '{"method":"eth_chainId","params":[],"id":1,"jsonrpc":"2.0"}' "$RPC" >/dev/null; do
    sleep 0.3
  done
fi

code=$(curl -sf -X POST -H 'Content-Type: application/json' \
  --data "{\"method\":\"eth_getCode\",\"params\":[\"$SLUICE\",\"latest\"],\"id\":1,\"jsonrpc\":\"2.0\"}" "$RPC")
if [[ "$code" == *'"result":"0x"'* ]]; then
  echo "▸ deploying + seeding demo data…"
  forge script script/DeployLocal.s.sol --rpc-url "$RPC" --broadcast
fi

echo "▸ starting web app (http://localhost:3000, or next free port)…"
cd web && npm run dev
