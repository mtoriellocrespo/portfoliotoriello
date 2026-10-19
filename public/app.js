(() => {
  const MAX_CHARS = 2000;
  const MAX_HISTORY = 12; // messages sent as context
  const REQUEST_TIMEOUT_MS = 30000;

  const $ = (id) => document.getElementById(id);
  const log = $('log'), welcome = $('welcome'), form = $('composer'), input = $('composer-input');
  const sendBtn = $('send'), count = $('count');
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');

  let history = []; // {role, content}
  let busy = false;
  let controller = null;
  let lastFailed = null; // text to retry

  /* ---------- theme ---------- */
  function applyTheme(theme, save) {
    document.documentElement.dataset.theme = theme;
    const btn = $('theme-toggle');
    const light = theme === 'light';
    btn.setAttribute('aria-pressed', String(light));
    btn.setAttribute('aria-label', light ? 'Switch to dark theme' : 'Switch to light theme');
    $('theme-icon').textContent = light ? '☾' : '☀';
    document.querySelector('meta[name="theme-color"]').content = light ? '#f1f1ec' : '#17181b';
    if (save) { try { localStorage.setItem('orbit-theme', theme); } catch (e) {} }
  }
  applyTheme(document.documentElement.dataset.theme || 'dark', false);
  $('theme-toggle').addEventListener('click', () => {
    applyTheme(document.documentElement.dataset.theme === 'light' ? 'dark' : 'light', true);
  });

  /* ---------- safe, minimal rendering (no innerHTML) ---------- */
  function inline(parent, text) {
    const re = /(`[^`\n]+`|\*\*[^*\n]+\*\*)/g;
    let last = 0, m;
    while ((m = re.exec(text))) {
      if (m.index > last) parent.append(text.slice(last, m.index));
      const tok = m[0];
      const el = document.createElement(tok[0] === '`' ? 'code' : 'strong');
      el.textContent = tok[0] === '`' ? tok.slice(1, -1) : tok.slice(2, -2);
      parent.append(el);
      last = m.index + tok.length;
    }
    if (last < text.length) parent.append(text.slice(last));
  }
  function render(container, text) {
    const parts = text.split(/```[^\n]*\n?/);
    parts.forEach((part, i) => {
      if (i % 2) {
        const pre = document.createElement('pre'), code = document.createElement('code');
        code.textContent = part.replace(/\n$/, '');
        pre.append(code);
        container.append(pre);
      } else if (part.trim()) {
        part.trim().split(/\n{2,}/).forEach((para) => {
          const p = document.createElement('p');
          inline(p, para);
          container.append(p);
        });
      }
    });
  }

  /* ---------- messages ---------- */
  function scrollDown() { log.scrollTop = log.scrollHeight; }
  function addMessage(kind, text) {
    welcome.hidden = true;
    const el = document.createElement('div');
    el.className = 'msg ' + kind;
    const who = document.createElement('span');
    who.className = kind === 'error' ? 'err-label' : 'who';
    who.textContent = kind === 'user' ? 'You' : kind === 'error' ? 'Error' : 'Orbit';
    el.append(who);
    if (kind === 'bot') render(el, text);
    else { const p = document.createElement('p'); p.textContent = text; el.append(p); }
    log.append(el);
    scrollDown();
    return el;
  }
  function addTyping() {
    const el = document.createElement('div');
    el.className = 'msg bot';
    el.setAttribute('role', 'status');
    el.innerHTML = '<span class="who">Orbit</span><div class="typing" aria-hidden="true"><i></i><i></i><i></i></div><span class="sr-only">Orbit is thinking…</span>';
    log.append(el);
    scrollDown();
    return el;
  }
  function addError(text, retryText) {
    const el = addMessage('error', text);
    if (retryText) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'btn retry';
      b.textContent = 'Try again';
      b.addEventListener('click', () => { el.remove(); send(retryText, true); });
      el.append(b);
      scrollDown();
      b.focus({ preventScroll: true });
    }
  }

  /* ---------- sending ---------- */
  function setBusy(v) {
    busy = v;
    sendBtn.disabled = v || !input.value.trim();
    log.setAttribute('aria-busy', String(v));
  }

  async function send(text, isRetry) {
    text = text.trim();
    if (!text || busy) return;
    if (!isRetry) {
      addMessage('user', text);
      history.push({ role: 'user', content: text });
      input.value = '';
      autosize();
    }
    setBusy(true);
    const typing = addTyping();
    controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({ messages: history.slice(-MAX_HISTORY) }),
      });
      let data = null;
      try { data = await res.json(); } catch (e) {}
      typing.remove();
      if (!res.ok || !data || typeof data.reply !== 'string') {
        addError((data && data.error) || `Something went wrong (${res.status}). Please try again.`, text);
      } else {
        history.push({ role: 'assistant', content: data.reply });
        addMessage('bot', data.reply);
      }
    } catch (err) {
      typing.remove();
      if (err.name === 'AbortError' && !controller.signal.reasonNewChat) {
        addError('The request timed out. Please try again.', text);
      } else if (err.name !== 'AbortError') {
        addError('Could not reach the server. Check your connection and try again.', text);
      }
    } finally {
      clearTimeout(timer);
      controller = null;
      setBusy(false);
      if (!document.querySelector('.retry')) input.focus();
    }
  }

  /* ---------- composer ---------- */
  function autosize() {
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 160) + 'px';
    count.textContent = input.value.length + '/' + MAX_CHARS;
    sendBtn.disabled = busy || !input.value.trim();
  }
  input.addEventListener('input', autosize);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); form.requestSubmit(); }
  });
  form.addEventListener('submit', (e) => { e.preventDefault(); send(input.value); });
  $('chips').addEventListener('click', (e) => {
    const chip = e.target.closest('.chip');
    if (chip) send(chip.dataset.q);
  });

  $('new-chat').addEventListener('click', () => {
    if (controller) { controller.signal.reasonNewChat = true; controller.abort(); }
    history = [];
    log.querySelectorAll('.msg').forEach((m) => m.remove());
    welcome.hidden = false;
    input.value = '';
    autosize();
    log.scrollTop = 0;
    input.focus();
  });

  autosize();
})();
