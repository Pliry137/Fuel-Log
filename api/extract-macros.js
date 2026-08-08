const { requireUser } = require('./_auth');
const { db } = require('./_db');

const RATE_LIMIT_PER_MIN = 30; // max AI calls per IP per minute

// Pull the JSON object out of a model reply that may have preamble/postamble.
// Sonnet narrates more than haiku; requiring the WHOLE reply to be JSON caused
// "AI returned non-JSON" failures even when valid JSON was present.
const extractJson = (s) => {
  const a = s.indexOf('{');
  const b = s.lastIndexOf('}');
  return a >= 0 && b > a ? s.slice(a, b + 1) : s;
};

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
  // Feedback capture: what the AI guessed vs what the user actually saved.
  // No Anthropic call and no rate-limit charge — handled before both.
  if ((req.body || {}).action === 'feedback') return handleFeedback(req, res, user);
  if ((req.body || {}).action === 'feedback-list') return handleFeedbackList(req, res, user);

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
      ? `Look at this image. It's either (a) a nutrition label, (b) a packaged food, or (c) a meal on a plate. If a Nutrition Facts panel is legible ANYWHERE in the image, you MUST transcribe its printed values exactly — calories, protein, total carbs, total fat, serving size — digit by digit. Do NOT estimate macros from what kind of food it looks like when a label is readable; the label always wins. Before answering, re-read each number off the label and confirm your JSON matches it. Only estimate if no label is legible.${userHint}`
      : `Identify this food and estimate macros for a standard serving.${userHint}`,
  });

  const systemPrompt = `You extract nutrition data from food descriptions, labels, or photos. Respond ONLY with valid JSON (no markdown, no code fence, no explanation) in this exact shape:
{"name":"short lowercase name (≤30 chars)","calories":<int>,"protein":<int>,"carbs":<int>,"fat":<int>,"unit":"<unit>","base_amount":<number>}

The macros (calories/protein/carbs/fat) you return MUST be the values for exactly base_amount of unit.

LABEL TRANSCRIPTION RULE (highest priority): if the image contains a legible Nutrition Facts panel, copy its printed values verbatim — do not substitute typical values for that food category. A "protein bar" whose label says 12g protein and 18g fat gets 12 and 18, not the numbers a typical protein bar would have. Use the label's serving size as unit/base_amount. If the product/brand name is visible on the packaging, use it in "name" instead of a generic category.

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
        // Images need real vision accuracy (label transcription) — use sonnet.
        // Plain-text lookups ("6 oz salmon") are easy — haiku is fine and cheaper.
        model: image ? 'claude-sonnet-4-5' : 'claude-haiku-4-5',
        max_tokens: 600,
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
    const cleaned = extractJson(textOut.replace(/```json|```/g, '').trim());
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

// ---- AI feedback loop: log AI guess vs what the user saved ----
// Corrections are ground truth about extraction failures. Mine them
// periodically and bake recurring failure patterns into the prompts above.
async function handleFeedback(req, res, user) {
  const { source, input_hint, corrected, ai_result, final_result } = req.body || {};
  if (!ai_result || !final_result || !['photo', 'text'].includes(source)) {
    return res.status(400).json({ error: 'Need source (photo|text), ai_result, final_result' });
  }
  const { error } = await db.from('ai_feedback').insert({
    user_id: user.id,
    source,
    input_hint: (input_hint || '').slice(0, 200) || null,
    corrected: !!corrected,
    ai_result,
    final_result,
  });
  // Table may not exist until the migration runs — degrade silently, this is
  // telemetry, not a feature the user should see fail.
  if (error) return res.json({ ok: false, error: error.message });
  return res.json({ ok: true });
}

async function handleFeedbackList(req, res, user) {
  const { data, error } = await db.from('ai_feedback')
    .select('*').eq('user_id', user.id)
    .order('created_at', { ascending: false }).limit(100);
  if (error) return res.status(500).json({ error: error.message });
  const rows = data || [];
  const corrections = rows.filter(r => r.corrected);
  return res.json({
    total: rows.length,
    corrected: corrections.length,
    accuracy_pct: rows.length ? Math.round(100 * (rows.length - corrections.length) / rows.length) : null,
    rows,
  });
}

// ---- AI Coach: turns a digest of recent logs into concrete adjustments ----
async function handleCoach(req, res) {
  const { digest } = req.body || {};
  if (!digest || typeof digest !== 'object') {
    return res.status(400).json({ error: 'Provide digest object' });
  }

  const systemPrompt = `You are an evidence-based nutrition coach reviewing a client's actual food log data. Your job is INSIGHT the client doesn't already have — not commands, not food morality. The digest contains: macro averages vs targets (7d/28d), deficit stats, their most-logged foods with macro contributions, weight trend, recovery data, the client's standing notes (client_notes), and your own previous suggestions (previous_suggestions).

COACHING CONTRACT (violating any of these makes the output worthless):
- Never tell the client to stop eating a food they clearly eat regularly and deliberately. Treats in a log are budgeted, not confessions. Only flag a specific food when the data shows it is actually costing them their target, and then suggest portion, timing, or a swap — with the numbers.
- Never optimize a single metric to a degenerate end. "Add more protein powder to the shake" fails this test: its logical conclusion is eating plain powder. If a meal already contains a dedicated protein source, look elsewhere — meal timing, other meals, food quality, behavior.
- Adherence beats optimality. The best recommendation is the one this person will still be doing in six months. Prefer the smallest change with the largest effect.
- TEACH the mechanism. The client should learn something from every suggestion, not just receive an order.
- Treat client_notes as hard constraints. Do not repeat anything in previous_suggestions unless the data shows it worked (then acknowledge it briefly) or circumstances materially changed.
- Never invent numbers not derivable from the digest. If the data is too thin for a claim, don't make it.

Respond ONLY with valid JSON (no markdown, no code fence) in this exact shape:
{"suggestions":[{"category":"macros"|"foods"|"general","priority":1|2|3,"observation":"<what the data shows, with numbers>","why":"<the mechanism — why this matters physiologically or behaviorally>","try":"<one concrete, testable experiment>"}]}

2 to 4 suggestions. Priority 1 = highest-leverage. Each field ≤ 200 chars. Fewer, sharper suggestions beat padding.`;

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
        max_tokens: 1600,
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
    const cleaned = extractJson(textOut.replace(/```json|```/g, '').trim());
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

