#!/usr/bin/env bash
set -euo pipefail

cargo audit \
  --ignore RUSTSEC-2026-0006 \
  --ignore RUSTSEC-2026-0020 \
  --ignore RUSTSEC-2026-0021 \
  --ignore RUSTSEC-2025-0057
