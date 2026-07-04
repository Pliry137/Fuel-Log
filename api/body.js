// Body log: weight / waist measurements.
//   GET    /api/body            → all rows for user, ascending by date
//   POST   /api/body            → upsert { date?, weight_lb?, waist_in? } (date defaults to today)
//   DELETE /api/body?date=YYYY-MM-DD
const { requireUser } = require('./_auth');
const { db } = require('./_db');

module.exports = async function handler(req, res) {
  const user = await requireUser(req, res);
  if (!user) return;
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'GET') {
    const { data, error } = await db
      .from('body_log')
      .select('date, weight_lb, waist_in')
      .eq('user_id', user.id)
      .order('date');
    if (error) return res.status(500).json({ error: error.message });
    return res.json(data);
  }

  if (req.method === 'POST') {
    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
    const b = req.body || {};
    const weight = b.weight_lb != null && b.weight_lb !== '' ? parseFloat(b.weight_lb) : null;
    const waist = b.waist_in != null && b.waist_in !== '' ? parseFloat(b.waist_in) : null;
    if (weight == null && waist == null) {
      return res.status(400).json({ error: 'Provide weight_lb and/or waist_in' });
    }
    if (weight != null && (!isFinite(weight) || weight < 50 || weight > 500)) {
      return res.status(400).json({ error: 'weight_lb out of range' });
    }
    if (waist != null && (!isFinite(waist) || waist < 15 || waist > 80)) {
      return res.status(400).json({ error: 'waist_in out of range' });
    }
    const date = /^\d{4}-\d{2}-\d{2}$/.test(b.date || '') ? b.date : today;

    // Merge with existing so posting weight alone doesn't wipe waist (and vice versa)
    const { data: prev } = await db.from('body_log')
      .select('weight_lb, waist_in').eq('user_id', user.id).eq('date', date).maybeSingle();
    const row = {
      user_id: user.id,
      date,
      weight_lb: weight ?? prev?.weight_lb ?? null,
      waist_in: waist ?? prev?.waist_in ?? null,
      updated_at: new Date().toISOString(),
    };
    const { data, error } = await db.from('body_log')
      .upsert(row, { onConflict: 'user_id,date' })
      .select('date, weight_lb, waist_in');
    if (error) return res.status(500).json({ error: error.message });
    return res.json(data[0]);
  }

  if (req.method === 'DELETE') {
    const date = req.query?.date;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) {
      return res.status(400).json({ error: 'Provide ?date=YYYY-MM-DD' });
    }
    const { error } = await db.from('body_log')
      .delete().eq('user_id', user.id).eq('date', date);
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ ok: true });
  }

  res.setHeader('Allow', 'GET, POST, DELETE');
  return res.status(405).end();
};
