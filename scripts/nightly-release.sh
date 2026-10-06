#!/usr/bin/env bash
# Cut a nightly prerelease from develop. Uses a timestamp as the prerelease
# identifier (e.g. 2.15.0-nightly.20261006120000) so releases sort correctly
# both numerically and lexicographically — and avoids semantic-release's
# git-notes push, which GitHub intermittently rejects.
set -euo pipefail

REPO="hvalec427/simon"

# Base = next minor above the latest stable, so nightlies sort ahead of stable.
# Authenticated: Actions runners share IPs and hit the anonymous rate limit (403).
LATEST=$(curl -fsSL -H "Authorization: Bearer ${GH_TOKEN}" -H "Accept: application/vnd.github+json" \
  "https://api.github.com/repos/$REPO/releases/latest" \
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

# ── Release notes: a real changelog of everything since the previous nightly
# (falling back to the latest stable), grouped like the stable releases, plus a
# copy-paste install line for this exact build. Nightlies only.
# Previous nightly = the one with the highest timestamp suffix (monotonic, set
# by date -u at build time). Don't use --sort=creatordate: lightweight tags tie
# on date and fall back to ascending refname, picking the oldest nightly.
PREV=$(git tag -l 'v*-nightly.*' | sort -t. -k4,4 -n | tail -1)
[ -z "${PREV}" ] && PREV="v${LATEST}"
RANGE="${PREV}..HEAD"
echo "Changelog range: ${RANGE}"

NOTES=$(mktemp)
{
  echo "Automated nightly build from \`develop\`. Changes since \`${PREV}\`:"
  echo

  emit() {
    local title="$1" pattern="$2"
    local rows
    rows=$(git log "${RANGE}" --no-merges --pretty=format:'%h%x09%s' \
      | awk -F'\t' -v pat="${pattern}" '$2 ~ ("^" pat "(\\(|!?:)") {print}')
    [ -z "${rows}" ] && return
    echo "### ${title}"
    echo
    printf '%s\n' "${rows}" | while IFS=$'\t' read -r h s; do
      clean=$(printf '%s' "${s}" | sed -E 's/^[a-z]+(\([^)]+\))?!?: //')
      scope=$(printf '%s' "${s}" | sed -nE 's/^[a-z]+\(([^)]+)\)!?:.*/\1/p')
      if [ -n "${scope}" ]; then
        echo "- **${scope}:** ${clean} (${h})"
      else
        echo "- ${clean} (${h})"
      fi
    done
    echo
  }

  emit "Features" "feat"
  emit "Bug Fixes" "fix"
  emit "Performance" "perf"

  OTHER=$(git log "${RANGE}" --no-merges --pretty=format:'%h%x09%s' \
    | awk -F'\t' '$2 !~ /^(feat|fix|perf)(\(|!?:)/ {print}')
  if [ -n "${OTHER}" ]; then
    echo "### Other"
    echo
    printf '%s\n' "${OTHER}" | while IFS=$'\t' read -r h s; do echo "- ${s} (${h})"; done
    echo
  fi

  echo "### Install this build"
  echo
  echo '```sh'
  echo "curl -fsSL https://github.com/${REPO}/releases/download/${TAG}/simon-darwin-arm64 -o simon \\"
  echo "  && chmod +x simon && sudo mv simon /usr/local/bin/simon"
  echo '```'
  echo
  echo "_Apple Silicon shown; on Intel use \`simon-darwin-x64\`. Already installed? \`simon update --nightly\`._"
} > "${NOTES}"

# --target the built develop commit: without it, gh tags the repo's default
# branch (master) HEAD, so PREV..HEAD would span the whole develop/master
# divergence and every nightly would re-list everything.
gh release create "${TAG}" \
  --prerelease \
  --target "$(git rev-parse HEAD)" \
  --title "${TAG}" \
  --notes-file "${NOTES}" \
  simon-darwin-arm64 simon-darwin-x64
