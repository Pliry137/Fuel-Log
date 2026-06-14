const { requireUser } = require('../_auth');
const { db } = require('../_db');

module.exports = async function handler(req, res) {
  const user = await requireUser(req, res);
  if (!user) return;
  const id = parseInt(req.query.id);
  if (!id) return res.status(400).json({ error: 'Bad id' });

  if (req.method === 'PUT') {
    const updates = { ...req.body };
    delete updates.id;
    delete updates.user_id;  // never let users move entries between accounts
    const { error } = await db.from('entries').update(updates).eq('id', id).eq('user_id', user.id);
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ ok: true });
  }

  if (req.method === 'DELETE') {
    const { error } = await db.from('entries').delete().eq('id', id).eq('user_id', user.id);
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ ok: true });
  }

  res.setHeader('Allow', 'PUT, DELETE');
  return res.status(405).end();
};
