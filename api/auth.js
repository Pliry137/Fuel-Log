// Combined auth + user management.
//   POST /api/auth?action=login   { token }
//   POST /api/auth?action=logout
//   GET  /api/auth?action=me      → current user info + preferences
//   POST /api/auth?action=preferences { ...prefs }   → merge into user's preferences
//   POST /api/auth?action=create-user (admin) { name, preferences? } → { id, name, token, login_url }
//   GET  /api/auth?action=list-users (admin) → [{id, name, created_at, preferences}]
const crypto = require('crypto');
const { db } = require('./_db');
const {
  sha256Hex,
  buildAuthCookie,
  clearAuthCookie,
  getUser,
  requireUser,
  requireAdmin,
  notFound,
} = require('./_auth');

async function login(req, res) {
  const token = (((req.body || {}).token) || '').trim();
  if (!token) return notFound(res);
  // Verify token matches a user
  const { data: user } = await db
    .from('users')
    .select('id')
    .eq('token_hash', sha256Hex(token))
    .maybeSingle();
  if (!user) return notFound(res);
  res.setHeader('Set-Cookie', buildAuthCookie(token));
  return res.json({ ok: true });
}

function logout(req, res) {
  res.setHeader('Set-Cookie', clearAuthCookie());
  return res.json({ ok: true });
}

async function me(req, res) {
  const user = await requireUser(req, res);
  if (!user) return;
  return res.json({ id: user.id, name: user.name, preferences: user.preferences || {} });
}

async function updatePreferences(req, res) {
  const user = await requireUser(req, res);
  if (!user) return;
  const incoming = req.body || {};
  // Merge (don't replace) so we can update one field at a time
  const merged = { ...(user.preferences || {}), ...incoming };
  const { error } = await db.from('users').update({ preferences: merged }).eq('id', user.id);
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ ok: true, preferences: merged });
}

async function createUser(req, res) {
  if (!requireAdmin(req, res)) return;
  const name = ((req.body || {}).name || '').trim();
  if (!name) return res.status(400).json({ error: 'name required' });

  const token = crypto.randomBytes(32).toString('hex');
  const tokenHash = sha256Hex(token);
  const preferences = (req.body || {}).preferences || {};

  const { data, error } = await db
    .from('users')
    .insert({ name, token_hash: tokenHash, preferences })
    .select('id, name')
    .single();
  if (error) return res.status(500).json({ error: error.message });

  const host = req.headers['x-forwarded-host'] || req.headers.host;
  const proto = req.headers['x-forwarded-proto'] || 'https';
  const loginUrl = `${proto}://${host}/?token=${token}`;

  return res.json({ id: data.id, name: data.name, token, login_url: loginUrl });
}

async function listUsers(req, res) {
  if (!requireAdmin(req, res)) return;
  const { data, error } = await db
    .from('users')
    .select('id, name, created_at, preferences')
    .order('created_at');
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
}

module.exports = async function handler(req, res) {
  const action = (req.query?.action || '').toLowerCase();

  if (req.method === 'POST') {
    if (action === 'login') return login(req, res);
    if (action === 'logout') return logout(req, res);
    if (action === 'preferences') return updatePreferences(req, res);
    if (action === 'create-user') return createUser(req, res);
  }
  if (req.method === 'GET') {
    if (action === 'me') return me(req, res);
    if (action === 'list-users') return listUsers(req, res);
  }
  res.setHeader('Allow', 'GET, POST');
  return res.status(405).json({ error: 'Unknown action or method' });
};
