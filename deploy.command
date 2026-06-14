#!/bin/bash
# Rebuild frontend, restart the service, and enable Tailscale Funnel.
# You'll be prompted for your Mac password (for sudo on Funnel).

set -e
cd "$(dirname "$0")"

echo "==> Rebuilding frontend..."
npm run build

echo ""
echo "==> Restarting server..."
launchctl unload ~/Library/LaunchAgents/com.fuellog.plist 2>/dev/null || true
launchctl load ~/Library/LaunchAgents/com.fuellog.plist
sleep 2

echo ""
echo "==> Verifying auth..."
TOKEN=$(cat .auth-token)
if curl -s -m 3 -H "X-Auth-Token: $TOKEN" http://localhost:3456/api/targets | grep -q calories; then
  echo "    OK (token works)"
else
  echo "    FAIL — check server.err.log"
  exit 1
fi

if curl -s -m 3 http://localhost:3456/api/targets | grep -q "Not Found"; then
  echo "    OK (unauthenticated requests are 404 cloaked)"
else
  echo "    WARNING — unauthenticated requests should return 'Not Found'"
fi

echo ""
echo "==> Enabling Tailscale Funnel (sudo will prompt for your Mac password)..."
sudo /Applications/Tailscale.app/Contents/MacOS/Tailscale funnel --bg 3456

echo ""
echo "==> Funnel status:"
/Applications/Tailscale.app/Contents/MacOS/Tailscale funnel status

echo ""
echo "============================================================"
echo "DONE. Your public URL is shown above (the https://...ts.net/)"
echo ""
echo "Token (paste this in the website once per device):"
echo "$TOKEN"
echo "============================================================"
