// Shared token check. Returns true if valid, false otherwise.
// Token comes from X-Auth-Token header; compared to API_TOKEN env var
// in constant time to prevent timing attacks.
module.exports.checkAuth = (req) => {
  const provided = ((req.headers['x-auth-token'] || '') + '').trim();
  const expected = (process.env.API_TOKEN || '').trim();
  if (!expected) {
    console.log('[AUTH] FAIL: API_TOKEN env var is empty');
    return false;
  }
  if (!provided) {
    console.log('[AUTH] FAIL: no X-Auth-Token header');
    return false;
  }
  if (provided.length !== expected.length) {
    console.log(`[AUTH] FAIL: length mismatch provided=${provided.length} expected=${expected.length} provided_head=${provided.slice(0,8)} provided_tail=${provided.slice(-4)} expected_head=${expected.slice(0,8)} expected_tail=${expected.slice(-4)}`);
    return false;
  }
  let diff = 0;
  for (let i = 0; i < provided.length; i++) {
    diff |= provided.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  if (diff !== 0) {
    console.log(`[AUTH] FAIL: content mismatch len=${provided.length} provided_head=${provided.slice(0,8)} provided_tail=${provided.slice(-4)} expected_head=${expected.slice(0,8)} expected_tail=${expected.slice(-4)}`);
  }
  return diff === 0;
};

// Standardized 404 response (same cloaking pattern as the original server).
module.exports.notFound = (res) => res.status(404).send('Not Found');
