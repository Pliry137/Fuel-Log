const { checkAuth, notFound } = require('../_auth');
const { db } = require('../_db');

module.exports = async function handler(req, res) {
  if (!checkAuth(req)) return notFound(res);
  const date = req.query.date;
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ error: 'Bad date' });

  if (req.method === 'POST') {
    const payload = { date, ...req.body };
    // Upsert (insert or merge update by date PK)
    const { error } = await db.from('whoop').upsert(payload, { onConflict: 'date' });
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ ok: true });
  }

  res.setHeader('Allow', 'POST');
  return res.status(405).end();
};
