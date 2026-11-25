#!/usr/bin/env bash
# Boot a Soroban standalone (local devnet) container, deploy all SwiftChain
# contracts (delivery, escrow, dispute, reputation), and write the deployed
# contract addresses + RPC settings to a temp JSON config for E2E tests (#325).
#
# Usage:
#   ./scripts/soroban-standalone-setup.sh [output_config_path]
#
# Environment overrides:
#   SOROBAN_CONTAINER_NAME   (default: swiftchain-soroban-e2e)
#   SOROBAN_IMAGE            (default: stellar/quickstart:testing)
#   SOROBAN_PORT             (default: 8000)
#   CONTRACTS_WASM_DIR       (default: ./contracts/target/wasm32-unknown-unknown/release)

set -euo pipefail

CONFIG_PATH="${1:-${SOROBAN_E2E_CONFIG:-/tmp/swiftchain-soroban-e2e.json}}"
CONTAINER_NAME="${SOROBAN_CONTAINER_NAME:-swiftchain-soroban-e2e}"
IMAGE="${SOROBAN_IMAGE:-stellar/quickstart:testing}"
PORT="${SOROBAN_PORT:-8000}"
RPC_URL="http://127.0.0.1:${PORT}/soroban/rpc"
NETWORK_PASSPHRASE="Standalone Network ; February 2017"
WASM_DIR="${CONTRACTS_WASM_DIR:-./contracts/target/wasm32-unknown-unknown/release}"

if ! command -v docker >/dev/null 2>&1; then
  echo "[soroban-e2e] ERROR: docker is required to run the Soroban standalone container." >&2
  exit 1
fi

echo "[soroban-e2e] Starting container ${CONTAINER_NAME} (${IMAGE}) on port ${PORT}..."
docker rm -f "${CONTAINER_NAME}" >/dev/null 2>&1 || true
docker run -d --rm \
  --name "${CONTAINER_NAME}" \
  -p "${PORT}:8000" \
  "${IMAGE}" \
  --local \
  --enable-soroban-rpc \
  --enable-soroban-diagnostic-events >/dev/null

echo "[soroban-e2e] Waiting for Soroban RPC at ${RPC_URL}..."
for attempt in $(seq 1 60); do
  if curl -sf -X POST "${RPC_URL}" \
    -H "Content-Type: application/json" \
    -d '{"jsonrpc":"2.0","id":1,"method":"getHealth"}' | grep -q '"healthy"'; then
    echo "[soroban-e2e] Soroban RPC is healthy."
    break
  fi
  if [ "${attempt}" -eq 60 ]; then
    echo "[soroban-e2e] ERROR: Timed out waiting for Soroban RPC." >&2
    docker rm -f "${CONTAINER_NAME}" >/dev/null 2>&1 || true
    exit 1
  fi
  sleep 2
done

deploy_contract() {
  local name="$1"
  local wasm="${WASM_DIR}/${name}.wasm"
  if command -v stellar >/dev/null 2>&1 && [ -f "${wasm}" ]; then
    stellar contract deploy \
      --wasm "${wasm}" \
      --source-account default \
      --rpc-url "${RPC_URL}" \
      --network-passphrase "${NETWORK_PASSPHRASE}"
  else
    echo ""
  fi
}

DELIVERY_CONTRACT_ID="$(deploy_contract delivery)"
ESCROW_CONTRACT_ID="$(deploy_contract escrow)"
DISPUTE_CONTRACT_ID="$(deploy_contract dispute)"
REPUTATION_CONTRACT_ID="$(deploy_contract reputation)"

cat > "${CONFIG_PATH}" <<EOF
{
  "containerName": "${CONTAINER_NAME}",
  "rpcUrl": "${RPC_URL}",
  "network": "standalone",
  "networkPassphrase": "${NETWORK_PASSPHRASE}",
  "contracts": {
    "delivery": "${DELIVERY_CONTRACT_ID}",
    "escrow": "${ESCROW_CONTRACT_ID}",
    "dispute": "${DISPUTE_CONTRACT_ID}",
    "reputation": "${REPUTATION_CONTRACT_ID}"
  }
}
EOF

echo "[soroban-e2e] Wrote standalone config to ${CONFIG_PATH}"
