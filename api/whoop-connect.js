const { checkAuth, notFound } = require('./_auth');
const { WHOOP_AUTH_URL, SCOPES } = require('./_whoop');

module.exports = function handler(req, res) {
  if (!checkAuth(req)) return notFound(res);
  if (!process.env.WHOOP_CLIENT_ID || !process.env.WHOOP_CLIENT_SECRET) {
    return res.status(503).json({ error: 'Whoop env vars not configured' });
  }

  // Build the OAuth URL and redirect the user there
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  const proto = req.headers['x-forwarded-proto'] || 'https';
  const redirectUri = `${proto}://${host}/api/whoop-callback`;

  // 8+ char random state for CSRF protection
  const state = Math.random().toString(36).slice(2, 12) + Date.now().toString(36);

  const url = new URL(WHOOP_AUTH_URL);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', process.env.WHOOP_CLIENT_ID);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('scope', SCOPES);
  url.searchParams.set('state', state);

  // Set short-lived state cookie so callback can verify
  res.setHeader('Set-Cookie', `whoop_oauth_state=${state}; Path=/; Max-Age=600; HttpOnly; Secure; SameSite=Lax`);

  // Return the URL as JSON so the frontend can do a top-level navigation
  // (we can't redirect with auth-header'd fetch).
  return res.json({ url: url.toString() });
};
