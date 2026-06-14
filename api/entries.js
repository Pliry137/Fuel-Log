const { requireUser } = require('./_auth');
const { db } = require('./_db');

module.exports = async function handler(req, res) {
  const user = await requireUser(req, res);
  if (!user) return;

  if (req.method === 'GET') {
    const { data, error } = await db
      .from('entries')
      .select('id, date, time, name, calories, protein, carbs, fat')
      .eq('user_id', user.id)
      .order('date').order('time');
    if (error) return res.status(500).json({ error: error.message });
    return res.json(data);
  }

  if (req.method === 'POST') {
    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const defaults = {
      date: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`,
      time: `${pad(now.getHours())}:${pad(now.getMinutes())}`,
    };
    const body = req.body;
    const items = Array.isArray(body) ? body : [body];
    const baseId = Date.now();
    const rows = items.map((it, i) => ({
      id: baseId + i,
      user_id: user.id,
      date: it.date || defaults.date,
      time: it.time || defaults.time,
      name: it.name || '',
      calories: parseInt(it.calories) || 0,
      protein: parseInt(it.protein) || 0,
      carbs: parseInt(it.carbs) || 0,
      fat: parseInt(it.fat) || 0,
    }));
    const { data, error } = await db.from('entries').insert(rows).select('id, date, time, name, calories, protein, carbs, fat');
    if (error) return res.status(500).json({ error: error.message });
    return res.json(Array.isArray(body) ? data : data[0]);
  }

  res.setHeader('Allow', 'GET, POST');
  return res.status(405).end();
};
