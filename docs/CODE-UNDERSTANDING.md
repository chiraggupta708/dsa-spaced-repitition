# Code Understanding — dsa-spaced-repetition (Coding Journal)

> Review-only doc. No code changed. Branch: `dev`. Date: 2026-07-11.
> Repo: `~/dsa-spaced-repetition`. Vercel-deployed (prod = `main`, dev deploy = `dev`).

## 1. What this app is
A spaced-repetition **coding journal** for tracking DSA problems. You log a problem
(question, your thinking, the right approach, code, notes, LeetCode link) and the app
schedules reviews via the **SM-2 algorithm** (the Anki/SuperMemo spacing algorithm).
Frontend is vanilla HTML/JS (+ LeetCode URL auto-fetch). Backend is a REST API on Vercel
(serverless functions) backed by **Neon Postgres**.

## 2. Architecture (two server modes — important)
There are **TWO parallel server implementations**:

### A. `server.js` — the OLD monolith (JSON file store)
- Zero-dependency Node `http` server. Reads/writes `data/journal.json`.
- Contains its OWN copy of `sm2Calc`, `load`, `save`, `countStreak`, etc.
- `npm start` runs THIS. README says "Run the dev server (JSON-file store)".
- NOT used on Vercel (Vercel uses serverless functions, not `server.js`).

### B. Vercel serverless functions (`api/*.js`) — the LIVE prod path
- Each route is a separate file exporting a `handler(req, res)` (Vercel convention).
- These use `lib/db.js` (Neon Postgres), NOT the JSON file.
- `dev-server.js` is a **local Express shim** that mounts the same `api/*.js`
  handlers so you can develop locally against the live code path.

**Key takeaway:** `server.js` and `api/*.js` are divergent copies. `api/*.js` is the
real backend; `server.js` is legacy/dead for production.

## 3. Data layer (`lib/db.js`)
- Neon serverless driver (`@neondatabase/serverless`), HTTP mode (no WebSocket/pooling).
- `load()` → `SELECT c.*, json_agg(tags) ... LEFT JOIN cards_tags, tags ... GROUP BY c.id`.
- `save(data)` → **DESTRUCTIVE**: `DELETE FROM cards_tags; DELETE FROM cards; DELETE FROM tags;`
  then re-inserts ALL cards. No upsert — full rewrite every save. (Risk: race conditions,
  no partial updates, loses tag rows not referenced.)
- `rowToCard()` maps snake_case DB columns → camelCase card shape.
- `countStreak()` — counts consecutive days (ending today) that have a `last_review`.
- Falls back to `load() -> {cards:[]}` if `DATABASE_URL` is unset (graceful, but save throws).

## 4. Schema (`schema.sql`, untracked)
- `cards` (TEXT id PK, timestamps, question/link/difficulty/*_code/*_thinking/notes/
  question_description, SM-2 columns easiness_factor/interval/repetitions/next_review/
  last_review/last_quality).
- `tags` (TEXT id PK, UNIQUE name).
- `cards_tags` junction (PK card_id+tag_id, FK cascade delete).
- Indexes on created_at + junction FKs.
- `schema.sql` is **untracked** (not committed). It is a reconstruction doc, not applied
  by any migration script (the only migration is `api/migrate.js` which just adds
  `question_description`). So the schema is NOT version-controlled — applying it requires
  manual `psql` or the migrate endpoint.

## 5. SM-2 algorithm (`lib/sm2.js` + duplicate in `server.js`)
Standard SM-2:
- quality 0–2 → reset repetitions & interval to 0 (lapse).
- quality ≥3 → reps 0→interval 1, reps 1→interval 6, else interval = round(interval * EF).
- EF updated by `EF += 0.1 - (5-q)*(0.08 + (5-q)*0.02)`, floored at 1.3.
- `nextReview = today + interval days`.
- Note: `server.js` `sm2Calc` is a duplicate of `lib/sm2.js`. The live path uses
  `lib/sm2.js` (imported by `api/cards/[...cardId].js`).

## 6. API surface (Vercel functions)
| Route | Method | Purpose |
|-------|--------|---------|
| `/api/health` | GET | card count |
| `/api/cards` | GET/POST | list (sorted by created desc) / create |
| `/api/cards/:id` | GET/PUT/DELETE | single card CRUD |
| `/api/cards/:id/review` | POST | submit quality 0–5 → SM-2 update |
| `/api/cards/due` | GET | due cards (nextReview <= today), sorted by urgency |
| `/api/cards/mastered` | GET | repetitions >= 5 |
| `/api/stats` | GET | total/due/mastered/streak |
| `/api/export` | GET | full JSON download |
| `/api/import` | POST | full JSON replace (calls `save` → destructive) |
| `/api/leetcode/fetch` | POST | fetch LeetCode problem by URL → {title, difficulty, tags, description} |
| `/api/migrate` | POST | ALTER TABLE add question_description |

## 7. LeetCode integration (`lib/leetcode.js`)
- Scrapes LeetCode's public GraphQL endpoint (no auth). `extractSlug` parses URL.
- `cleanHtml` strips LeetCode's HTML to markdown-ish text.
- Fetched description stored in `questionDescription` (separate from `notes`).

## 8. Frontend (`src/*.js` + `index.html`)
- Vanilla JS, no framework. Loaded as ordered `<script>` blocks into `index.html`.
  - `01-scaffold.html` → `02-data.js` (DB layer / API calls) → `03-renderer.js`
    → `04-review.js` (review session state machine) → `05-form.js` → `06-utils.js`.
- `04-review.js` is a self-contained review workflow: `startSession → renderCard →
  selectRating → revealAndSubmit (POST /review) → nextCard → endSession`.
- UI state lives on `window.CJ` namespace. Recent commits added: keyboard shortcuts,
  undo delete, auto-resize textareas, remember last tab, duplicate card, edit button.

## 9. Notable issues / risks (found in review, NOT fixed)
1. **`dev-server.js` requires `express` but it's NOT in `package.json` dependencies.**
   `npm i` won't install it → local dev server crashes on import. (express MISSING in node_modules.)
2. **`schema.sql` is untracked** — DB schema not version-controlled; only a partial
   `question_description` migration exists. No `prisma/schema.prisma` present despite README.
3. **`lib/db.js save()` is a full destructive rewrite** — no transactions, no upsert.
   Concurrent writes or a crash mid-save can corrupt/lose data.
4. **Dead/divergent code: `server.js` + its inline `sm2Calc`** duplicate the `api/*.js`
   + `lib/sm2.js` path. Confusing which is canonical.
5. **README references Prisma** (`lib/db-postgres.js`, `prisma/schema.prisma`,
   `db:migrate` scripts) but NONE of those exist. README is stale vs actual code
   (actual = `lib/db.js` Neon HTTP, no Prisma).
6. **CORS is `*`** (all origins) — fine for a personal tool, but not locked down.
7. `countStreak` relies on `last_review` date equality; timezone uses UTC (`toISOString`
   slice) — streak can break around midnight IST.

## 10. How to run locally (as-is)
- Prod parity: `node dev-server.js 3000` — BUT needs `express` installed first.
- Or `npm start` → `server.js` (JSON file mode, separate from prod DB path).
- Needs `DATABASE_URL` (Neon) in env for the `api/*.js` path; without it, `load()`
  returns empty and `save()` throws.

## 11. Suggested next steps (not done)
- Add `express` to `package.json` (or convert `dev-server.js` to Node's built-in http).
- Commit `schema.sql` (or add a real migration runner).
- Reconcile `server.js` vs `api/*.js` — delete the legacy monolith or clearly mark it.
- Rewrite `lib/db.js save()` to upsert per-card instead of full-table wipe.
- Fix README (remove Prisma claims; document Neon + dev-server correctly).

---
_Generated by review only. No files modified except this doc._
