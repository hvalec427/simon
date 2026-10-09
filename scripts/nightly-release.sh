#!/usr/bin/env bash
# Cut a nightly prerelease from develop. Runs once a day (scheduled at 21:00 UTC),
# tagged with the UTC date (e.g. 2.16.0-nightly.20261007) — one build per day, so
# no timestamp is needed. Avoids semantic-release's git-notes push, which GitHub
# intermittently rejects.
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

# Previous nightly = the one with the highest date suffix. Don't use
# --sort=creatordate: lightweight tags tie on date and fall back to ascending
# refname, picking the oldest nightly.
TS=$(date -u +%Y%m%d)
TAG="v${BASE}-nightly.${TS}"
# Sort on the 8-digit date prefix first: older nightlies used 14-digit
# timestamps, which would otherwise always sort above plain dates.
PREV=$(git tag -l 'v*-nightly.*' | grep -vx -e "${TAG}" | sort -t. -k4.1,4.8n -k4,4n | tail -1)
[ -z "${PREV}" ] && PREV="v${LATEST}"
RANGE="${PREV}..HEAD"

# Skip the build entirely when nothing that affects the binary changed since the
# last nightly (docs/markdown-only commits don't warrant a new build).
SINCE="${PREV}"
git rev-parse -q --verify "refs/tags/${TAG}" >/dev/null && SINCE="${TAG}"
if git rev-parse "${SINCE}" >/dev/null 2>&1; then
  CODE_CHANGES=$(git diff --name-only "${SINCE}" HEAD -- . ':(exclude)docs/**' ':(exclude)*.md' ':(exclude)LICENSE')
  if [ -z "${CODE_CHANGES}" ]; then
    echo "No code changes since ${SINCE} — skipping nightly."
    exit 0
  fi
fi

# Tag with the UTC date: the job runs at 21:00 UTC, so the UTC date is the
# day's build. (Local time would tip into the next day in summer.)
VERSION="${BASE}-nightly.${TS}"

echo "Building nightly ${TAG} (latest stable: ${LATEST}, since ${PREV})"

bash scripts/build-binaries.sh "${VERSION}"

# ── Release notes: a real changelog of everything since the previous nightly
# (falling back to the latest stable), grouped like the stable releases, plus a
# copy-paste install line for this exact build.
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

# A nightly already cut today is replaced, so the day's last build wins.
if gh release view "${TAG}" --repo "$REPO" >/dev/null 2>&1; then
  gh release delete "${TAG}" --repo "$REPO" --cleanup-tag --yes
fi

# --target the built develop commit: without it, gh tags the repo's default
# branch (master) HEAD, so PREV..HEAD would span the whole develop/master
# divergence and every nightly would re-list everything.
gh release create "${TAG}" \
  --prerelease \
  --target "$(git rev-parse HEAD)" \
  --title "${TAG}" \
  --notes-file "${NOTES}" \
  simon-darwin-arm64 simon-darwin-x64
