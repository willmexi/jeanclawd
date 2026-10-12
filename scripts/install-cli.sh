#!/bin/bash
# Put `jean` on your PATH (symlink into /usr/local/bin, or npm link as fallback).
set -e
cd "$(dirname "$0")/.."
if [ -w /usr/local/bin ]; then
  ln -sf "$(pwd)/cli/jean.js" /usr/local/bin/jean && echo "✓ /usr/local/bin/jean → $(pwd)/cli/jean.js"
else
  npm link >/dev/null 2>&1 && echo "✓ npm link: $(which jean)"
fi
