#!/bin/bash
# Double-click to install the Fuel Log service. It will start on login
# and restart automatically if it crashes.

set -e
cd "$(dirname "$0")"

PLIST_SRC="$(pwd)/com.fuellog.plist"
PLIST_DST="$HOME/Library/LaunchAgents/com.fuellog.plist"

echo "==> Making run-server.sh executable..."
chmod +x run-server.sh

echo "==> Stopping any existing service..."
launchctl unload "$PLIST_DST" 2>/dev/null || true

echo "==> Installing plist to $PLIST_DST..."
mkdir -p "$HOME/Library/LaunchAgents"
cp "$PLIST_SRC" "$PLIST_DST"

echo "==> Loading service..."
launchctl load "$PLIST_DST"

sleep 2

echo ""
echo "==> Done. Service status:"
launchctl list | grep fuellog || echo "(not found — check server.err.log)"

echo ""
echo "Server should now be running at http://localhost:3456"
echo "Logs: server.log and server.err.log in this folder"
echo ""
echo "To stop:    launchctl unload ~/Library/LaunchAgents/com.fuellog.plist"
echo "To start:   launchctl load ~/Library/LaunchAgents/com.fuellog.plist"
echo ""
echo "You can close this window now."
