const { clearAuthCookie } = require('./_auth');

module.exports = function handler(req, res) {
  res.setHeader('Set-Cookie', clearAuthCookie());
  return res.json({ ok: true });
};
