#!/usr/bin/env bash
# Build the signed macOS binaries (arm64 + x64) for a given version from the Rust
# crate in rust/. Produces simon-darwin-arm64 and simon-darwin-x64 at the repo
# root — the asset names the installer and updater expect.
set -euo pipefail

VERSION="$1"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# Inline the version so the binary reports it (env!("CARGO_PKG_VERSION")).
sed -i.bak "s/^version = .*/version = \"${VERSION}\"/" rust/simon/Cargo.toml
rm -f rust/simon/Cargo.toml.bak

rustup target add aarch64-apple-darwin x86_64-apple-darwin >/dev/null 2>&1 || true

# Build just the simon binary for release (metroctl ships separately, later).
cargo build --release --manifest-path rust/Cargo.toml -p simon --target aarch64-apple-darwin
cargo build --release --manifest-path rust/Cargo.toml -p simon --target x86_64-apple-darwin

cp rust/target/aarch64-apple-darwin/release/simon simon-darwin-arm64
cp rust/target/x86_64-apple-darwin/release/simon simon-darwin-x64

# Ad-hoc sign so Gatekeeper lets the arm64 binary run (same as pkg did before).
codesign --force --sign - simon-darwin-arm64
codesign --force --sign - simon-darwin-x64

echo "Built simon ${VERSION} (arm64 + x64)."
