const { requireUser } = require('./_auth');
const { db } = require('./_db');

const DEFAULTS = { calories: 2175, protein: 168, carbs: 185, fat: 68 };

module.exports = async function handler(req, res) {
  const user = await requireUser(req, res);
  if (!user) return;

  if (req.method === 'GET') {
    const { data } = await db
      .from('targets')
      .select('calories, protein, carbs, fat')
      .eq('user_id', user.id)
      .maybeSingle();
    // If user has no targets yet, return defaults (no error)
    return res.json(data || DEFAULTS);
  }

  if (req.method === 'POST') {
    const row = {
      user_id: user.id,
      calories: parseInt(req.body.calories) || 0,
      protein: parseInt(req.body.protein) || 0,
      carbs: parseInt(req.body.carbs) || 0,
      fat: parseInt(req.body.fat) || 0,
    };
    const { error } = await db.from('targets').upsert(row, { onConflict: 'user_id' });
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ ok: true });
  }

  res.setHeader('Allow', 'GET, POST');
  return res.status(405).end();
};
