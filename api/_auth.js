// Parse `Cookie` header into an object.
const parseCookies = (req) => {
  const out = {};
  const raw = req.headers.cookie || '';
  raw.split(';').forEach((p) => {
    const [k, ...v] = p.trim().split('=');
    if (k) out[k] = v.join('=');
  });
  return out;
};

// Constant-time comparison of two strings.
const constantEq = (a, b) => {
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
};

const COOKIE_NAME = 'fl_token';
module.exports.COOKIE_NAME = COOKIE_NAME;

// Check auth via cookie OR X-Auth-Token header (Shortcut still uses header).
module.exports.checkAuth = (req) => {
  const expected = (process.env.API_TOKEN || '').trim();
  if (!expected) {
    console.log('[AUTH] FAIL: API_TOKEN env var is empty');
    return false;
  }

  // 1) Cookie
  const cookies = parseCookies(req);
  const fromCookie = (cookies[COOKIE_NAME] || '').trim();
  if (fromCookie && constantEq(fromCookie, expected)) return true;

  // 2) X-Auth-Token header (for the iOS Shortcut)
  const fromHeader = ((req.headers['x-auth-token'] || '') + '').trim();
  if (fromHeader && constantEq(fromHeader, expected)) return true;

  // Log diagnostic
  const which = fromCookie ? 'cookie' : fromHeader ? 'header' : 'none';
  console.log(`[AUTH] FAIL via=${which} cookie_len=${fromCookie.length} header_len=${fromHeader.length}`);
  return false;
};

module.exports.constantEq = constantEq;
module.exports.notFound = (res) => res.status(404).send('Not Found');

// Build a Set-Cookie header value (1 year, HttpOnly, Secure, Lax)
module.exports.buildAuthCookie = (token) =>
  `${COOKIE_NAME}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${365 * 24 * 3600}`;

module.exports.clearAuthCookie = () =>
  `${COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
