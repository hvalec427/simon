#!/usr/bin/env bash
# Build the signed macOS binaries (arm64 + x64) for a given version from the Rust
# crate in rust/. Produces simon-darwin-arm64 and simon-darwin-x64 at the repo
# root — the asset names the installer and updater expect.
set -euo pipefail

VERSION="$1"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# Local builds read build-time secrets (SIMON_FEEDBACK_KEY) from a gitignored
# .env; CI passes them in the environment instead.
if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  . ./.env
  set +a
fi
# Baked into the binary with option_env!; without it `simon feedback` only
# works when SIMON_FEEDBACK_KEY is set at runtime.
if [ -z "${SIMON_FEEDBACK_KEY:-}" ]; then
  echo "Note: SIMON_FEEDBACK_KEY isn't set; this build won't have a feedback key baked in." >&2
fi

# Inline the version so the binary reports it (env!("CARGO_PKG_VERSION")).
sed -i.bak "s/^version = .*/version = \"${VERSION}\"/" rust/Cargo.toml
rm -f rust/Cargo.toml.bak

rustup target add aarch64-apple-darwin x86_64-apple-darwin >/dev/null 2>&1 || true

cargo build --release --manifest-path rust/Cargo.toml --target aarch64-apple-darwin
cargo build --release --manifest-path rust/Cargo.toml --target x86_64-apple-darwin

cp rust/target/aarch64-apple-darwin/release/simon simon-darwin-arm64
cp rust/target/x86_64-apple-darwin/release/simon simon-darwin-x64

# Ad-hoc sign so Gatekeeper lets the arm64 binary run (same as pkg did before).
codesign --force --sign - simon-darwin-arm64
codesign --force --sign - simon-darwin-x64

echo "Built simon ${VERSION} (arm64 + x64)."
