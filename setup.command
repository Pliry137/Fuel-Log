#!/bin/bash
# Double-click this file to set up and run Fuel Log.
# macOS will open it in Terminal automatically.

set -e
cd "$(dirname "$0")"

echo "==> Cleaning partial node_modules (if any)..."
rm -rf node_modules package-lock.json || true

echo "==> Installing dependencies (this takes a few minutes)..."
npm install

echo "==> Building React frontend..."
npm run build

echo ""
echo "==> Starting server on http://localhost:3456"
LOCAL_IP=$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || echo "")
if [ -n "$LOCAL_IP" ]; then
  echo "==> iPhone (same WiFi): http://$LOCAL_IP:3456"
fi
echo ""
npm run server
