const { requireUser } = require('../_auth');
const { db } = require('../_db');

module.exports = async function handler(req, res) {
  const user = await requireUser(req, res);
  if (!user) return;
  const id = parseInt(req.query.id);
  if (!id) return res.status(400).json({ error: 'Bad id' });

  if (req.method === 'DELETE') {
    const { error } = await db.from('favorites').delete().eq('id', id).eq('user_id', user.id);
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ ok: true });
  }

  if (req.method === 'PUT') {
    const allowed = ['name', 'calories', 'protein', 'carbs', 'fat', 'unit', 'base_amount'];
    const updates = {};
    for (const k of allowed) {
      if (req.body[k] !== undefined) updates[k] = req.body[k];
    }
    // Normalize numerics
    ['calories', 'protein', 'carbs', 'fat'].forEach(k => {
      if (k in updates) updates[k] = parseInt(updates[k]) || 0;
    });
    if ('base_amount' in updates) {
      const v = parseFloat(updates.base_amount);
      updates.base_amount = (v > 0) ? v : 1;
    }
    if ('name' in updates) updates.name = String(updates.name).trim();
    if ('unit' in updates) updates.unit = String(updates.unit).trim() || 'serving';

    const { data, error } = await db
      .from('favorites')
      .update(updates)
      .eq('id', id)
      .eq('user_id', user.id)
      .select('id, name, calories, protein, carbs, fat, unit, base_amount')
      .single();
    if (error) return res.status(500).json({ error: error.message });
    return res.json(data);
  }

  res.setHeader('Allow', 'PUT, DELETE');
  return res.status(405).end();
};
