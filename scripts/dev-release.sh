#!/usr/bin/env bash
# Build a "dev" build from the current develop commit and publish it to a single
# rolling prerelease tagged `dev` (binaries overwritten each push). One release
# entry — never one per commit — and no changelog; just the bleeding edge for
# `simon update --dev`. The version lives in the release title.
set -euo pipefail

REPO="hvalec427/simon"

# Base = the version the next stable release will get.
BASE=$(bash scripts/next-version.sh)

TS=$(date -u +%Y%m%d%H%M%S)
VERSION="${BASE}-dev.${TS}"

echo "Building dev ${VERSION} ($(git rev-parse --short HEAD))"

bash scripts/build-binaries.sh "${VERSION}"

NOTES="Rolling dev build — the latest \`develop\` commit, rebuilt on every push. No changelog; see the nightly or stable releases for notes. The build timestamp in the title lets \`simon update --dev\` tell builds apart."

# One release tagged `dev`: update its title + clobber its assets if it exists,
# otherwise create it. The tag stays put so the download URL is stable.
if gh release view dev >/dev/null 2>&1; then
  gh release edit dev --title "${VERSION}" --prerelease --notes "${NOTES}"
  gh release upload dev simon-darwin-arm64 simon-darwin-x64 --clobber
else
  gh release create dev \
    --prerelease \
    --target "$(git rev-parse HEAD)" \
    --title "${VERSION}" \
    --notes "${NOTES}" \
    simon-darwin-arm64 simon-darwin-x64
fi

echo "Published dev ${VERSION} to the rolling 'dev' release."
