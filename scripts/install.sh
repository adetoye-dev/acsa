#!/usr/bin/env bash
set -euo pipefail

REPO="${ACSA_INSTALL_REPO:-achsah-systems/acsa}"
VERSION="${ACSA_VERSION:-latest}"
INSTALL_DIR="${ACSA_INSTALL_DIR:-${HOME}/.local/bin}"
BIN_NAME="acsa-core"

require_tool() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "missing required tool: $1" >&2
    exit 1
  fi
}

detect_os() {
  case "$(uname -s)" in
    Linux) echo "linux" ;;
    Darwin) echo "darwin" ;;
    *) echo "unsupported operating system" >&2; exit 1 ;;
  esac
}

detect_arch() {
  case "$(uname -m)" in
    x86_64|amd64) echo "x86_64" ;;
    arm64|aarch64) echo "aarch64" ;;
    *) echo "unsupported architecture" >&2; exit 1 ;;
  esac
}

sha256_check() {
  local sums_file="$1"
  local archive_name="$2"

  if command -v sha256sum >/dev/null 2>&1; then
    if ! awk -v name="${archive_name}" '{ file=$2; sub(/^\*/, "", file); if (file == name) { found=1; exit } } END { exit !found }' "${sums_file}"; then
      echo "ERROR: ${archive_name} not found in checksums file" >&2
      exit 1
    fi
    (cd "$(dirname "${sums_file}")" && sha256sum -c --ignore-missing "$(basename "${sums_file}")")
    return
  fi

  if command -v shasum >/dev/null 2>&1; then
    local expected
    expected="$(awk -v name="${archive_name}" '{ file=$2; sub(/^\*/, "", file); if (file == name) { print $1 } }' "${sums_file}")"
    if [[ -z "${expected}" ]]; then
      echo "could not find checksum for ${archive_name}" >&2
      exit 1
    fi
    local actual
    actual="$(shasum -a 256 "$(dirname "${sums_file}")/${archive_name}" | awk '{print $1}')"
    if [[ "${expected}" != "${actual}" ]]; then
      echo "checksum verification failed for ${archive_name}" >&2
      exit 1
    fi
    return
  fi

  echo "missing required tool: sha256sum or shasum" >&2
  exit 1
}

require_tool curl
require_tool tar
require_tool mktemp

OS="$(detect_os)"
ARCH="$(detect_arch)"
if [[ "${VERSION}" == "latest" ]]; then
  RELEASE_URL="https://github.com/${REPO}/releases/latest/download"
else
  RELEASE_URL="https://github.com/${REPO}/releases/download/${VERSION}"
fi

ARCHIVE="${BIN_NAME}-${OS}-${ARCH}.tar.gz"
SUMS="SHA256SUMS"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "${TMP_DIR}"' EXIT

echo "downloading ${ARCHIVE} from ${RELEASE_URL}"
curl -fsSL "${RELEASE_URL}/${ARCHIVE}" -o "${TMP_DIR}/${ARCHIVE}"
curl -fsSL "${RELEASE_URL}/${SUMS}" -o "${TMP_DIR}/${SUMS}"

sha256_check "${TMP_DIR}/${SUMS}" "${ARCHIVE}"

mkdir -p "${INSTALL_DIR}"
tar -xzf "${TMP_DIR}/${ARCHIVE}" -C "${TMP_DIR}"
install "${TMP_DIR}/${BIN_NAME}" "${INSTALL_DIR}/${BIN_NAME}"

echo "installed ${BIN_NAME} to ${INSTALL_DIR}/${BIN_NAME}"
