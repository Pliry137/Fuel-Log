const { db } = require('./_db');
const { checkAuth, notFound } = require('./_auth');
const { getValidAccessToken, WHOOP_API_BASE } = require('./_whoop');

// Map a Whoop cycle to a calendar date string (YYYY-MM-DD) using its end time
// in the cycle's reported timezone offset. If cycle is still open (no end),
// use start time.
const cycleToDate = (cycle) => {
  const isoEnd = cycle.end || cycle.start;
  const offset = cycle.timezone_offset || 'Z';
  // Whoop returns the time in UTC; convert to local using the offset
  const localISO = isoEnd.replace('Z', '') + offset;
  const d = new Date(localISO);
  // Pad date
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

module.exports = async function handler(req, res) {
  // Allow access via app token OR Vercel cron secret header
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

  const r = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${token}` },
  });

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

  // Upsert each cycle into whoop table
  const upserts = [];
  for (const cyc of cycles) {
    if (cyc.score_state !== 'SCORED' || !cyc.score) continue;
    const date = cycleToDate(cyc);
    const burned = Math.round(cyc.score.kilojoule / 4.184); // kJ → kcal
    const strain = Math.round(cyc.score.strain * 10) / 10;  // 1 decimal
    upserts.push({ date, strain, burned });
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

  return res.json({
    ok: true,
    synced: upserts.length,
    dates: upserts.map(u => u.date),
  });
};
