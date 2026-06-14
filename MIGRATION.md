# Fuel Log — Migration to Vercel + Supabase

Goal: move off the Mac Mini entirely. Zero data loss. Same UX.

## What's already done

I built and committed (in your `~/fuel-log` folder):

- `migration/01-schema.sql` — table definitions for Supabase
- `migration/02-seed.sql` — every entry, whoop day, target, and favorite from your JSON files, with original IDs preserved (122 entries, 18 whoop, 1 target, 2 favorites)
- `api/` directory — 8 Vercel serverless functions replacing `server.js`:
  - `entries.js` (GET, POST) + `entries/[id].js` (PUT, DELETE)
  - `whoop.js` (GET) + `whoop/[date].js` (POST)
  - `targets.js` (GET, POST)
  - `favorites.js` (GET, POST) + `favorites/[id].js` (DELETE)
  - `extract-macros.js` (POST — Anthropic call)
- `api/_auth.js`, `api/_db.js` — shared helpers (token check, Supabase client)
- `package.json` — added `@supabase/supabase-js` dep
- `.vercelignore` — keeps secrets and Mac-only files out of deploys
- Frontend polling reduced from 10s → 30s to stay under Vercel free tier

The original `server.js` and JSON data files are **untouched** — your Mac Mini setup keeps working until you flip the switch.

## What you need to do

### Step 1 — Install the new dep locally

```bash
cd ~/fuel-log && npm install
```

### Step 2 — Supabase setup

Either use your existing project (add the tables) or create a new project at supabase.com.

1. Open the **SQL Editor** in your Supabase dashboard.
2. Paste the contents of `~/fuel-log/migration/01-schema.sql` → **Run**. Confirms 4 tables created.
3. Paste the contents of `~/fuel-log/migration/02-seed.sql` → **Run**. Should report 143 rows inserted.
4. Run this quick verification:
   ```sql
   select 'entries' tbl, count(*) from entries
   union all select 'whoop', count(*) from whoop
   union all select 'targets', count(*) from targets
   union all select 'favorites', count(*) from favorites;
   ```
   Expect: 122 / 18 / 1 / 2.

5. Grab the two secrets from **Project Settings → API**:
   - **Project URL** → use as `SUPABASE_URL`
   - **service_role** key (not anon!) → use as `SUPABASE_SERVICE_KEY`

### Step 3 — Vercel setup

```bash
cd ~/fuel-log
npx vercel login
npx vercel link        # create a new project, link this folder
```

Set the four env vars (use the same values for Preview and Production):

```bash
npx vercel env add API_TOKEN              # paste your existing token from ~/fuel-log/.auth-token
npx vercel env add ANTHROPIC_API_KEY      # paste from ~/fuel-log/.anthropic-key (if AI is enabled)
npx vercel env add SUPABASE_URL           # paste Project URL from step 2.5
npx vercel env add SUPABASE_SERVICE_KEY   # paste service_role key from step 2.5
```

### Step 4 — Deploy

```bash
npx vercel --prod
```

Vercel will run `npm install` + `npm run build`, deploy the static frontend, and stand up your 8 serverless functions. The CLI prints your production URL (e.g. `fuel-log-jmneal.vercel.app`).

### Step 5 — Smoke test (before tearing anything down)

Open `https://<your-vercel-url>` in a private browser window. You'll see the token entry screen. Paste your token. Verify:

- [ ] Dashboard loads with all 122 entries
- [ ] Date picker shows past dates with correct data
- [ ] Trends tab cumulative card and chart render
- [ ] Favorites chips appear when you tap + ADD MANUALLY
- [ ] AI lookup works (type a food + tap AI button)
- [ ] Photo upload works
- [ ] Logging a new entry via Shortcut still works (or via the dashboard)

If anything fails, the old Mac Mini setup is still running at `http://localhost:3456` — nothing is gone.

### Step 6 — Update the iOS Shortcut

Edit your "Log to Fuel Log" Shortcut:

1. Open the **Get Contents of URL** action
2. Change URL from `https://joes-mac-mini.tail4df224.ts.net/api/entries` to `https://<your-vercel-url>/api/entries`
3. Token stays the same

### Step 7 — Update PWA icons / bookmarks

On your iPhone and any other device, delete the old home-screen icon and re-add from the new Vercel URL. Token will need to be re-entered once per device.

### Step 8 — Decommission the Mac Mini setup (only after smoke test passes)

```bash
# Stop the launchd service
launchctl unload ~/Library/LaunchAgents/com.fuellog.plist
rm ~/Library/LaunchAgents/com.fuellog.plist

# Tear down Tailscale Funnel
sudo /Applications/Tailscale.app/Contents/MacOS/Tailscale funnel --https=443 off

# (Optional) Archive the folder
mv ~/fuel-log ~/fuel-log-archived-$(date +%Y%m%d)
```

Mac Mini can now stay off, travel, get repurposed, whatever.

## Rollback plan

If something goes wrong post-cutover and you need to go back to the Mac Mini temporarily:

```bash
launchctl load ~/fuel-log-archived-*/com.fuellog.plist     # (if archived)
# OR if not archived, the plist may already be back in ~/Library/LaunchAgents
sudo /Applications/Tailscale.app/Contents/MacOS/Tailscale funnel --bg 3456
```

Old URL works again. Data didn't move — the Mac Mini's JSON files are intact and reflect the state at the moment of migration. After cutover, new data lives only in Supabase.

## What changed under the hood

| | Before | After |
|---|---|---|
| Hosting | Mac Mini + launchd | Vercel |
| Data storage | JSON files | Supabase Postgres |
| Public access | Tailscale Funnel | Vercel default `.vercel.app` HTTPS |
| Server runtime | Express (long-running) | Serverless functions (cold-start ~500ms first call after idle) |
| Auth | Token in `.auth-token`, checked in Express middleware | Token in `API_TOKEN` env var, checked per function |
| AI key | `.anthropic-key` file | `ANTHROPIC_API_KEY` env var |
| Mac Mini must be on | Yes | No |
