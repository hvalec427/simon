#!/bin/sh
set -e

REPO="YOUR_GITHUB_USERNAME/simon"
INSTALL_DIR="/usr/local/bin"

# Detect architecture
ARCH=$(uname -m)
if [ "$ARCH" = "arm64" ]; then
  FILE="simon-darwin-arm64"
else
  FILE="simon-darwin-x64"
fi

# Get latest release version
VERSION=$(curl -fsSL "https://api.github.com/repos/$REPO/releases/latest" \
  | grep '"tag_name"' | head -1 | cut -d'"' -f4)

if [ -z "$VERSION" ]; then
  echo "Error: could not fetch latest release from $REPO"
  exit 1
fi

URL="https://github.com/$REPO/releases/download/$VERSION/$FILE"

echo "Installing simon $VERSION ($ARCH)..."
curl -fsSL "$URL" -o /tmp/simon
chmod +x /tmp/simon
sudo mv /tmp/simon "$INSTALL_DIR/simon"
echo "Done — simon $VERSION installed to $INSTALL_DIR/simon"
