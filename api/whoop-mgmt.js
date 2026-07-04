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

// Map a Whoop cycle to a single calendar date using the cycle's MIDPOINT
// in local time. Cycles often straddle midnight (e.g. start 23:30 → end 23:00 next day),
// so the midpoint correctly attributes them to the day they actually represent.
// For in-progress cycles (no end), use "now" as the end.
const cycleToDate = (cycle) => {
  const startMs = new Date(cycle.start).getTime();
  const endMs = cycle.end ? new Date(cycle.end).getTime() : Date.now();
  const midUtcMs = (startMs + endMs) / 2;
  const offsetMin = parseOffset(cycle.timezone_offset);
  const localMid = new Date(midUtcMs + offsetMin * 60_000);
  return localMid.toISOString().slice(0, 10);
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

// Paginate through a Whoop collection endpoint for a time range.
// Returns records array, or throws on HTTP error (unless tolerate403 and the
// server says 401/403 — then returns [] so a missing scope degrades gracefully).
async function fetchCollection(path, token, start, end, tolerate403 = false) {
  const records = [];
  let nextToken = null;
  let pageCount = 0;
  do {
    const url = new URL(`${WHOOP_API_BASE}${path}`);
    url.searchParams.set('start', start.toISOString());
    url.searchParams.set('end', end.toISOString());
    url.searchParams.set('limit', '25');
    if (nextToken) url.searchParams.set('nextToken', nextToken);

    const r = await fetch(url.toString(), { headers: { Authorization: `Bearer ${token}` } });
    if (!r.ok) {
      if (tolerate403 && (r.status === 401 || r.status === 403)) return records;
      const err = await r.text();
      const e = new Error(`Whoop API ${r.status}: ${err}`);
      e.status = r.status;
      throw e;
    }
    const data = await r.json();
    records.push(...(data.records || []));
    nextToken = data.next_token || null;
    pageCount++;
  } while (nextToken && pageCount < 10); // safety cap at 250 records
  return records;
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

  let cycles, recoveries, sleeps;
  try {
    // Recovery: linked to cycles via cycle_id. Sleep needs read:sleep — older
    // tokens won't have it, so tolerate 401/403 there and just skip sleep.
    [cycles, recoveries, sleeps] = await Promise.all([
      fetchCollection('/v2/cycle', token, start, end),
      fetchCollection('/v2/recovery', token, start, end, true),
      fetchCollection('/v2/activity/sleep', token, start, end, true),
    ]);
  } catch (e) {
    await db.from('whoop_auth').update({
      last_sync_at: new Date().toISOString(),
      last_sync_status: `error: ${e.status || e.message}`,
    }).eq('user_id', userId);
    return { error: e.message };
  }

  // recovery by cycle_id; sleep hours by sleep id (recovery links them)
  const recoveryByCycle = {};
  for (const rec of recoveries) {
    if (rec.score_state !== 'SCORED' || !rec.score) continue;
    recoveryByCycle[rec.cycle_id] = rec;
  }
  const sleepHoursById = {};
  for (const s of sleeps) {
    if (s.nap || s.score_state !== 'SCORED' || !s.score?.stage_summary) continue;
    const ss = s.score.stage_summary;
    const asleepMs = (ss.total_light_sleep_time_milli || 0) +
                     (ss.total_slow_wave_sleep_time_milli || 0) +
                     (ss.total_rem_sleep_time_milli || 0);
    sleepHoursById[s.id] = Math.round((asleepMs / 3_600_000) * 10) / 10;
  }

  // Dedupe by date — Whoop can return multiple cycles per calendar day in rare
  // cases (fragmented sleep). Keep the cycle with the largest strain.
  // We INCLUDE in-progress cycles (no end time) so today's data updates as the day goes on.
  const byDate = {};
  for (const cyc of cycles) {
    if (cyc.score_state !== 'SCORED' || !cyc.score) continue;
    const date = cycleToDate(cyc);
    const rec = recoveryByCycle[cyc.id];
    const row = {
      user_id: userId,
      date,
      strain: Math.round(cyc.score.strain * 10) / 10,
      burned: Math.round(cyc.score.kilojoule / 4.184),
      recovery: rec?.score && !rec.score.user_calibrating ? rec.score.recovery_score : null,
      sleep: rec?.sleep_id != null ? (sleepHoursById[rec.sleep_id] ?? null) : null,
    };
    // If two cycles map to the same date, keep the one with the most data
    // (highest kilojoule ≈ most-complete cycle).
    if (!byDate[date] || row.burned > byDate[date].burned) {
      byDate[date] = row;
    }
  }
  let upserts = Object.values(byDate);
  // Never clobber existing non-null recovery/sleep (e.g. manual entries) with
  // nulls from a sync that couldn't fetch them.
  if (upserts.length) {
    const { data: existing } = await db.from('whoop')
      .select('date, recovery, sleep')
      .eq('user_id', userId)
      .in('date', upserts.map(u => u.date));
    const prev = Object.fromEntries((existing || []).map(r => [r.date, r]));
    upserts = upserts.map(u => ({
      ...u,
      recovery: u.recovery ?? prev[u.date]?.recovery ?? null,
      sleep: u.sleep ?? prev[u.date]?.sleep ?? null,
    }));
  }
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

// Debug: return raw cycle JSON from Whoop for the requested range,
// PLUS what cycleToDate maps each to, so we can see what Whoop actually sent.
async function handleDebug(req, res) {
  const { requireUser } = require('./_auth');
  const user = await requireUser(req, res);
  if (!user) return;
  const days = parseInt(req.query?.days) || 3;
  const end = new Date();
  const start = new Date(end.getTime() - days * 86_400_000);
  let token;
  try { token = await getValidAccessToken(user.id); }
  catch (e) { return res.status(503).json({ error: e.message }); }

  const cycles = [];
  let nextToken = null;
  let pages = 0;
  do {
    const url = new URL(`${WHOOP_API_BASE}/v2/cycle`);
    url.searchParams.set('start', start.toISOString());
    url.searchParams.set('end', end.toISOString());
    url.searchParams.set('limit', '25');
    if (nextToken) url.searchParams.set('nextToken', nextToken);
    const r = await fetch(url.toString(), { headers: { Authorization: `Bearer ${token}` } });
    if (!r.ok) return res.status(502).json({ error: await r.text() });
    const data = await r.json();
    cycles.push(...(data.records || []));
    nextToken = data.next_token || null;
    pages++;
  } while (nextToken && pages < 10);

  // Annotate each cycle with our interpretation
  const annotated = cycles.map(c => ({
    id: c.id,
    start: c.start,
    end: c.end || null,
    timezone_offset: c.timezone_offset,
    score_state: c.score_state,
    mapped_local_date: c.start ? cycleToDate(c) : null,
    strain: c.score?.strain,
    kilojoule: c.score?.kilojoule,
    kcal_from_kj: c.score?.kilojoule ? Math.round(c.score.kilojoule / 4.184) : null,
    avg_hr: c.score?.average_heart_rate,
  }));
  return res.json({ count: annotated.length, cycles: annotated });
}

module.exports = async function handler(req, res) {
  const action = (req.query?.action || '').toLowerCase();
  if (action === 'status') return handleStatus(req, res);
  if (action === 'connect') return handleConnect(req, res);
  if (action === 'sync') return handleSync(req, res);
  if (action === 'debug') return handleDebug(req, res);
  return res.status(400).json({ error: 'Specify ?action=status|connect|sync|debug' });
};
