// Consolidated Whoop management: status, OAuth start, sync.
//   GET  /api/whoop-mgmt?action=status
//   GET  /api/whoop-mgmt?action=connect
//   GET  /api/whoop-mgmt?action=sync (also called by Vercel cron — iterates all users)
const { db } = require('./_db');
const { requireUser } = require('./_auth');
const { WHOOP_AUTH_URL, SCOPES, getValidAccessToken, WHOOP_API_BASE } = require('./_whoop');

// Parse an offset like "-05:00" → minutes (negative for west of UTC).
const parseOffset = (off) => {
  if (!off || off === 'Z') return 0;
  const m = /^([+-])(\d{2}):?(\d{2})$/.exec(off);
  if (!m) return 0;
  return (m[1] === '+' ? 1 : -1) * (parseInt(m[2]) * 60 + parseInt(m[3]));
};

// Use the cycle's START time in the user's LOCAL timezone (= when they woke up).
// Whoop reports start in UTC + a timezone_offset; we shift to local before taking the date.
const cycleToDate = (cycle) => {
  const utcMs = new Date(cycle.start).getTime();
  const offsetMin = parseOffset(cycle.timezone_offset);
  const local = new Date(utcMs + offsetMin * 60_000);
  return local.toISOString().slice(0, 10); // "YYYY-MM-DD"
};

async function handleStatus(req, res) {
  const user = await requireUser(req, res);
  if (!user) return;
  const { data } = await db
    .from('whoop_auth')
    .select('expires_at, last_sync_at, last_sync_status')
    .eq('user_id', user.id)
    .maybeSingle();
  if (!data) return res.json({ connected: false });
  return res.json({
    connected: true,
    expires_at: data.expires_at,
    last_sync_at: data.last_sync_at,
    last_sync_status: data.last_sync_status,
  });
}

async function handleConnect(req, res) {
  const user = await requireUser(req, res);
  if (!user) return;
  if (!process.env.WHOOP_CLIENT_ID || !process.env.WHOOP_CLIENT_SECRET) {
    return res.status(503).json({ error: 'Whoop env vars not configured' });
  }
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  const proto = req.headers['x-forwarded-proto'] || 'https';
  const redirectUri = `${proto}://${host}/api/whoop-callback`;
  // State carries the user id (signed-ish) so callback knows which user to associate
  const state = `${user.id}:${Math.random().toString(36).slice(2, 12)}${Date.now().toString(36)}`;

  const url = new URL(WHOOP_AUTH_URL);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', process.env.WHOOP_CLIENT_ID);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('scope', SCOPES);
  url.searchParams.set('state', state);

  res.setHeader('Set-Cookie', `whoop_oauth_state=${state}; Path=/; Max-Age=600; HttpOnly; Secure; SameSite=Lax`);
  return res.json({ url: url.toString() });
}

// Sync for a single user. Returns { synced, dates } or { error }.
async function syncForUser(userId, lookbackDays) {
  const end = new Date();
  const start = new Date(end.getTime() - lookbackDays * 86_400_000);

  let token;
  try {
    token = await getValidAccessToken(userId);
  } catch (e) {
    return { error: e.message };
  }

  // Paginate through all cycles in the range
  const cycles = [];
  let nextToken = null;
  let pageCount = 0;
  do {
    const url = new URL(`${WHOOP_API_BASE}/v2/cycle`);
    url.searchParams.set('start', start.toISOString());
    url.searchParams.set('end', end.toISOString());
    url.searchParams.set('limit', '25');
    if (nextToken) url.searchParams.set('nextToken', nextToken);

    const r = await fetch(url.toString(), { headers: { Authorization: `Bearer ${token}` } });
    if (!r.ok) {
      const err = await r.text();
      await db.from('whoop_auth').update({
        last_sync_at: new Date().toISOString(),
        last_sync_status: `error: ${r.status}`,
      }).eq('user_id', userId);
      return { error: `Whoop API ${r.status}: ${err}` };
    }
    const data = await r.json();
    cycles.push(...(data.records || []));
    nextToken = data.next_token || null;
    pageCount++;
  } while (nextToken && pageCount < 10); // safety cap at 250 cycles

  // Dedupe by date — Whoop can return multiple cycles per calendar day in rare
  // cases (fragmented sleep). Keep the cycle with the largest strain.
  // We INCLUDE in-progress cycles (no end time) so today's data updates as the day goes on.
  const byDate = {};
  for (const cyc of cycles) {
    if (cyc.score_state !== 'SCORED' || !cyc.score) continue;
    const date = cycleToDate(cyc);
    const row = {
      user_id: userId,
      date,
      strain: Math.round(cyc.score.strain * 10) / 10,
      burned: Math.round(cyc.score.kilojoule / 4.184),
    };
    if (!byDate[date] || row.strain > byDate[date].strain) {
      byDate[date] = row;
    }
  }
  const upserts = Object.values(byDate);
  if (upserts.length) {
    const { error } = await db.from('whoop').upsert(upserts, { onConflict: 'user_id,date' });
    if (error) {
      await db.from('whoop_auth').update({
        last_sync_at: new Date().toISOString(),
        last_sync_status: `db error: ${error.message}`,
      }).eq('user_id', userId);
      return { error: error.message };
    }
  }
  await db.from('whoop_auth').update({
    last_sync_at: new Date().toISOString(),
    last_sync_status: `ok: synced ${upserts.length} day(s)`,
  }).eq('user_id', userId);
  return { synced: upserts.length, dates: upserts.map(u => u.date) };
}

async function handleSync(req, res) {
  const isCron = req.headers['x-vercel-cron'] === '1' ||
                 (process.env.CRON_SECRET && req.headers.authorization === `Bearer ${process.env.CRON_SECRET}`);
  const lookbackDays = parseInt(req.query?.days) || 7;

  if (isCron) {
    // Sync every user that has whoop_auth
    const { data: connectedUsers } = await db.from('whoop_auth').select('user_id');
    const results = [];
    for (const row of connectedUsers || []) {
      const r = await syncForUser(row.user_id, lookbackDays);
      results.push({ user_id: row.user_id, ...r });
    }
    return res.json({ ok: true, users: results.length, results });
  }

  // Manual sync = just the logged-in user
  const user = await requireUser(req, res);
  if (!user) return;
  const r = await syncForUser(user.id, lookbackDays);
  if (r.error) return res.status(502).json(r);
  return res.json({ ok: true, ...r });
}

module.exports = async function handler(req, res) {
  const action = (req.query?.action || '').toLowerCase();
  if (action === 'status') return handleStatus(req, res);
  if (action === 'connect') return handleConnect(req, res);
  if (action === 'sync') return handleSync(req, res);
  return res.status(400).json({ error: 'Specify ?action=status|connect|sync' });
};
