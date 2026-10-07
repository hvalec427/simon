#!/usr/bin/env bash
# Build a "dev" build from the current develop commit and publish it to the
# `dev-dist` branch — NOT a GitHub release. The binaries are served to
# `simon update --dev` over raw.githubusercontent. No release, no tag, no
# changelog; the branch is replaced (single parentless commit) each push so
# nothing accumulates.
set -euo pipefail

REPO="hvalec427/simon"

# Base = next minor above the latest stable (same scheme as nightly).
LATEST=$(curl -fsSL -H "Authorization: Bearer ${GH_TOKEN}" -H "Accept: application/vnd.github+json" \
  "https://api.github.com/repos/$REPO/releases/latest" \
  | grep '"tag_name"' | head -1 | cut -d'"' -f4 | sed 's/^v//')
MAJOR=$(echo "$LATEST" | cut -d. -f1)
MINOR=$(echo "$LATEST" | cut -d. -f2)
BASE="${MAJOR}.$((MINOR + 1)).0"

TS=$(date -u +%Y%m%d%H%M%S)
VERSION="${BASE}-dev.${TS}"

echo "Building dev ${VERSION} ($(git rev-parse --short HEAD))"

# Inline the version into the binary (bundle.mjs reads package.json).
npm version "${VERSION}" --no-git-tag-version --allow-same-version >/dev/null
npm run bundle
npx pkg bundle.cjs --target node22-macos-arm64 --output simon-darwin-arm64
npx pkg bundle.cjs --target node22-macos-x64 --output simon-darwin-x64

# Publish to dev-dist via git plumbing: a single parentless commit holding just
# the two binaries and a VERSION file, force-pushed. No merge into history, so
# old build blobs become unreferenced and get GC'd.
printf '%s\n' "${VERSION}" > VERSION
# A fresh (non-existent) index path — git must create it; an empty file is
# rejected as "index file smaller than expected".
GIT_INDEX_FILE="$(mktemp -u)"
export GIT_INDEX_FILE
BLOB_ARM=$(git hash-object -w simon-darwin-arm64)
BLOB_X64=$(git hash-object -w simon-darwin-x64)
BLOB_VER=$(git hash-object -w VERSION)
git update-index --add --cacheinfo 100755,"${BLOB_ARM}",simon-darwin-arm64
git update-index --add --cacheinfo 100755,"${BLOB_X64}",simon-darwin-x64
git update-index --add --cacheinfo 100644,"${BLOB_VER}",VERSION
TREE=$(git write-tree)
COMMIT=$(git commit-tree "${TREE}" -m "dev build ${VERSION}")
unset GIT_INDEX_FILE
git push -f origin "${COMMIT}:refs/heads/dev-dist"

echo "Published dev ${VERSION} to the dev-dist branch."
