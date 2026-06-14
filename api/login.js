const { constantEq, buildAuthCookie } = require('./_auth');

module.exports = function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).end();
  }
  const expected = (process.env.API_TOKEN || '').trim();
  const provided = (((req.body || {}).token) || '').trim();
  if (!expected || !provided || !constantEq(provided, expected)) {
    // Mirror the cloaking behavior of the rest of the API
    return res.status(404).send('Not Found');
  }
  res.setHeader('Set-Cookie', buildAuthCookie(provided));
  return res.json({ ok: true });
};
