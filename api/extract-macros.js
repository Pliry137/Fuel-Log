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
{"name":"short lowercase name (≤30 chars)","calories":<int>,"protein":<int>,"carbs":<int>,"fat":<int>}

Handling rules:
- Nutrition label photo: read the values for ONE serving as listed.
- Packaged food photo (front of package): identify the product and use standard label values for one serving.
- Meal/plate photo: identify each visible component, estimate portion size from visual cues, sum macros for the whole plate. Name should describe the meal as a whole.
- Text description: estimate from standard serving sizes; scale if portion is specified.

Always round to integers. If portion is genuinely ambiguous, estimate conservatively and proceed. Only return {"error":"<short reason>"} if you truly can't identify the food.`;

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

module.exports = handler;
// Vercel default body size cap is 4.5 MB. Bump for inline images.
module.exports.config = { api: { bodyParser: { sizeLimit: '10mb' } } };

