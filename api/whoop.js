const { requireUser } = require('./_auth');
const { db } = require('./_db');

module.exports = async function handler(req, res) {
  const user = await requireUser(req, res);
  if (!user) return;

  if (req.method === 'GET') {
    const { data, error } = await db
      .from('whoop')
      .select('date, recovery, strain, sleep, burned')
      .eq('user_id', user.id);
    if (error) return res.status(500).json({ error: error.message });
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
