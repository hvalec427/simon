#!/usr/bin/env bash
# Cut a nightly prerelease from develop. Uses a timestamp as the prerelease
# identifier (e.g. 2.15.0-nightly.20261006120000) so releases sort correctly
# both numerically and lexicographically — and avoids semantic-release's
# git-notes push, which GitHub intermittently rejects.
set -euo pipefail

REPO="hvalec427/simon"

# Base = next minor above the latest stable, so nightlies sort ahead of stable.
LATEST=$(curl -fsSL "https://api.github.com/repos/$REPO/releases/latest" \
  | grep '"tag_name"' | head -1 | cut -d'"' -f4 | sed 's/^v//')
MAJOR=$(echo "$LATEST" | cut -d. -f1)
MINOR=$(echo "$LATEST" | cut -d. -f2)
BASE="${MAJOR}.$((MINOR + 1)).0"

TS=$(date -u +%Y%m%d%H%M%S)
VERSION="${BASE}-nightly.${TS}"
TAG="v${VERSION}"

echo "Building nightly ${TAG} (latest stable: ${LATEST})"

# Inline the version into the binary (bundle.mjs reads package.json).
npm version "${VERSION}" --no-git-tag-version --allow-same-version >/dev/null
npm run bundle
npx pkg bundle.cjs --target node22-macos-arm64 --output simon-darwin-arm64
npx pkg bundle.cjs --target node22-macos-x64 --output simon-darwin-x64

gh release create "${TAG}" \
  --prerelease \
  --title "${TAG}" \
  --notes "Automated nightly build from develop." \
  simon-darwin-arm64 simon-darwin-x64
