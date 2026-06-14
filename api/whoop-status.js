const { db } = require('./_db');
const { checkAuth, notFound } = require('./_auth');

module.exports = async function handler(req, res) {
  if (!checkAuth(req)) return notFound(res);
  const { data } = await db.from('whoop_auth').select('expires_at, last_sync_at, last_sync_status').eq('id', 1).maybeSingle();
  if (!data) return res.json({ connected: false });
  return res.json({
    connected: true,
    expires_at: data.expires_at,
    last_sync_at: data.last_sync_at,
    last_sync_status: data.last_sync_status,
  });
};
