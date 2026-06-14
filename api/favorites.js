const { checkAuth, notFound } = require('./_auth');
const { db } = require('./_db');

module.exports = async function handler(req, res) {
  if (!checkAuth(req)) return notFound(res);

  if (req.method === 'GET') {
    const { data, error } = await db.from('favorites').select('*').order('created_at');
    if (error) return res.status(500).json({ error: error.message });
    return res.json(data);
  }

  if (req.method === 'POST') {
    const name = (req.body?.name || '').trim();
    if (!name) return res.status(400).json({ error: 'name required' });

    // Case-insensitive dedupe
    const { data: existing } = await db.from('favorites').select('id').ilike('name', name).maybeSingle();
    if (existing) return res.json({ ok: true, duplicate: true });

    const fav = {
      id: Date.now(),
      name,
      calories: parseInt(req.body.calories) || 0,
      protein: parseInt(req.body.protein) || 0,
      carbs: parseInt(req.body.carbs) || 0,
      fat: parseInt(req.body.fat) || 0,
    };
    const { data, error } = await db.from('favorites').insert(fav).select().single();
    if (error) return res.status(500).json({ error: error.message });
    return res.json(data);
  }

  res.setHeader('Allow', 'GET, POST');
  return res.status(405).end();
};
