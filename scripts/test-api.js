// Tests api/chat.js with a stubbed Groq (no network, no key needed).
const assert = require('assert');
const handler = require('../api/chat.js');

function call(method, body, env = {}) {
  Object.assign(process.env, { GROQ_API_KEY: 'test-key' }, env);
  for (const k of Object.keys(env)) if (env[k] === undefined) delete process.env[k];
  return new Promise((resolve) => {
    const res = { headers: {}, setHeader(k, v) { this.headers[k] = v; return this; }, status(c) { this.code = c; return this; }, json(o) { resolve({ code: this.code, body: o }); } };
    handler({ method, body }, res);
  });
}
const stub = (fn) => { global.fetch = fn; };
const ok = (text) => new Response(JSON.stringify({ choices: [{ message: { content: text } }] }), { status: 200 });
const msgs = (n) => Array.from({ length: n }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: 'm' + i }));
const tests = [];
const t = (name, fn) => tests.push([name, fn]);

t('rejects non-POST', async () => assert.equal((await call('GET')).code, 405));
t('500 without key', async () => assert.equal((await call('POST', { messages: msgs(1) }, { GROQ_API_KEY: '' })).code, 500));
t('rejects bad body / empty / bad role / long message / last assistant', async () => {
  assert.equal((await call('POST', undefined)).code, 400);
  assert.equal((await call('POST', { messages: [] })).code, 400);
  assert.equal((await call('POST', { messages: [{ role: 'system', content: 'x' }] })).code, 400);
  assert.equal((await call('POST', { messages: [{ role: 'user', content: 'x'.repeat(2001) }] })).code, 400);
  assert.equal((await call('POST', { messages: [{ role: 'user', content: 'a' }, { role: 'assistant', content: 'b' }] })).code, 400);
});
t('success, bounded history, model env, key only in header', async () => {
  let seen;
  stub(async (url, o) => { seen = { url, o, body: JSON.parse(o.body) }; return ok('  hello  '); });
  const r = await call('POST', { messages: msgs(31) }, { GROQ_MODEL: 'my-model' });
  assert.deepEqual([r.code, r.body], [200, { reply: 'hello' }]);
  assert.equal(seen.body.model, 'my-model');
  assert.ok(seen.body.messages.length <= 13 && seen.body.messages[0].role === 'system' && seen.body.messages[1].role === 'user');
  assert.equal(seen.o.headers.Authorization, 'Bearer test-key');
  assert.ok(!seen.o.body.includes('test-key'));
});
t('default model', async () => {
  let m; stub(async (u, o) => ((m = JSON.parse(o.body).model), ok('x')));
  await call('POST', { messages: msgs(1) }, { GROQ_MODEL: undefined });
  assert.equal(m, 'llama-3.3-70b-versatile');
});
t('maps upstream errors', async () => {
  for (const [s, c] of [[429, 429], [401, 502], [400, 502], [500, 502]]) {
    stub(async () => new Response('{}', { status: s }));
    assert.equal((await call('POST', { messages: msgs(1) })).code, c, 'status ' + s);
  }
  stub(async () => new Response(JSON.stringify({ choices: [] }), { status: 200 }));
  assert.equal((await call('POST', { messages: msgs(1) })).code, 502);
  stub(async () => { throw new TypeError('network'); });
  assert.equal((await call('POST', { messages: msgs(1) })).code, 502);
});
t('timeout aborts -> 504', async () => {
  stub((u, o) => new Promise((_, rej) => o.signal.addEventListener('abort', () => rej(Object.assign(new Error('a'), { name: 'AbortError' })))));
  const real = global.setTimeout;
  global.setTimeout = (fn) => real(fn, 5); // shrink the 25s timeout
  try { assert.equal((await call('POST', { messages: msgs(1) })).code, 504); } finally { global.setTimeout = real; }
});

(async () => {
  let failed = 0;
  const origError = console.error; console.error = () => {};
  for (const [name, fn] of tests) {
    try { await fn(); console.log('ok   ', name); } catch (e) { failed++; console.log('FAIL ', name, e.message); }
  }
  console.error = origError;
  process.exit(failed ? 1 : 0);
})();
