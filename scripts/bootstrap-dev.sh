#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

require_tool() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "error: missing required tool: $1" >&2
    exit 1
  fi
}

echo "Bootstrapping Acsa development environment"
echo "Repository: ${ROOT_DIR}"

require_tool cargo
require_tool node
require_tool npm

echo "Rust: $(cargo --version)"
echo "Node: $(node --version)"
echo "npm:  $(npm --version)"

echo
echo "Installing UI dependencies"
(cd "${ROOT_DIR}/ui" && npm install)

echo
echo "Warming Rust workspace"
(cd "${ROOT_DIR}" && cargo check -p acsa-core)

echo
echo "Linting UI"
(cd "${ROOT_DIR}/ui" && npm run lint)

echo
echo "Bootstrap complete"
echo "Next steps:"
echo "  1. Start the full local stack with ./scripts/dev-stack.sh"
echo "  2. Or run the first success path with cargo run -p acsa-core -- run workflows/manual-demo.yaml --db ./acsa.db"
