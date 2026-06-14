// Supabase service-role client (server-side only).
// SERVICE_KEY bypasses RLS — never expose to the browser.
const { createClient } = require('@supabase/supabase-js');

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
  console.warn('SUPABASE_URL or SUPABASE_SERVICE_KEY missing');
}

module.exports.db = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
  { auth: { persistSession: false } }
);
