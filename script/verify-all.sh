#!/usr/bin/env bash
#
# Verify every deployed Sluice contract on its block explorer.
#
# Both Arcscan and Base Sepolia's explorer run Blockscout, which needs no API
# key. Addresses and constructor arguments are read from broadcast/, so this
# stays correct after a redeploy - run it again and it picks up the new set.
#
#   ./script/verify-all.sh
#
# Idempotent: an already-verified contract reports "already verified" and is
# counted as a pass.

set -uo pipefail
cd "$(dirname "$0")/.."

COMPILER="0.8.29"          # must match foundry.toml's toolchain
RUNS="200"                 # optimizer_runs
ARC_EXPLORER="https://testnet.arcscan.app/api"
BASE_EXPLORER="https://base-sepolia.blockscout.com/api"

pass=0; fail=0

verify() { # chainId address path:Name [ctor-sig arg...]
  local chain="$1" addr="$2" target="$3"; shift 3
  local url args="" name="${target##*:}"

  case "$chain" in
    5042002) url="$ARC_EXPLORER" ;;
    84532)   url="$BASE_EXPLORER" ;;
    *) echo "  ?  $name — no explorer configured for chain $chain"; return ;;
  esac

  if [ "$#" -gt 0 ]; then
    local sig="$1"; shift
    args=$(cast abi-encode "$sig" "$@") || { echo "  ✗  $name — could not encode args"; fail=$((fail+1)); return; }
  fi

  local out
  out=$(forge verify-contract "$addr" "$target" \
        --verifier blockscout --verifier-url "$url" \
        --compiler-version "$COMPILER" --num-of-optimizations "$RUNS" \
        ${args:+--constructor-args "$args"} --watch 2>&1)

  if echo "$out" | grep -qi "successfully verified\|already verified\|Pass - Verified"; then
    echo "  ✓  $name  $addr"; pass=$((pass+1))
  else
    echo "  ✗  $name  $addr"; echo "$out" | tail -5 | sed 's/^/       /'; fail=$((fail+1))
  fi
}

SLUICE=$(python3 -c "import json;print(json.load(open('web/src/lib/deployments.5042002.json'))['sluice'])")
GATE=$(python3 -c "import json;print(json.load(open('web/src/lib/deployments.5042002.json'))['gate'])")
TREASURY=$(python3 -c "import json;print(json.load(open('web/src/lib/deployments.5042002.json'))['treasury'])")
LOCAL_ADAPTER=$(python3 -c "import json;print(json.load(open('web/src/lib/deployments.5042002.json'))['localAdapter'])")
REMOTE_ADAPTER=$(python3 -c "import json;print(json.load(open('web/src/lib/deployments.5042002.json'))['remoteAdapter'])")
RELAYER=$(python3 -c "import json;print(json.load(open('web/src/lib/deployments.5042002.json'))['relayer'])")
REMOTE_VAULT=$(python3 -c "import json;print(json.load(open('web/src/lib/deployments.84532.json'))['remoteVault'])")

MESSENGER="0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA"   # canonical TokenMessengerV2
ARC_USDC="0x3600000000000000000000000000000000000000"
BASE_USDC="0x036CbD53842c5426634e7929541eC2318f3dCF7e"
MORPHO_VAULT="0x8f2D33B5D4B9B5F02DF635AE308F7B4C9dA8D2DC"

echo "Verifying Sluice contracts"
echo "  Arc Testnet  -> $ARC_EXPLORER"
echo "  Base Sepolia -> $BASE_EXPLORER"
echo

verify 5042002 "$SLUICE"   contracts/Sluice.sol:Sluice \
  "constructor(address)" "0x0000000000000000000000000000000000000000"

verify 5042002 "$GATE"     contracts/crosschain/SluiceGate.sol:SluiceGate \
  "constructor(address,address,address)" "$SLUICE" "$MESSENGER" "$RELAYER"

verify 5042002 "$TREASURY" contracts/crosschain/SluiceTreasury.sol:SluiceTreasury \
  "constructor(address,address)" "$SLUICE" "$RELAYER"

verify 5042002 "$LOCAL_ADAPTER" contracts/crosschain/ERC4626Adapter.sol:ERC4626Adapter \
  "constructor(address,address,string,uint256,uint32)" \
  "$MORPHO_VAULT" "$TREASURY" "Morpho USDC Vault (Circle Earn)" 350 26

verify 5042002 "$REMOTE_ADAPTER" contracts/crosschain/YieldAdapters.sol:CCTPRemoteAdapter \
  "constructor(address,address,address,address,uint32,string,uint256,address)" \
  "$ARC_USDC" "$MESSENGER" "$TREASURY" "$REMOTE_VAULT" 6 "Base Sepolia Vault" 860 "$RELAYER"

verify 84532 "$REMOTE_VAULT" contracts/crosschain/RemoteYieldVault.sol:RemoteYieldVault \
  "constructor(address,address,address,uint32,uint256,address)" \
  "$BASE_USDC" "$MESSENGER" "$TREASURY" 26 860 "$RELAYER"

echo
echo "  $pass verified, $fail failed"
[ "$fail" -eq 0 ]
