const { requireUser } = require('./_auth');
const { db } = require('./_db');

const RATE_LIMIT_PER_MIN = 30; // max AI calls per IP per minute

async function checkRateLimit(req) {
  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.headers['x-real-ip'] || 'unknown';
  const now = new Date();
  const oneMinAgo = new Date(now.getTime() - 60_000);

  const { data: existing } = await db.from('ai_rate_limits').select('*').eq('ip', ip).maybeSingle();
  if (existing && new Date(existing.window_start) > oneMinAgo) {
    if (existing.count >= RATE_LIMIT_PER_MIN) {
      return { ok: false, retryAfter: Math.ceil((new Date(existing.window_start).getTime() + 60_000 - now.getTime()) / 1000) };
    }
    await db.from('ai_rate_limits').update({ count: existing.count + 1 }).eq('ip', ip);
  } else {
    await db.from('ai_rate_limits').upsert({ ip, window_start: now.toISOString(), count: 1 });
  }
  return { ok: true };
}

async function handler(req, res) {
  const user = await requireUser(req, res);
  if (!user) return;
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).end();
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(503).json({ error: 'AI extraction not configured (missing ANTHROPIC_API_KEY)' });
  }

  // Rate limit BEFORE calling the (expensive) Anthropic API
  const rl = await checkRateLimit(req);
  if (!rl.ok) {
    res.setHeader('Retry-After', String(rl.retryAfter));
    return res.status(429).json({ error: `Rate limit: ${RATE_LIMIT_PER_MIN}/min. Wait ${rl.retryAfter}s.` });
  }

  // action=coach → AI coaching suggestions from a client-built data digest.
  // Folded into this function to stay under the Vercel Hobby 12-function cap.
  if ((req.body || {}).action === 'coach') return handleCoach(req, res);

  const { text, image } = req.body || {};
  if (!text && !image) return res.status(400).json({ error: 'Provide text or image' });

  const userContent = [];
  if (image) {
    const match = /^data:(image\/[a-z]+);base64,(.+)$/i.exec(image);
    if (!match) return res.status(400).json({ error: 'Image must be a base64 data URL' });
    userContent.push({ type: 'image', source: { type: 'base64', media_type: match[1], data: match[2] } });
  }
  const userHint = text ? ` User note: ${text}` : '';
  userContent.push({
    type: 'text',
    text: image
      ? `Look at this image. It's either (a) a nutrition label, (b) a packaged food, or (c) a meal on a plate. Identify which and return the macros.${userHint}`
      : `Identify this food and estimate macros for a standard serving.${userHint}`,
  });

  const systemPrompt = `You extract nutrition data from food descriptions, labels, or photos. Respond ONLY with valid JSON (no markdown, no code fence, no explanation) in this exact shape:
{"name":"short lowercase name (≤30 chars)","calories":<int>,"protein":<int>,"carbs":<int>,"fat":<int>,"unit":"<unit>","base_amount":<number>}

The macros (calories/protein/carbs/fat) you return MUST be the values for exactly base_amount of unit.

Unit + base_amount rules (USE AMERICAN UNITS — oz, cups, tbsp — never grams/ml):
- For prepackaged items (Quest bar, yogurt cup, can of soup, energy gel): unit="serving", base_amount=1.
- For unpackaged proteins (chicken, salmon, beef, tofu, fish): unit="oz", base_amount=4 (typical 4 oz portion).
- For cooked grains/starches (rice, pasta, oats, quinoa, mashed potatoes): unit="cup", base_amount=1.
- For bread, tortillas, pancakes: unit="slice" or "piece", base_amount=1.
- For fruits/vegetables: unit="cup", base_amount=1 for things sized that way (berries, chopped veg), OR unit="piece"/"medium" base_amount=1 for single items (apple, banana, orange).
- For dried fruits, nuts, trail mix, snacks: unit="oz", base_amount=1 (typical 1 oz handful).
- For cheese (sliced or shredded): unit="oz", base_amount=1.
- For nut butters: unit="tbsp", base_amount=2.
- For liquids (milk, juice, soup, smoothies): unit="cup", base_amount=1.
- For oils and high-density liquids (olive oil, salad dressing): unit="tbsp", base_amount=1.
- For meals on a plate or restaurant orders: unit="serving", base_amount=1 (treat the whole visible plate as one serving).
- If the user's text already specifies a quantity (e.g. "8oz salmon", "2 cups rice"), use THAT as base_amount and that as unit.
- NEVER use "g" or "ml". If a unit doesn't fit cleanly above, fall back to "serving".

Other rules:
- All numeric values are integers (round if needed). No quotes around numbers.
- If portion is genuinely ambiguous, estimate conservatively and proceed. Only return {"error":"<short reason>"} if you truly can't identify the food.`;

  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': process.env.ANTHROPIC_API_KEY,
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
      return res.json(JSON.parse(cleaned));
    } catch {
      return res.status(502).json({ error: 'AI returned non-JSON', raw: cleaned });
    }
  } catch (e) {
    console.error('Extract error:', e.message);
    return res.status(502).json({ error: e.message });
  }
}

// ---- AI Coach: turns a digest of recent logs into concrete adjustments ----
async function handleCoach(req, res) {
  const { digest } = req.body || {};
  if (!digest || typeof digest !== 'object') {
    return res.status(400).json({ error: 'Provide digest object' });
  }

  const systemPrompt = `You are a blunt, evidence-based nutrition coach reviewing a client's food log data. The digest you receive contains: daily macro averages vs targets (7-day and 28-day windows), calorie deficit stats, the actual foods they logged most (with frequency and macro contribution), weight trend, and recovery data if available.

Respond ONLY with valid JSON (no markdown, no code fence) in this exact shape:
{"suggestions":[{"category":"macros"|"foods"|"general","priority":1|2|3,"text":"<suggestion>"}]}

Rules:
- 3 to 6 suggestions total. Priority 1 = do this first, 3 = nice to have.
- At least one "foods" suggestion MUST reference specific foods from their actual log by name — which to eat more of, less of, or swap, and why (tie it to their macro gaps or calorie density).
- "macros" suggestions: concrete numeric changes (e.g. shift 20g carbs to protein), grounded in the digest numbers. Never invent numbers not derivable from the digest.
- "general" suggestions: timing, habits, logging quality — only if the data actually supports them.
- Be direct and specific. No hedging, no generic advice like "eat more vegetables" unless their log shows a real gap. Every suggestion must cite the data that motivates it.
- If the digest has too little data for a category, skip that category rather than padding.
- Each text ≤ 280 chars.`;

  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-5',
        max_tokens: 1200,
        system: systemPrompt,
        messages: [{ role: 'user', content: [{ type: 'text', text: `Client data digest:\n${JSON.stringify(digest)}` }] }],
      }),
    });
    if (!r.ok) {
      const err = await r.text();
      console.error('Anthropic API error (coach):', r.status, err);
      return res.status(502).json({ error: `Anthropic API ${r.status}` });
    }
    const data = await r.json();
    const textOut = (data.content || []).find(b => b.type === 'text')?.text || '';
    const cleaned = textOut.replace(/```json|```/g, '').trim();
    try {
      const parsed = JSON.parse(cleaned);
      if (!Array.isArray(parsed.suggestions)) throw new Error('bad shape');
      return res.json(parsed);
    } catch {
      return res.status(502).json({ error: 'AI returned non-JSON', raw: cleaned });
    }
  } catch (e) {
    console.error('Coach error:', e.message);
    return res.status(502).json({ error: e.message });
  }
}

module.exports = handler;
// Vercel default body size cap is 4.5 MB. Bump for inline images.
module.exports.config = { api: { bodyParser: { sizeLimit: '10mb' } } };

