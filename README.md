# Orbit

A general-purpose AI chatbot with a pixel-art robot, powered by Groq. Plain HTML/CSS/JS front end in `public/`, one Vercel serverless function in `api/chat.js`. No auth, database or payments.

## Run locally
```
cp .env.example .env      # then put your key in .env (never commit it)
npm run dev               # http://localhost:3000
npm run dev:mock          # fake Groq replies, no key needed (UI testing)
npm test                  # API tests with a stubbed Groq
```

## Deploy on Vercel
1. Push this folder to a GitHub repo.
2. In Vercel: **Add New → Project → Import** the repo. Framework preset: **Other**; leave build settings empty (it serves `public/` and `api/`).
3. Project **Settings → Environment Variables**: add `GROQ_API_KEY` (required) and optionally `GROQ_MODEL` (default `llama-3.3-70b-versatile`), for Production/Preview/Development.
4. Deploy (redeploy after changing variables).

## Limits (edit constants at the top of `api/chat.js`)
2000 chars per message, last 12 messages sent as context, 8000 chars total, 1024 output tokens, 25 s Groq timeout.
