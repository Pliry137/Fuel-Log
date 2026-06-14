#!/bin/bash
# Rebuild the frontend after editing src/. The launchd service serves from build/
# so it'll pick up changes on next page refresh.
set -e
cd "$(dirname "$0")"
npm run build
echo ""
echo "==> Done. Refresh your browser."
