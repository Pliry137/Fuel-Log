// Apple Health ingest. Underscore prefix = helper, NOT a Vercel function, so
// it adds nothing to the 12-function limit. Reached via body.js dispatch:
//   GET  /api/body?kind=health        -> { 'YYYY-MM-DD': {active_kcal, resting_kcal, burned, steps, resting_hr} }
//   POST /api/body?kind=health        -> upsert { date, active_kcal?, resting_kcal?, steps?, resting_hr? }
// Date comes from the Shortcut (phone-local), never server time (Vercel runs UTC).
const { requireUser, resolveReadUser } = require('./_auth');
const { db } = require('./_db');

const num = (v, lo, hi) => {
  if (v == null || v === '') return null;
  const n = Math.round(parseFloat(v));
  return isFinite(n) && n >= lo && n <= hi ? n : NaN;
};
// Same-day totals only rise, so a lower reading (stale run, locked phone) must
// never overwrite a higher one. Makes the ingest idempotent and backfill-safe.
const mx = (a, b) => (a == null ? b : b == null ? a : Math.max(a, b));

module.exports = async function health(req, res) {
  const user = await requireUser(req, res);
  if (!user) return;

  if (req.method === 'GET') {
    const target = await resolveReadUser(req, user);
    if (!target) return res.status(403).json({ error: 'Not authorized to view this user' });
    const { data, error } = await db.from('apple_health')
      .select('date, active_kcal, resting_kcal, burned, steps, resting_hr')
      .eq('user_id', target.id);
    if (error) return res.status(500).json({ error: error.message });
    const out = {};
    for (const { date, ...rest } of data) out[date] = rest;
    return res.json(out);
  }

  if (req.method === 'POST') {
    const b = req.body || {};
    if (!/^\d{4}-\d{2}-\d{2}$/.test(b.date || '')) {
      return res.status(400).json({ error: 'date (YYYY-MM-DD) required' });
    }
    const inc = {
      active_kcal: num(b.active_kcal, 0, 10000),
      resting_kcal: num(b.resting_kcal, 0, 10000),
      steps: num(b.steps, 0, 100000),
      resting_hr: num(b.resting_hr, 20, 220),
    };
    if (Object.values(inc).some(Number.isNaN)) {
      return res.status(400).json({ error: 'A field is out of range or not a number' });
    }
    // Locked phone returns zeros/blanks from HealthKit. Skip, don't overwrite.
    if (!(inc.active_kcal > 0) && !(inc.resting_kcal > 0)) {
      return res.json({ ok: true, skipped: 'no energy data in payload' });
    }

    const { data: prev } = await db.from('apple_health')
      .select('active_kcal, resting_kcal, steps, resting_hr')
      .eq('user_id', user.id).eq('date', b.date).maybeSingle();
    const active = mx(prev?.active_kcal ?? null, inc.active_kcal);
    const resting = mx(prev?.resting_kcal ?? null, inc.resting_kcal);
    const row = {
      user_id: user.id,
      date: b.date,
      active_kcal: active,
      resting_kcal: resting,
      burned: active != null && resting != null ? active + resting : null,
      steps: mx(prev?.steps ?? null, inc.steps),
      resting_hr: inc.resting_hr ?? prev?.resting_hr ?? null,
      updated_at: new Date().toISOString(),
    };
    const { data, error } = await db.from('apple_health')
      .upsert(row, { onConflict: 'user_id,date' })
      .select('date, active_kcal, resting_kcal, burned, steps, resting_hr');
    if (error) return res.status(500).json({ error: error.message });
    return res.json(data[0]);
  }

  res.setHeader('Allow', 'GET, POST');
  return res.status(405).end();
};
