const crypto = require('crypto');
const { db } = require('./_db');

const parseCookies = (req) => {
  const out = {};
  const raw = req.headers.cookie || '';
  raw.split(';').forEach((p) => {
    const [k, ...v] = p.trim().split('=');
    if (k) out[k] = v.join('=');
  });
  return out;
};

const COOKIE_NAME = 'fl_token';
module.exports.COOKIE_NAME = COOKIE_NAME;

const sha256Hex = (s) => crypto.createHash('sha256').update(s).digest('hex');
module.exports.sha256Hex = sha256Hex;

// Extract the raw token from cookie or X-Auth-Token header
const extractToken = (req) => {
  const cookies = parseCookies(req);
  const fromCookie = (cookies[COOKIE_NAME] || '').trim();
  if (fromCookie) return fromCookie;
  const fromHeader = ((req.headers['x-auth-token'] || '') + '').trim();
  return fromHeader;
};
module.exports.extractToken = extractToken;

// Resolve the request to a user via the token's sha256 hash. Caches on req.
// Returns user row { id, name, preferences } or null.
module.exports.getUser = async (req) => {
  if (req._user !== undefined) return req._user;
  const token = extractToken(req);
  if (!token) {
    req._user = null;
    return null;
  }
  const hash = sha256Hex(token);
  const { data, error } = await db
    .from('users')
    .select('id, name, preferences')
    .eq('token_hash', hash)
    .maybeSingle();
  if (error) {
    console.log('[AUTH] db error:', error.message);
    req._user = null;
    return null;
  }
  req._user = data || null;
  return req._user;
};

// Convenience wrapper for routes: returns user, or sends 404 and returns null.
// Also sets aggressive no-cache headers so user-scoped data never gets cached
// by the browser or Vercel's edge.
module.exports.requireUser = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');

  const user = await module.exports.getUser(req);
  if (!user) {
    res.status(404).send('Not Found');
    return null;
  }
  return user;
};

module.exports.notFound = (res) => res.status(404).send('Not Found');

// Cookie builders unchanged
module.exports.buildAuthCookie = (token) =>
  `${COOKIE_NAME}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${365 * 24 * 3600}`;

module.exports.clearAuthCookie = () =>
  `${COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;

// Admin guard: separate ADMIN_TOKEN env var (compared in constant time)
const constantEq = (a, b) => {
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
};
module.exports.constantEq = constantEq;

module.exports.requireAdmin = (req, res) => {
  const expected = (process.env.ADMIN_TOKEN || '').trim();
  const provided = ((req.headers['x-admin-token'] || req.body?.admin_token || '') + '').trim();
  if (!expected || !constantEq(provided, expected)) {
    res.status(404).send('Not Found');
    return false;
  }
  return true;
};
