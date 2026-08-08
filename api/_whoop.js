const { db } = require('./_db');

const WHOOP_AUTH_URL = 'https://api.prod.whoop.com/oauth/oauth2/auth';
const WHOOP_TOKEN_URL = 'https://api.prod.whoop.com/oauth/oauth2/token';
const WHOOP_API_BASE = 'https://api.prod.whoop.com/developer';
const SCOPES = 'read:cycles read:recovery read:sleep offline';

module.exports.WHOOP_AUTH_URL = WHOOP_AUTH_URL;
module.exports.SCOPES = SCOPES;
module.exports.WHOOP_API_BASE = WHOOP_API_BASE;

// Exchange auth code for tokens, or refresh.
module.exports.exchangeToken = async (params) => {
  const body = new URLSearchParams({
    client_id: process.env.WHOOP_CLIENT_ID,
    client_secret: process.env.WHOOP_CLIENT_SECRET,
    ...params,
  });
  const r = await fetch(WHOOP_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  if (!r.ok) {
    const err = await r.text();
    throw new Error(`Whoop token exchange failed: ${r.status} ${err}`);
  }
  return r.json();
};

// Get a valid access token for the given userId (refresh if expired).
module.exports.getValidAccessToken = async (userId) => {
  const { data: auth, error } = await db
    .from('whoop_auth')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw new Error(`whoop_auth read failed: ${error.message}`);
  if (!auth) throw new Error('Whoop not connected for this user.');

  const now = Date.now();
  const expiresAt = new Date(auth.expires_at).getTime();
  if (expiresAt > now + 60_000) return auth.access_token;

  let tokens;
  try {
    tokens = await module.exports.exchangeToken({
      grant_type: 'refresh_token',
      refresh_token: auth.refresh_token,
      scope: 'offline',
    });
  } catch (e) {
    // Whoop refresh tokens are single-use (rotated on every refresh). If a
    // concurrent sync (cron + app-load + manual button) already used this one,
    // its replacement is in the DB — re-read before declaring failure.
    const { data: retry } = await db
      .from('whoop_auth').select('*').eq('user_id', userId).maybeSingle();
    if (retry && new Date(retry.expires_at).getTime() > now + 60_000 && retry.access_token !== auth.access_token) {
      return retry.access_token;
    }
    // Token is genuinely dead (rotation desync or revoked). Clear the row so
    // status reports disconnected and the CONNECT WHOOP button comes back,
    // instead of every sync failing forever.
    if (/ 40[01] /.test(` ${e.message} `) || /invalid_request|invalid_grant/.test(e.message)) {
      await db.from('whoop_auth').delete().eq('user_id', userId);
      throw new Error('Whoop connection expired — tap CONNECT WHOOP to re-link.');
    }
    throw e;
  }
  await db.from('whoop_auth').update({
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    expires_at: new Date(now + tokens.expires_in * 1000).toISOString(),
    updated_at: new Date().toISOString(),
  }).eq('user_id', userId);
  return tokens.access_token;
};
