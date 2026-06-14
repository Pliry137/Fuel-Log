// Combined login + logout. Actions are picked by the `action` query param
// because Vercel Hobby has a 12-function cap.
//   POST /api/auth?action=login   { token }
//   POST /api/auth?action=logout
const { constantEq, buildAuthCookie, clearAuthCookie } = require('./_auth');

module.exports = function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).end();
  }
  const action = req.query?.action || 'login';

  if (action === 'logout') {
    res.setHeader('Set-Cookie', clearAuthCookie());
    return res.json({ ok: true });
  }

  // login
  const expected = (process.env.API_TOKEN || '').trim();
  const provided = (((req.body || {}).token) || '').trim();
  if (!expected || !provided || !constantEq(provided, expected)) {
    return res.status(404).send('Not Found');
  }
  res.setHeader('Set-Cookie', buildAuthCookie(provided));
  return res.json({ ok: true });
};
