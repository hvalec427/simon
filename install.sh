#!/bin/sh
set -e

REPO="hvalec427/simon"

# Detect architecture
ARCH=$(uname -m)
if [ "$ARCH" = "arm64" ]; then
  FILE="simon-darwin-arm64"
else
  FILE="simon-darwin-x64"
fi

# Use pinned version if provided, otherwise fetch latest
if [ -n "$1" ]; then
  VERSION="$1"
else
  VERSION=$(curl -fsSL "https://api.github.com/repos/$REPO/releases/latest" \
    | grep '"tag_name"' | head -1 | cut -d'"' -f4)
fi

if [ -z "$VERSION" ]; then
  echo "Error: could not fetch latest release from $REPO"
  exit 1
fi

# Install over the simon already on PATH if there is one, so we never leave a
# stale copy shadowing the new version; otherwise default to /usr/local/bin.
EXISTING=$(command -v simon 2>/dev/null || true)
if [ -n "$EXISTING" ]; then
  INSTALL_PATH="$EXISTING"
else
  INSTALL_PATH="/usr/local/bin/simon"
fi
INSTALL_DIR=$(dirname "$INSTALL_PATH")

URL="https://github.com/$REPO/releases/download/$VERSION/$FILE"

echo "Installing simon $VERSION ($ARCH) to $INSTALL_PATH..."
curl -fsSL "$URL" -o /tmp/simon
chmod +x /tmp/simon

# Only use sudo when the target directory isn't writable.
if [ -w "$INSTALL_DIR" ]; then
  mv /tmp/simon "$INSTALL_PATH"
else
  sudo mv /tmp/simon "$INSTALL_PATH"
fi

echo "Done — simon $VERSION installed to $INSTALL_PATH"

# Warn if some other simon earlier in PATH would still win.
RESOLVED=$(command -v simon 2>/dev/null || true)
if [ -n "$RESOLVED" ] && [ "$RESOLVED" != "$INSTALL_PATH" ]; then
  echo "Warning: 'simon' still resolves to $RESOLVED, which shadows the new install."
  echo "Remove that copy or fix your PATH, then run: hash -r"
fi
