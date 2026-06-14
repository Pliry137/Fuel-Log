const { db } = require('./_db');
const { exchangeToken } = require('./_whoop');

module.exports = async function handler(req, res) {
  const { code, state, error: oauthError } = req.query;
  if (oauthError) return res.status(400).send(`Whoop authorization failed: ${oauthError}`);
  if (!code || !state) return res.status(400).send('Missing code or state from Whoop callback');

  // Verify state matches cookie
  const cookies = (req.headers.cookie || '').split(';').reduce((acc, c) => {
    const [k, v] = c.trim().split('=');
    if (k) acc[k] = v;
    return acc;
  }, {});
  if (cookies.whoop_oauth_state !== state) {
    return res.status(400).send('State mismatch — possible CSRF. Try connecting again.');
  }

  // State is "{userId}:{random}" — extract the user_id
  const userId = state.split(':')[0];
  if (!userId || userId.length < 8) return res.status(400).send('Invalid state format');

  const host = req.headers['x-forwarded-host'] || req.headers.host;
  const proto = req.headers['x-forwarded-proto'] || 'https';
  const redirectUri = `${proto}://${host}/api/whoop-callback`;

  let tokens;
  try {
    tokens = await exchangeToken({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
    });
  } catch (e) {
    console.error('Token exchange error:', e.message);
    return res.status(502).send(`Token exchange failed: ${e.message}`);
  }

  if (!tokens.refresh_token) {
    return res.status(500).send('No refresh_token returned. Did you include `offline` scope?');
  }

  await db.from('whoop_auth').upsert({
    user_id: userId,
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    expires_at: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
    updated_at: new Date().toISOString(),
  }, { onConflict: 'user_id' });

  // Also flip the user's has_whoop preference on
  const { data: user } = await db.from('users').select('preferences').eq('id', userId).maybeSingle();
  if (user) {
    const newPrefs = { ...(user.preferences || {}), has_whoop: true, burn_method: 'whoop' };
    await db.from('users').update({ preferences: newPrefs }).eq('id', userId);
  }

  res.setHeader('Set-Cookie', 'whoop_oauth_state=; Path=/; Max-Age=0');
  res.setHeader('Location', '/?whoop=connected');
  return res.status(302).end();
};
