const express = require('express');
const fs = require('fs');
const path = require('path');
const cors = require('cors');
const crypto = require('crypto');

const app = express();
const PORT = 3456;
const DATA_DIR = path.join(__dirname, 'data');

// --- TOKEN ---
// Loaded from a file outside source control so it never lands in git.
const TOKEN_FILE = path.join(__dirname, '.auth-token');
let API_TOKEN;
try {
  API_TOKEN = fs.readFileSync(TOKEN_FILE, 'utf8').trim();
  if (!API_TOKEN || API_TOKEN.length < 32) throw new Error('token too short');
} catch (e) {
  console.error(`FATAL: missing or invalid ${TOKEN_FILE}`);
  console.error('Create it with: node -e "console.log(require(\\"crypto\\").randomBytes(32).toString(\\"hex\\"))" > .auth-token');
  process.exit(1);
}

// Constant-time string compare to prevent timing attacks
const safeCompare = (a, b) => {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
};

// --- RATE LIMITER (per IP, on auth failures) ---
const failures = new Map(); // ip -> { count, firstFailAt, lockedUntil }
const WINDOW_MS = 60_000;
const MAX_FAILS = 5;
const LOCKOUT_MS = 5 * 60_000;

const noteFailure = (ip) => {
  const now = Date.now();
  const f = failures.get(ip) || { count: 0, firstFailAt: now, lockedUntil: 0 };
  if (now - f.firstFailAt > WINDOW_MS) { f.count = 0; f.firstFailAt = now; }
  f.count += 1;
  if (f.count >= MAX_FAILS) f.lockedUntil = now + LOCKOUT_MS;
  failures.set(ip, f);
};
const isLocked = (ip) => {
  const f = failures.get(ip);
  return f && f.lockedUntil > Date.now();
};
const clearFailures = (ip) => failures.delete(ip);

// --- MIDDLEWARE ---
app.use(cors());
app.use(express.json());

// Auth for /api/*. Anything wrong → 404 (cloaks the API's existence).
app.use('/api', (req, res, next) => {
  const ip = req.ip || req.connection?.remoteAddress || 'unknown';
  if (isLocked(ip)) {
    console.log(`[AUTH] ${new Date().toISOString()} ip=${ip} LOCKED (returning 404)`);
    return res.status(404).send('Not Found');
  }
  const provided = (req.get('X-Auth-Token') || '').trim();
  if (!safeCompare(provided, API_TOKEN)) {
    noteFailure(ip);
    const f = failures.get(ip);
    // Show first/last 20 chars + diff position for debugging
    let diffPos = -1, providedDiff = '', expectedDiff = '';
    for (let i = 0; i < Math.max(provided.length, API_TOKEN.length); i++) {
      if (provided[i] !== API_TOKEN[i]) {
        diffPos = i;
        providedDiff = provided.charCodeAt(i)?.toString(16) || 'NaN';
        expectedDiff = API_TOKEN.charCodeAt(i)?.toString(16) || 'NaN';
        break;
      }
    }
    console.log(`[AUTH] ${new Date().toISOString()} ip=${ip} path=${req.path} len=${provided.length}(expected ${API_TOKEN.length}) head=${provided.slice(0,20)} tail=${provided.slice(-20)} diff_at=${diffPos} got_hex=${providedDiff} expected_hex=${expectedDiff} fails=${f?.count || 0}`);
    return res.status(404).send('Not Found');
  }
  clearFailures(ip);
  next();
});

// Static React app — unauthenticated (just an empty shell to anyone without a token)
app.use(express.static(path.join(__dirname, 'build')));

// Helpers
const readJSON = (file) => JSON.parse(fs.readFileSync(path.join(DATA_DIR, file), 'utf8'));
const writeJSON = (file, data) => fs.writeFileSync(path.join(DATA_DIR, file), JSON.stringify(data, null, 2));

// --- ENTRIES ---
app.get('/api/entries', (req, res) => {
  res.json(readJSON('entries.json'));
});

app.post('/api/entries', (req, res) => {
  const entries = readJSON('entries.json');
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const defaults = {
    date: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`,
    time: `${pad(now.getHours())}:${pad(now.getMinutes())}`,
  };
  const input = req.body;
  const wasArray = Array.isArray(input);
  const items = wasArray ? input : [input];
  const baseId = Date.now();
  const added = items.map((item, i) => ({ ...defaults, ...item, id: baseId + i }));
  added.forEach(e => entries.push(e));
  writeJSON('entries.json', entries);
  res.json(wasArray ? added : added[0]);
});

// --- AI macro extraction ---
const ANTHROPIC_KEY_FILE = path.join(__dirname, '.anthropic-key');
let ANTHROPIC_KEY = null;
try {
  ANTHROPIC_KEY = fs.readFileSync(ANTHROPIC_KEY_FILE, 'utf8').trim();
  if (ANTHROPIC_KEY) console.log(`Anthropic key loaded (${ANTHROPIC_KEY.length} chars)`);
} catch (e) {
  console.log('No .anthropic-key file — AI extraction disabled');
}
// Increase JSON body limit for inline images
app.use(express.json({ limit: '10mb' }));

app.post('/api/extract-macros', async (req, res) => {
  if (!ANTHROPIC_KEY) return res.status(503).json({ error: 'AI extraction not configured. Create .anthropic-key file with your API key.' });
  const { text, image } = req.body || {};
  if (!text && !image) return res.status(400).json({ error: 'Provide text or image' });

  const userContent = [];
  if (image) {
    // image expected as data URL: "data:image/jpeg;base64,..."
    const match = /^data:(image\/[a-z]+);base64,(.+)$/i.exec(image);
    if (!match) return res.status(400).json({ error: 'Image must be a base64 data URL' });
    userContent.push({ type: 'image', source: { type: 'base64', media_type: match[1], data: match[2] } });
  }
  const userHint = text ? ` User note: ${text}` : '';
  if (image) {
    userContent.push({ type: 'text', text: `Look at this image. It's either (a) a nutrition label, (b) a packaged food, or (c) a meal on a plate. Identify which and return the macros.${userHint}` });
  } else {
    userContent.push({ type: 'text', text: `Identify this food and estimate macros for a standard serving.${userHint}` });
  }

  const systemPrompt = `You extract nutrition data from food descriptions, labels, or photos. Respond ONLY with valid JSON (no markdown, no code fence, no explanation) in this exact shape:
{"name":"short lowercase name (≤30 chars)","calories":<int>,"protein":<int>,"carbs":<int>,"fat":<int>}

Handling rules:
- Nutrition label photo: read the values for ONE serving as listed.
- Packaged food photo (front of package): identify the product and use standard label values for one serving.
- Meal/plate photo: identify each visible component, estimate portion size from visual cues (plate size, utensils, hand if visible), sum macros for the whole plate. Name should describe the meal as a whole (e.g. "chipotle bowl", "breakfast plate eggs + toast").
- Text description: estimate from standard serving sizes; scale if portion is specified.

Always round to integers. If portion is genuinely ambiguous, estimate conservatively and proceed — do not error out. Only return {"error":"<short reason>"} if you can't see/understand the food at all.`;

  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5',
        max_tokens: 300,
        system: systemPrompt,
        messages: [{ role: 'user', content: userContent }],
      }),
    });
    if (!r.ok) {
      const err = await r.text();
      console.error('Anthropic API error:', r.status, err);
      return res.status(502).json({ error: `Anthropic API ${r.status}` });
    }
    const data = await r.json();
    const textOut = (data.content || []).find(b => b.type === 'text')?.text || '';
    const cleaned = textOut.replace(/```json|```/g, '').trim();
    try {
      const parsed = JSON.parse(cleaned);
      res.json(parsed);
    } catch (e) {
      console.error('JSON parse failed:', cleaned);
      res.status(502).json({ error: 'AI returned non-JSON', raw: cleaned });
    }
  } catch (e) {
    console.error('Extract error:', e.message);
    res.status(502).json({ error: e.message });
  }
});

app.put('/api/entries/:id', (req, res) => {
  let entries = readJSON('entries.json');
  entries = entries.map(e => e.id === parseInt(req.params.id) ? { ...e, ...req.body } : e);
  writeJSON('entries.json', entries);
  res.json({ ok: true });
});

app.delete('/api/entries/:id', (req, res) => {
  let entries = readJSON('entries.json');
  entries = entries.filter(e => e.id !== parseInt(req.params.id));
  writeJSON('entries.json', entries);
  res.json({ ok: true });
});

// --- FAVORITES ---
app.get('/api/favorites', (req, res) => {
  res.json(readJSON('favorites.json'));
});

app.post('/api/favorites', (req, res) => {
  const favs = readJSON('favorites.json');
  const incoming = { name: (req.body.name || '').trim(), calories: parseInt(req.body.calories) || 0, protein: parseInt(req.body.protein) || 0, carbs: parseInt(req.body.carbs) || 0, fat: parseInt(req.body.fat) || 0 };
  if (!incoming.name) return res.status(400).json({ error: 'name required' });
  // Dedupe by case-insensitive name
  if (favs.find(f => f.name.toLowerCase() === incoming.name.toLowerCase())) {
    return res.json({ ok: true, duplicate: true });
  }
  const fav = { ...incoming, id: Date.now() };
  favs.push(fav);
  writeJSON('favorites.json', favs);
  res.json(fav);
});

app.delete('/api/favorites/:id', (req, res) => {
  let favs = readJSON('favorites.json');
  favs = favs.filter(f => f.id !== parseInt(req.params.id));
  writeJSON('favorites.json', favs);
  res.json({ ok: true });
});

// --- WHOOP ---
app.get('/api/whoop', (req, res) => {
  res.json(readJSON('whoop.json'));
});

app.post('/api/whoop/:date', (req, res) => {
  const whoop = readJSON('whoop.json');
  whoop[req.params.date] = { ...whoop[req.params.date], ...req.body };
  writeJSON('whoop.json', whoop);
  res.json({ ok: true });
});

// --- TARGETS ---
app.get('/api/targets', (req, res) => {
  res.json(readJSON('targets.json'));
});

app.post('/api/targets', (req, res) => {
  writeJSON('targets.json', req.body);
  res.json({ ok: true });
});

// Catch-all for React router
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'build', 'index.html'));
});

app.set('trust proxy', 'loopback'); // honor X-Forwarded-For from Tailscale Serve/Funnel

app.listen(PORT, '127.0.0.1', () => {
  console.log(`Fuel Log running at http://localhost:${PORT}`);
  console.log(`Token loaded from .auth-token (${API_TOKEN.length} chars)`);
});
