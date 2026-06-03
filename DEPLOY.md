# Coding Journal — Vercel Deployment Guide

Deploy the Spaced Repetition Coding Journal to Vercel with a Redis-backed data store.

---

## Overview

The app detects its storage backend automatically:

| Environment | Storage Backend |
|---|---|
| **Vercel (production)** | Upstash Redis via `KV_REST_API_URL` + `KV_REST_API_TOKEN` env vars |
| **Local dev** | `data/journal.json` file (no Vercel account or Redis needed) |

The old `@vercel/kv` package has been **replaced** with `@upstash/redis` (Vercel KV was deprecated Dec 2024; existing stores were migrated to Upstash Redis).

---

## Prerequisites

- **[Vercel CLI](https://vercel.com/docs/cli)** — `npm i -g vercel`
- A **Vercel account** (free tier works)
- A **Git repository** (GitHub, GitLab, etc.) — or you can deploy directly from the CLI
- Node.js 18+

---

## 1. Install Vercel CLI & Log In

```bash
npm i -g vercel
vercel login
```

---

## 2. Set Up Redis Storage (Vercel Marketplace)

Vercel KV is deprecated. You need a **Redis integration from the Marketplace**.

### Option A: Upstash Redis (recommended)

1. Go to **Vercel Dashboard → Storage → Browse the Marketplace**
2. Search for **Upstash Redis** and click **Create**
3. Choose a region close to your serverless function region (e.g., `iad1`)
4. Select the **Hobby** plan (free, includes daily command quota + 256 MB)
5. Link the Redis store to your Vercel project
6. Vercel will inject these environment variables automatically:
   - `KV_REST_API_URL` — the Redis REST endpoint URL
   - `KV_REST_API_TOKEN` — the auth token

### Option B: Redis Cloud or other Marketplace providers

Any Redis provider that exposes `KV_REST_API_URL` / `KV_REST_API_TOKEN` will work, as long as it supports the Upstash REST API format (the `/get`, `/set` commands).

### Existing Vercel KV stores

If you already had a Vercel KV store, Vercel automatically migrated it to **Upstash Redis** in December 2024. The same env vars (`KV_REST_API_URL`, `KV_REST_API_TOKEN`) still work with `@upstash/redis`.

---

## 3. Environment Variables

These are injected automatically when you link a Redis store via the Marketplace. You can also set them manually in **Vercel Dashboard → Project → Settings → Environment Variables**:

| Variable | Value | Scope |
|---|---|---|
| `KV_REST_API_URL` | `https://<region>.upstash.io/<hash>` | All environments |
| `KV_REST_API_TOKEN` | `<your-token>` | All environments |

> **Note:** The env var names match the old `@vercel/kv` conventions so the auto-detection in `lib/db.js` works seamlessly.

---

## 4. Configure for Vercel

### `vercel.json` (already in place)

```json
{
  "rewrites": [
    { "source": "/api/cards/:cardId/review", "destination": "/api/cards/:cardId?review=1" },
    { "source": "/api/(.*)", "destination": "/api/$1" },
    { "source": "/(.*)", "destination": "/$1" }
  ]
}
```

### `builds` configuration

No builds config needed — Vercel auto-detects Vercel Functions from the `api/` directory.

### `.gitignore`

Ensure `data/journal.json` and `node_modules` are gitignored (`.gitignore` already created).

---

## 5. Deploy

### From the CLI (first time)

```bash
# From the project root
cd coding-journal-vercel

# Link to Vercel project (creates .vercel/project.json)
vercel link

# Deploy to preview
vercel

# Promote to production
vercel --prod
```

### From Git (CI/CD)

1. Push the repository to GitHub/GitLab
2. In Vercel Dashboard → **Add New Project** → Import your repo
3. The framework preset should be **Other** (no build command needed)
4. Add the Redis storage as described in step 2
5. Deploy

---

## 6. Verify the Deployment

Check these endpoints after deployment:

```bash
# Health check — confirms DB connection
curl https://<your-project>.vercel.app/api/health

# List cards (should return empty array)
curl https://<your-project>.vercel.app/api/cards

# Stats
curl https://<your-project>.vercel.app/api/stats
```

Expected responses:

```json
// /api/health
{ "status": "ok", "cards": 0 }

// /api/cards
{ "ok": true, "cards": [] }

// /api/stats
{ "ok": true, "stats": { "total": 0, "due": 0, "mastered": 0, "streak": 0 } }
```

---

## 7. Seeding Data (Optional)

If you have existing data from a local `data/journal.json`, you can import it via the API:

```bash
curl -X POST https://<your-project>.vercel.app/api/import \
  -H "Content-Type: application/json" \
  -d @data/journal.json
```

Or export first from an existing instance:

```bash
curl https://<old-instance>/api/export > backup.json
curl -X POST https://<new-project>.vercel.app/api/import \
  -H "Content-Type: application/json" \
  -d @backup.json
```

---

## 8. Local Development

No Vercel account or Redis needed:

```bash
npm install
node dev-server.js
# API available at http://localhost:3000
```

Data persists in `data/journal.json`.

---

## Changes Made for Deployment

| File | Change |
|---|---|
| `package.json` | Replaced `@vercel/kv` with `@upstash/redis` |
| `lib/db.js` | Rewrote KV adapter to use `@upstash/redis` (same env vars, same API contract) |
| `.gitignore` | Added `node_modules/`, `data/journal.json`, `.env`, `.DS_Store` |
| `DEPLOY.md` | This file |

---

## Troubleshooting

| Symptom | Likely Cause | Fix |
|---|---|---|
| `api/health` returns `{"cards": 0}` even after adding cards | Redis store not linked — env vars missing | Check Vercel Dashboard → Project → Settings → Environment Variables |
| `Redis load error` in logs | Wrong token or URL | Verify `KV_REST_API_URL` and `KV_REST_API_TOKEN` match the Upstash dashboard |
| CORS errors in browser | Missing CORS headers | The `lib/api.js` already adds CORS headers to every response |
| Functions timeout (10s) | Cold start + slow Redis region | Choose a Redis region close to the Vercel function region |