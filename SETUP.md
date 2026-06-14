# Fuel Log — Cowork Setup

## What this is
A locally-hosted food tracker with a Node.js backend.
Data lives in `data/entries.json` — no database needed, no cloud, no resets.
Access from your iPhone on the same WiFi, or anywhere via Tailscale.

## Setup (one time)

```bash
# 1. Install dependencies
npm install

# 2. Build the React frontend
npm run build

# 3. Start the server
npm run server
```

Then open: http://localhost:3456

## Access from iPhone (same WiFi)
1. On your Mac, run: `ipconfig getifaddr en0` to get your local IP
2. On iPhone, open Safari: http://<YOUR-IP>:3456
3. Tap Share → Add to Home Screen for an app-like experience

## Access from iPhone anywhere (Tailscale)
1. Install Tailscale on Mac and iPhone (free): https://tailscale.com
2. Sign in on both devices
3. Use your Mac's Tailscale IP instead of local IP

## Auto-start on Mac boot
Run this in terminal to set it up as a background service:
```bash
# Save this as ~/Library/LaunchAgents/com.fuellog.plist
# Then: launchctl load ~/Library/LaunchAgents/com.fuellog.plist
```
(Claude Code can generate the plist file for you in Cowork)

## How to log food via Claude
1. Take a photo of a nutrition label → paste in Claude chat
2. Claude reads macros and posts them to http://localhost:3456/api/entries
3. Refresh the tracker — entry appears instantly

## API endpoints
- GET  /api/entries          — all food entries
- POST /api/entries          — add entry { date, name, calories, protein, carbs, fat }
- PUT  /api/entries/:id      — update entry
- DELETE /api/entries/:id    — delete entry
- GET  /api/whoop            — all Whoop data
- POST /api/whoop/:date      — add/update Whoop data { recovery, strain, sleep, burned }
- GET  /api/targets          — calorie/macro targets
- POST /api/targets          — update targets

## Data files
- data/entries.json    — all food log entries (full history from May 26 - Jun 1)
- data/whoop.json      — Whoop daily metrics
- data/targets.json    — calorie and macro targets
