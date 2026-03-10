#!/usr/bin/env bash
set -euo pipefail

# Bind to 0.0.0.0 to allow external access in container environments
ENGINE_HOST="${ACSA_ENGINE_HOST:-0.0.0.0}"
ENGINE_PORT="${ACSA_ENGINE_PORT:-3001}"
WORKFLOWS_DIR="${ACSA_WORKFLOWS_DIR:-/app/workflows}"
DB_PATH="${ACSA_DB_PATH:-/app/data/acsa.db}"
UI_PORT="${PORT:-3000}"

mkdir -p "$(dirname "${DB_PATH}")" "${WORKFLOWS_DIR}"

acsa-core serve "${WORKFLOWS_DIR}" --db "${DB_PATH}" --host "${ENGINE_HOST}" --port "${ENGINE_PORT}" &
ENGINE_PID="$!"

# Verify engine process started
sleep 1
if ! kill -0 "${ENGINE_PID}" >/dev/null 2>&1; then
  echo "ERROR: acsa-core failed to start" >&2
  exit 1
fi

cleanup() {
  if kill -0 "${ENGINE_PID}" >/dev/null 2>&1; then
    kill "${ENGINE_PID}"
    wait "${ENGINE_PID}" || true
  fi
}

trap cleanup EXIT INT TERM

# Wait for engine to be ready
max_attempts=30
attempt=0
while [ $attempt -lt $max_attempts ]; do
  if curl -sf "http://${ENGINE_HOST}:${ENGINE_PORT}/health" >/dev/null 2>&1; then
    echo "Engine is ready"
    break
  fi
  attempt=$((attempt + 1))
  if [ $attempt -eq $max_attempts ]; then
    echo "ERROR: Engine failed to become ready within timeout" >&2
    exit 1
  fi
  sleep 1
done

cd /app/ui
HOSTNAME=0.0.0.0 PORT="${UI_PORT}" node server.js
