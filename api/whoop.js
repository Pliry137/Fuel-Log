const { checkAuth, notFound } = require('./_auth');
const { db } = require('./_db');

module.exports = async function handler(req, res) {
  if (!checkAuth(req)) return notFound(res);

  if (req.method === 'GET') {
    const { data, error } = await db.from('whoop').select('*');
    if (error) return res.status(500).json({ error: error.message });
    // Return as { "YYYY-MM-DD": { recovery, strain, sleep, burned } } to match old shape
    const obj = {};
    for (const row of data) {
      const { date, ...rest } = row;
      obj[date] = rest;
    }
    return res.json(obj);
  }

  res.setHeader('Allow', 'GET');
  return res.status(405).end();
};
