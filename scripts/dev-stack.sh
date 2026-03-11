#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENGINE_HOST="${ACSA_DEV_HOST:-127.0.0.1}"
ENGINE_PORT="${ACSA_DEV_PORT:-3001}"
ENGINE_DB="${ACSA_DEV_DB:-${ROOT_DIR}/acsa-dev.db}"
WORKFLOWS_DIR="${ACSA_DEV_WORKFLOWS_DIR:-${ROOT_DIR}/workflows}"
UI_PORT="${ACSA_UI_PORT:-3000}"
ENGINE_URL="${ACSA_ENGINE_URL:-http://${ENGINE_HOST}:${ENGINE_PORT}}"
WEBHOOK_SECRET="${ACSA_WEBHOOK_SECRET:-acsa-dev-webhook-secret}"
WEBHOOK_SIGNATURE_SECRET="${ACSA_WEBHOOK_SIGNATURE_SECRET:-acsa-dev-webhook-signature-secret}"

require_tool() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "error: missing required tool: $1" >&2
    exit 1
  fi
}

cleanup() {
  if [[ -n "${ENGINE_PID:-}" ]] && kill -0 "${ENGINE_PID}" >/dev/null 2>&1; then
    kill "${ENGINE_PID}" >/dev/null 2>&1 || true
  fi
  if [[ -n "${UI_PID:-}" ]] && kill -0 "${UI_PID}" >/dev/null 2>&1; then
    kill "${UI_PID}" >/dev/null 2>&1 || true
  fi
}

trap cleanup EXIT INT TERM

require_tool cargo
require_tool npm

if [[ ! -d "${ROOT_DIR}/ui/node_modules" ]]; then
  echo "error: ui/node_modules is missing. Run ./scripts/bootstrap-dev.sh first." >&2
  exit 1
fi

echo "Starting Acsa engine on ${ENGINE_URL}"
(
  cd "${ROOT_DIR}"
  ACSA_WEBHOOK_SECRET="${WEBHOOK_SECRET}" \
  ACSA_WEBHOOK_SIGNATURE_SECRET="${WEBHOOK_SIGNATURE_SECRET}" \
  cargo run -p acsa-core -- serve "${WORKFLOWS_DIR}" --db "${ENGINE_DB}" --host "${ENGINE_HOST}" --port "${ENGINE_PORT}"
) &
ENGINE_PID=$!

echo "Starting Acsa UI on http://127.0.0.1:${UI_PORT}"
(
  cd "${ROOT_DIR}/ui"
  ACSA_ENGINE_URL="${ENGINE_URL}" ./node_modules/.bin/next dev --port "${UI_PORT}"
) &
UI_PID=$!

echo
echo "Acsa local stack"
echo "  Engine: ${ENGINE_URL}"
echo "  UI:     http://127.0.0.1:${UI_PORT}"
echo "  DB:     ${ENGINE_DB}"
echo "  Webhook token:     ${WEBHOOK_SECRET}"
echo "  Webhook signature: ${WEBHOOK_SIGNATURE_SECRET}"
echo
echo "Press Ctrl+C to stop both processes."

while kill -0 "${ENGINE_PID}" >/dev/null 2>&1 && kill -0 "${UI_PID}" >/dev/null 2>&1; do
  sleep 1
done

if ! kill -0 "${ENGINE_PID}" >/dev/null 2>&1; then
  wait "${ENGINE_PID}"
else
  wait "${UI_PID}"
fi
