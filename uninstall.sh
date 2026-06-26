#!/bin/sh
set -e

INSTALL_DIR="/usr/local/bin"

if [ ! -f "$INSTALL_DIR/simon" ]; then
  echo "simon is not installed at $INSTALL_DIR/simon"
  exit 0
fi

sudo rm "$INSTALL_DIR/simon"
echo "simon uninstalled."
