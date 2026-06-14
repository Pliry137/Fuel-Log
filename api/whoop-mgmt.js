// Consolidated Whoop management: status, OAuth start, sync.
// Actions picked by ?action= query param.
//   GET  /api/whoop-mgmt?action=status   → connection state
//   GET  /api/whoop-mgmt?action=connect  → returns Whoop OAuth URL (browser navigates to it)
//   GET  /api/whoop-mgmt?action=sync     → pulls cycles (also called by Vercel cron)
const { db } = require('./_db');
const { checkAuth, notFound } = require('./_auth');
const { WHOOP_AUTH_URL, SCOPES, getValidAccessToken, WHOOP_API_BASE } = require('./_whoop');

// Map a Whoop cycle to a YYYY-MM-DD string using its end time in the cycle's
// reported timezone offset.
const cycleToDate = (cycle) => {
  const isoEnd = cycle.end || cycle.start;
  const offset = cycle.timezone_offset || 'Z';
  const localISO = isoEnd.replace('Z', '') + offset;
  const d = new Date(localISO);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

async function handleStatus(req, res) {
  if (!checkAuth(req)) return notFound(res);
  const { data } = await db.from('whoop_auth').select('expires_at, last_sync_at, last_sync_status').eq('id', 1).maybeSingle();
  if (!data) return res.json({ connected: false });
  return res.json({
    connected: true,
    expires_at: data.expires_at,
    last_sync_at: data.last_sync_at,
    last_sync_status: data.last_sync_status,
  });
}

async function handleConnect(req, res) {
  if (!checkAuth(req)) return notFound(res);
  if (!process.env.WHOOP_CLIENT_ID || !process.env.WHOOP_CLIENT_SECRET) {
    return res.status(503).json({ error: 'Whoop env vars not configured' });
  }
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  const proto = req.headers['x-forwarded-proto'] || 'https';
  const redirectUri = `${proto}://${host}/api/whoop-callback`;
  const state = Math.random().toString(36).slice(2, 12) + Date.now().toString(36);

  const url = new URL(WHOOP_AUTH_URL);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', process.env.WHOOP_CLIENT_ID);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('scope', SCOPES);
  url.searchParams.set('state', state);

  res.setHeader('Set-Cookie', `whoop_oauth_state=${state}; Path=/; Max-Age=600; HttpOnly; Secure; SameSite=Lax`);
  return res.json({ url: url.toString() });
}

async function handleSync(req, res) {
  const isCron = req.headers['x-vercel-cron'] === '1' ||
                 (process.env.CRON_SECRET && req.headers.authorization === `Bearer ${process.env.CRON_SECRET}`);
  if (!isCron && !checkAuth(req)) return notFound(res);

  const lookbackDays = parseInt(req.query?.days) || 7;
  const end = new Date();
  const start = new Date(end.getTime() - lookbackDays * 86_400_000);

  let token;
  try {
    token = await getValidAccessToken();
  } catch (e) {
    return res.status(503).json({ error: e.message });
  }

  const url = new URL(`${WHOOP_API_BASE}/v2/cycle`);
  url.searchParams.set('start', start.toISOString());
  url.searchParams.set('end', end.toISOString());
  url.searchParams.set('limit', '25');

  const r = await fetch(url.toString(), { headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok) {
    const err = await r.text();
    await db.from('whoop_auth').update({
      last_sync_at: new Date().toISOString(),
      last_sync_status: `error: ${r.status}`,
    }).eq('id', 1);
    return res.status(502).json({ error: `Whoop API ${r.status}: ${err}` });
  }

  const data = await r.json();
  const cycles = data.records || [];
  const upserts = [];
  for (const cyc of cycles) {
    if (cyc.score_state !== 'SCORED' || !cyc.score) continue;
    upserts.push({
      date: cycleToDate(cyc),
      strain: Math.round(cyc.score.strain * 10) / 10,
      burned: Math.round(cyc.score.kilojoule / 4.184),
    });
  }
  if (upserts.length) {
    const { error } = await db.from('whoop').upsert(upserts, { onConflict: 'date' });
    if (error) {
      await db.from('whoop_auth').update({
        last_sync_at: new Date().toISOString(),
        last_sync_status: `db error: ${error.message}`,
      }).eq('id', 1);
      return res.status(500).json({ error: error.message });
    }
  }
  await db.from('whoop_auth').update({
    last_sync_at: new Date().toISOString(),
    last_sync_status: `ok: synced ${upserts.length} day(s)`,
  }).eq('id', 1);
  return res.json({ ok: true, synced: upserts.length, dates: upserts.map(u => u.date) });
}

module.exports = async function handler(req, res) {
  const action = (req.query?.action || '').toLowerCase();
  if (action === 'status') return handleStatus(req, res);
  if (action === 'connect') return handleConnect(req, res);
  if (action === 'sync') return handleSync(req, res);
  return res.status(400).json({ error: 'Specify ?action=status|connect|sync' });
};
