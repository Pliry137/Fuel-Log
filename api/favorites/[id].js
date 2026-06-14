const { checkAuth, notFound } = require('../_auth');
const { db } = require('../_db');

module.exports = async function handler(req, res) {
  if (!checkAuth(req)) return notFound(res);
  const id = parseInt(req.query.id);
  if (!id) return res.status(400).json({ error: 'Bad id' });

  if (req.method === 'DELETE') {
    const { error } = await db.from('favorites').delete().eq('id', id);
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ ok: true });
  }

  res.setHeader('Allow', 'DELETE');
  return res.status(405).end();
};
