// Local dev server: serves /public and routes /api/chat to the same handler Vercel runs.
// Loads .env if present. With MOCK_GROQ=1 the Groq call is faked (for UI testing without a key).
const http = require('http');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
try {
  for (const line of fs.readFileSync(path.join(root, '.env'), 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/);
    if (m && m[2] && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
} catch {}

if (process.env.MOCK_GROQ) {
  process.env.GROQ_API_KEY = process.env.GROQ_API_KEY || 'mock-key';
  const realFetch = global.fetch;
  global.fetch = async (url, opts) => {
    if (!String(url).includes('api.groq.com')) return realFetch(url, opts);
    const body = JSON.parse(opts.body);
    const last = body.messages[body.messages.length - 1].content;
    await new Promise((r) => setTimeout(r, 900));
    if (/fail/i.test(last)) return new Response('boom', { status: 500 });
    const text = `**Mock reply** (history: ${body.messages.length - 1} msgs, model: ${body.model}).\n\nYou said: ${last}\n\n\`\`\`js\nconsole.log("hi from Orbit");\n\`\`\``;
    return new Response(JSON.stringify({ choices: [{ message: { content: text } }] }), { status: 200 });
  };
}

const handler = require('../api/chat.js');
const types = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.png': 'image/png', '.svg': 'image/svg+xml' };

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/api/chat') {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      try { req.body = raw ? JSON.parse(raw) : undefined; } catch { req.body = undefined; }
      res.status = (c) => ((res.statusCode = c), res);
      res.json = (o) => (res.setHeader('Content-Type', 'application/json'), res.end(JSON.stringify(o)));
      handler(req, res);
    });
    return;
  }
  const rel = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname.slice(1));
  const file = path.join(root, 'public', path.normalize(rel));
  if (!file.startsWith(path.join(root, 'public'))) { res.statusCode = 403; return res.end(); }
  fs.readFile(file, (err, buf) => {
    if (err) { res.statusCode = 404; return res.end('Not found'); }
    res.setHeader('Content-Type', types[path.extname(file)] || 'application/octet-stream');
    res.end(buf);
  });
}).listen(process.env.PORT || 3000, () => console.log(`Orbit dev server on http://localhost:${process.env.PORT || 3000}`));
