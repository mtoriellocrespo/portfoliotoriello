// Vercel serverless function: POST /api/chat
// Keeps GROQ_API_KEY on the server and forwards a bounded chat history to Groq.

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const DEFAULT_MODEL = 'llama-3.3-70b-versatile';

const MAX_MESSAGES = 12; // bounded history sent upstream
const MAX_MESSAGE_CHARS = 2000; // per-message input limit
const MAX_TOTAL_CHARS = 8000; // whole-history input limit
const MAX_OUTPUT_TOKENS = 1024;
const TIMEOUT_MS = 25000;

const SYSTEM_PROMPT =
  'You are Orbit, a friendly, general-purpose AI assistant. ' +
  'Answer questions on any topic, explain concepts, write and edit content, brainstorm, and handle follow-up questions. ' +
  'Use the earlier messages in the conversation for context. Be clear and concise, and ask a short clarifying question when a request is ambiguous.';

function send(res, status, body) {
  res.status(status).setHeader('Cache-Control', 'no-store').json(body);
}

function parseBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') {
    try { return JSON.parse(req.body); } catch { return null; }
  }
  return null;
}

// Returns a cleaned message list, or a string describing what is wrong.
function cleanMessages(input) {
  if (!Array.isArray(input) || input.length === 0) return 'Send a non-empty "messages" array.';

  const msgs = [];
  for (const m of input.slice(-MAX_MESSAGES)) {
    if (!m || (m.role !== 'user' && m.role !== 'assistant') || typeof m.content !== 'string') {
      return 'Each message needs a role of "user" or "assistant" and a string content.';
    }
    const content = m.content.trim();
    if (!content) continue;
    if (content.length > MAX_MESSAGE_CHARS) {
      return `Messages are limited to ${MAX_MESSAGE_CHARS} characters.`;
    }
    msgs.push({ role: m.role, content });
  }

  // History must start with a user turn and end with one.
  while (msgs.length && msgs[0].role !== 'user') msgs.shift();
  if (!msgs.length || msgs[msgs.length - 1].role !== 'user') return 'The last message must be from the user.';

  // Trim oldest turns if the total is too large.
  let total = msgs.reduce((n, m) => n + m.content.length, 0);
  while (total > MAX_TOTAL_CHARS && msgs.length > 1) total -= msgs.shift().content.length;
  while (msgs.length && msgs[0].role !== 'user') msgs.shift();

  return msgs;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return send(res, 405, { error: 'Method not allowed.' });
  }

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) return send(res, 500, { error: 'The server is missing GROQ_API_KEY.' });

  const body = parseBody(req);
  if (!body) return send(res, 400, { error: 'Request body must be JSON.' });

  const messages = cleanMessages(body.messages);
  if (typeof messages === 'string') return send(res, 400, { error: messages });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const upstream = await fetch(GROQ_URL, {
      method: 'POST',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: process.env.GROQ_MODEL || DEFAULT_MODEL,
        messages: [{ role: 'system', content: SYSTEM_PROMPT }, ...messages],
        temperature: 0.7,
        max_tokens: MAX_OUTPUT_TOKENS,
      }),
    });

    if (!upstream.ok) {
      console.error('Groq error', upstream.status, (await upstream.text()).slice(0, 500));
      if (upstream.status === 429) return send(res, 429, { error: 'Orbit is getting too many requests. Try again in a moment.' });
      if (upstream.status === 401 || upstream.status === 403) return send(res, 502, { error: 'The server could not authenticate with Groq. Check GROQ_API_KEY.' });
      if (upstream.status === 404 || upstream.status === 400) return send(res, 502, { error: 'Groq rejected the request. Check that GROQ_MODEL is a valid model.' });
      return send(res, 502, { error: 'Groq had a problem answering. Please try again.' });
    }

    const data = await upstream.json();
    const reply = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
    if (typeof reply !== 'string' || !reply.trim()) return send(res, 502, { error: 'Groq returned an empty response.' });

    return send(res, 200, { reply: reply.trim() });
  } catch (err) {
    if (err && err.name === 'AbortError') return send(res, 504, { error: 'Groq took too long to respond. Please try again.' });
    console.error('Chat request failed', err && err.message);
    return send(res, 502, { error: 'Could not reach Groq. Please try again.' });
  } finally {
    clearTimeout(timer);
  }
};

module.exports.config = { maxDuration: 30 };
