#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DIST_DIR="${ROOT_DIR}/dist"
VERSION="${ACSA_VERSION:-$(sed -n 's/^version = "\(.*\)"/\1/p' "${ROOT_DIR}/core/Cargo.toml" | head -n 1)}"
TARGET_TRIPLE="${1:-$(rustc -vV | sed -n 's/^host: //p')}"
UI_PORT="${PORT:-3000}"
PACKAGE_NAME="acsa-core-${VERSION}-${TARGET_TRIPLE}"
PACKAGE_DIR="${DIST_DIR}/${PACKAGE_NAME}"

rm -rf "${PACKAGE_DIR}"
mkdir -p "${PACKAGE_DIR}"

pushd "${ROOT_DIR}" >/dev/null
cargo build --release --locked -p acsa-core --target "${TARGET_TRIPLE}"
popd >/dev/null

pushd "${ROOT_DIR}/ui" >/dev/null
npm ci
npm run build
popd >/dev/null

# Handle Windows .exe extension
if [[ "${TARGET_TRIPLE}" == *"windows"* ]]; then
  cp "${ROOT_DIR}/target/${TARGET_TRIPLE}/release/acsa-core.exe" "${PACKAGE_DIR}/acsa-core.exe"
else
  cp "${ROOT_DIR}/target/${TARGET_TRIPLE}/release/acsa-core" "${PACKAGE_DIR}/acsa-core"
fi
cp -R "${ROOT_DIR}/ui/.next/standalone" "${PACKAGE_DIR}/ui"
mkdir -p "${PACKAGE_DIR}/ui/.next"
cp -R "${ROOT_DIR}/ui/.next/static" "${PACKAGE_DIR}/ui/.next/static"
cp -R "${ROOT_DIR}/ui/public" "${PACKAGE_DIR}/ui/public"
cp "${ROOT_DIR}/deploy/docker/start.sh" "${PACKAGE_DIR}/start.sh"
chmod +x "${PACKAGE_DIR}/start.sh"

cat > "${PACKAGE_DIR}/README.txt" <<EOF
Acsa ${VERSION}

Binary:
  ./acsa-core --version

Engine:
  ACSA_WEBHOOK_SECRET=change-me ./acsa-core serve ./workflows --db ./data/acsa.db --host 127.0.0.1 --port 3001

UI:
  cd ./ui
  PORT=${UI_PORT} HOSTNAME=0.0.0.0 node server.js
EOF

tar -C "${PACKAGE_DIR}" -czf "${DIST_DIR}/${PACKAGE_NAME}.tar.gz" .

if command -v sha256sum >/dev/null 2>&1; then
  (cd "${DIST_DIR}" && sha256sum "${PACKAGE_NAME}.tar.gz" > SHA256SUMS)
elif command -v shasum >/dev/null 2>&1; then
  (cd "${DIST_DIR}" && shasum -a 256 "${PACKAGE_NAME}.tar.gz" > SHA256SUMS)
fi

echo "packaged ${DIST_DIR}/${PACKAGE_NAME}.tar.gz"
