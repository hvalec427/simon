#!/bin/sh
set -e

TARGET=$(command -v simon 2>/dev/null || true)
if [ -z "$TARGET" ]; then
  echo "simon is not on your PATH."
  exit 0
fi

DIR=$(dirname "$TARGET")
if [ -w "$DIR" ]; then
  rm "$TARGET"
else
  sudo rm "$TARGET"
fi
echo "simon uninstalled from $TARGET"

# A second copy may still be on PATH — flag it so uninstall is actually complete.
NEXT=$(command -v simon 2>/dev/null || true)
if [ -n "$NEXT" ]; then
  echo "Note: another copy remains at $NEXT — run this again to remove it."
fi
