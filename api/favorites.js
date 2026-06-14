const { requireUser } = require('./_auth');
const { db } = require('./_db');

module.exports = async function handler(req, res) {
  const user = await requireUser(req, res);
  if (!user) return;

  if (req.method === 'GET') {
    const { data, error } = await db
      .from('favorites')
      .select('id, name, calories, protein, carbs, fat')
      .eq('user_id', user.id)
      .order('created_at');
    if (error) return res.status(500).json({ error: error.message });
    return res.json(data);
  }

  if (req.method === 'POST') {
    const name = (req.body?.name || '').trim();
    if (!name) return res.status(400).json({ error: 'name required' });

    // Case-insensitive dedupe per user
    const { data: existing } = await db
      .from('favorites')
      .select('id')
      .eq('user_id', user.id)
      .ilike('name', name)
      .maybeSingle();
    if (existing) return res.json({ ok: true, duplicate: true });

    const fav = {
      id: Date.now(),
      user_id: user.id,
      name,
      calories: parseInt(req.body.calories) || 0,
      protein: parseInt(req.body.protein) || 0,
      carbs: parseInt(req.body.carbs) || 0,
      fat: parseInt(req.body.fat) || 0,
    };
    const { data, error } = await db.from('favorites').insert(fav).select('id, name, calories, protein, carbs, fat').single();
    if (error) return res.status(500).json({ error: error.message });
    return res.json(data);
  }

  res.setHeader('Allow', 'GET, POST');
  return res.status(405).end();
};
