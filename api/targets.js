const { checkAuth, notFound } = require('./_auth');
const { db } = require('./_db');

module.exports = async function handler(req, res) {
  if (!checkAuth(req)) return notFound(res);

  if (req.method === 'GET') {
    const { data, error } = await db.from('targets').select('calories, protein, carbs, fat').eq('id', 1).single();
    if (error) return res.status(500).json({ error: error.message });
    return res.json(data);
  }

  if (req.method === 'POST') {
    const { calories, protein, carbs, fat } = req.body || {};
    const { error } = await db.from('targets').upsert({
      id: 1,
      calories: parseInt(calories) || 0,
      protein: parseInt(protein) || 0,
      carbs: parseInt(carbs) || 0,
      fat: parseInt(fat) || 0,
    });
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ ok: true });
  }

  res.setHeader('Allow', 'GET, POST');
  return res.status(405).end();
};
