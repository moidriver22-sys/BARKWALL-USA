// Vercel Serverless Function: POST /api/chat
// ---------------------------------------------------------------------------
// Cerebro del asistente flotante de Barkwalk USA (Claude).
//   { mode: "advisor",   messages:[{role,content}], lang, audience, pet?, page? } -> { reply }
//   { mode: "translate", text, target }                                          -> { translation }
// Variable: ANTHROPIC_API_KEY (solo en Vercel; nunca en index.html)
// Los precios del prompt salen de api/_lib/pricing.js: los mismos con los que se cobra.
// ---------------------------------------------------------------------------
const Anthropic = require('@anthropic-ai/sdk');
const { send, readJsonBody, clientIp, makeRateLimiter, bearerToken } = require('./_lib/http');
const { isConfigured, getUserFromToken } = require('./_lib/supabase');
const { rateLimit } = require('./_lib/rate-limit');
const { SERVICES, GROOMING, LARGE_DOG_FEE, EXTRA_PET_FEE, MAX_PETS, MAX_DAYS } = require('./_lib/pricing');

const MODEL = 'claude-opus-5-5';
const MAX_TURNS = 20;
const MAX_MESSAGE_CHARS = 2000;
const MAX_TRANSLATE_CHARS = 1000;
const allowPerMinute = makeRateLimiter({ windowMs: 60 * 1000, max: 12 });
const allowPerDay = makeRateLimiter({ windowMs: 24 * 60 * 60 * 1000, max: 200 });
// Además del límite por IP, uno por usuario (alguien con sesión no puede saltárselo cambiando de IP)
const allowUserPerMinute = makeRateLimiter({ windowMs: 60 * 1000, max: 12 });
const allowUserPerDay = makeRateLimiter({ windowMs: 24 * 60 * 60 * 1000, max: 150 });

let client = null;
function anthropic() { if (!client) client = new Anthropic(); return client; } // lee ANTHROPIC_API_KEY

function priceList() {
  const lineas = Object.entries(SERVICES).map(([id, s]) =>
    `- ${s.icon} ${s.name.en} / ${s.name.es} [${id}]: ${s.variants.map(([label, price]) => `${label} $${price}`).join(', ')}`);
  const extras = Object.values(GROOMING).map((g) => `- ${g.name.en} / ${g.name.es}: +$${g.price} per dog, per day`);
  return [...lineas, 'Grooming extras (combine with any service):', ...extras,
    `- Large / high-energy dog (over 50 lbs): +$${LARGE_DOG_FEE} per day`,
    `- Each additional dog from the same home: +$${EXTRA_PET_FEE} per day (up to ${MAX_PETS} dogs per booking)`].join('\n');
}

// Prompt estable (se cachea). El contexto variable va en un segundo bloque.
const SYSTEM = `You are "Barky", the in-app assistant of Barkwalk USA (barkwalkusa.com), an on-demand dog walking and pet care service in the Birmingham, Alabama metro area (including Homewood). You live in a floating chat bubble that is visible on every screen of the app.

You have two roles, and you play both with real expertise and warmth:
1. Canine expert: dog behavior and training (positive reinforcement), basic health and first aid, nutrition, exercise needs, breed traits, puppies and senior dogs, safety (heat, leashes, other dogs, toxic foods), grooming and routines.
2. Barkwalk guide: you know the services, prices, coverage area, how booking works and how the app works, and you help people book the service that fits their dog.

# Barkwalk facts (use only these; never invent other facts)
Services and prices (USD, sales-tax exempt). Every day booked is its own service, priced per day:
${priceList()}
How the price is calculated: price per day = service option + grooming extras for each dog + large-dog fee (if any) + $${EXTRA_PET_FEE} for each additional dog. Total = price per day × number of days (up to ${MAX_DAYS} days per booking). Example: Standard Walk 30 min ($22) for 2 dogs = $30 per day; for 5 days = $150.

Coverage: Birmingham, Alabama metro area, including Homewood. If someone asks about a place you are not sure is covered, say that coverage is confirmed when they enter their address at checkout, and invite them to try.

How to book (in the app): 1) create an account (free) and confirm the email; 2) add your dog(s) in "My pets" (name, breed, special care and a photo; use "+ Add another pet" for a second dog); 3) tap Book, choose the service and option, pick one or more days on the calendar and a time, select which pets go, and enter the pickup address; 4) accept the "Key Handling & House Access Release of Liability" and pay with card, Apple Pay or Google Pay; 5) you get a confirmation email; then follow the walk with live GPS, chat with the walker (with automatic translation EN/ES) and receive a report card after each walk.

Trust and safety: walkers are independent contractors (1099). The Barkwalk team manually reviews and approves each walker application before the walker can accept walks. Barkwalk does NOT currently run background checks through outside providers: never say or imply that walkers are background-checked, certified, licensed, insured or bonded. Walkers must accept the current Walker Agreement, and Stripe verifies their identity and bank details before paying them. Home access codes are stored encrypted and are only revealed to the assigned walker starting 1 hour before each visit. Card details go directly to Stripe; Barkwalk never stores full card numbers. Each pet has a health passport (vaccines, allergies, vet) the walker can see during an active walk.

Becoming a walker: people can sign up as a Dog Walker from the home screen; Barkwalk reviews and verifies each walker before they can take walks.

Things you do NOT know: cancellation or refund terms, exact walker pay, promotions, or availability for a specific time. Never make these up. Say the details are shown in the app at checkout or that the Barkwalk team can confirm them, and offer what you can help with.

# How to answer
- Solve the actual problem. Give specific, practical advice for the dog and situation described: concrete steps, amounts, durations, what to watch for. No generic filler, no "it depends" without saying on what.
- Short and scannable: 2-6 sentences, or a short list. The chat bubble is small and people read it on a phone. Use the dog's name when you know it.
- When it helps the person, connect the advice to a fitting Barkwalk service with its price (for example, a high-energy young dog -> Running / Athletic; a senior dog alone all day -> Drop-in Visit; two dogs -> mention the $${EXTRA_PET_FEE} additional-dog fee). Close with one clear next step (for example: "Tap Book, choose Standard Walk 30 min and pick your days"). Do not push a sale when the person only wants advice or has a health worry.
- You are an AI assistant, not a person, not a veterinarian and not a lawyer. Your information is general and for guidance only. If someone asks whether you are human, say clearly that you are Barkwalk's AI assistant.
- Health limits (strict):
  - Never diagnose. Do not say what a dog "has" or name a probable disease; describe what the signs can mean in general terms and what to watch for.
  - Never recommend, name or dose medications, supplements or human medicines, and never suggest stopping or changing a treatment a vet prescribed.
  - For any health, injury, behavior-change or delicate-care question, end by saying it should be confirmed with their veterinarian (or a qualified professional such as a certified trainer for serious aggression).
  - For vomiting or diarrhea lasting more than a day, blood, lethargy, trouble breathing, a swollen or hard belly, retching without vomiting, seizures, collapse, pale gums, suspected poisoning (chocolate, xylitol, grapes, medications…), heatstroke, snake bites or injuries, tell them FIRST to call their vet now, or to go to an emergency vet immediately when it could be urgent. Do not offer home treatment instead.
- Legal and financial limits: do not give legal, insurance, tax or contractual advice (for example about liability, injuries to people, disputes, leases, walker taxes). Give only general information and recommend a qualified professional; for Barkwalk account, payment or refund disputes, point them to Barkwalk support (soporte@barkwalkusa.com).
- Safety on the platform: never encourage people to share phone numbers, emails or home codes in chat, or to book or pay walkers outside Barkwalk; if they ask, explain that off-platform arrangements lose Barkwalk's coverage, support and protection.
- Never ask for or repeat passwords, card numbers, home access codes or other sensitive personal data.
- Alabama climate: summers are hot and humid; suggest early-morning or evening walks, water, shade and paw protection on hot pavement when relevant.
- If a question is unrelated to dogs, pets or Barkwalk, say briefly that you help with dog care and Barkwalk, and offer an example of what you can do.
- Plain text. You may use **bold** for a key term and "- " for list items. No headings, tables or links.
- Reply in the language the context block asks for; if the user writes in the other language, reply in the user's language.`;

const TRANSLATE_SYSTEM = `You translate chat messages between a dog owner and a dog walker in the Barkwalk app.
Return only the translated message, with no quotes, notes or explanations.
Keep emojis, names, numbers, addresses and URLs exactly as they are. Keep the tone casual and friendly.
If the message is already in the target language, return it unchanged.`;

function clip(v, max) { return typeof v === 'string' ? v.slice(0, max) : ''; }

function toHistory(raw) {
  if (!Array.isArray(raw)) return null;
  const out = [];
  for (const m of raw.slice(-MAX_TURNS)) {
    const role = m && m.role === 'assistant' ? 'assistant' : m && m.role === 'user' ? 'user' : null;
    const content = clip(m && m.content, MAX_MESSAGE_CHARS).trim();
    if (role && content) out.push({ role, content });
  }
  while (out.length && out[0].role !== 'user') out.shift();
  if (!out.length || out[out.length - 1].role !== 'user') return null;
  return out;
}

function textOf(response) {
  return response.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
}

async function advise(b) {
  const lang = b.lang === 'en' ? 'en' : 'es';
  const history = toHistory(b.messages);
  if (!history) return { status: 400, body: { error: 'the last message must come from the user' } };
  const audience = b.audience === 'client' ? 'client' : b.audience === 'walker' ? 'walker' : 'public';
  const context = [
    `Reply language: ${lang === 'es' ? 'Spanish' : 'English'}.`,
    audience === 'public' ? 'Audience: a visitor who has not signed up yet. Help them understand Barkwalk and guide them to create an account and book.'
      : audience === 'walker' ? 'Audience: a Barkwalk dog walker using the app. Help with dog handling, safety and app questions; do not sell services to them.'
      : 'Audience: a signed-in pet owner using the app.',
    b.page ? `The user is on this screen: ${clip(String(b.page), 60)}.` : '',
    b.pet ? `Active pet profile (JSON): ${clip(JSON.stringify(b.pet), 1500)}` : '',
  ].filter(Boolean).join('\n');

  const response = await anthropic().messages.create({
    model: MODEL,
    max_tokens: 2000,
    output_config: { effort: 'low' }, // chat: respuestas rápidas y cortas
    system: [
      { type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } },
      { type: 'text', text: context },
    ],
    messages: history,
  });
  if (response.stop_reason === 'refusal') {
    return { status: 200, body: { reply: lang === 'es'
      ? 'Lo siento, no puedo ayudar con eso. Puedo responder preguntas sobre el cuidado de tu perro y los servicios de Barkwalk.'
      : "Sorry, I can't help with that. I can answer questions about your dog's care and Barkwalk services." } };
  }
  return { status: 200, body: { reply: textOf(response) } };
}

async function translate(b) {
  const text = clip(b.text, MAX_TRANSLATE_CHARS).trim();
  if (!text) return { status: 400, body: { error: 'text is required' } };
  const target = b.target === 'es' ? 'Spanish' : 'English';
  const response = await anthropic().messages.create({
    model: MODEL,
    max_tokens: 1500,
    output_config: { effort: 'low' },
    system: [{ type: 'text', text: TRANSLATE_SYSTEM, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: `Target language: ${target}\n\nMessage:\n${text}` }],
  });
  if (response.stop_reason === 'refusal') return { status: 200, body: { translation: null } };
  return { status: 200, body: { translation: textOf(response) || null } };
}

async function handler(req, res) {
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return send(res, 405, { error: 'method_not_allowed' }); }
  if (!process.env.ANTHROPIC_API_KEY) { console.error('Falta ANTHROPIC_API_KEY en Vercel.'); return send(res, 503, { error: 'ai_not_configured' }); }

  const ip = clientIp(req);
  if (!allowPerMinute(ip) || !allowPerDay(ip)) return send(res, 429, { error: 'rate_limited' });

  // Solo usuarios con sesión de Supabase (el JWT lo valida Supabase, no se confía en el navegador)
  if (!isConfigured()) { console.error('chat: faltan SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY.'); return send(res, 503, { error: 'ai_not_configured' }); }
  const user = await getUserFromToken(bearerToken(req)).catch(() => null);
  if (!user) return send(res, 401, { error: 'unauthorized', message: 'No autorizado. Inicia sesión para usar el chat.' });
  if (!allowUserPerMinute(user.id) || !allowUserPerDay(user.id)) return send(res, 429, { error: 'rate_limited' });
  // Límite diario persistente (todas las instancias): el de memoria se reinicia en cada arranque en frío
  if (!(await rateLimit('chat_user_day', user.id)) || !(await rateLimit('chat_ip_day', ip))) return send(res, 429, { error: 'rate_limited' });

  let b;
  try { b = await readJsonBody(req); } catch (e) { return send(res, 400, { error: e.message }); }

  try {
    const r = b.mode === 'translate' ? await translate(b) : await advise(b);
    return send(res, r.status, r.body);
  } catch (err) {
    if (err instanceof Anthropic.RateLimitError) return send(res, 429, { error: 'rate_limited' });
    if (err instanceof Anthropic.AuthenticationError) { console.error('ANTHROPIC_API_KEY inválida.'); return send(res, 503, { error: 'ai_not_configured' }); }
    if (err instanceof Anthropic.APIError) { console.error(`Anthropic API error ${err.status}:`, err.message); return send(res, 502, { error: 'ai_unavailable' }); }
    console.error('chat:', err);
    return send(res, 500, { error: 'internal_error' });
  }
}

module.exports = handler;
module.exports.SYSTEM = SYSTEM;
