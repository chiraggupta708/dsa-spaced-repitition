# Phase 0A — Auth API/DB Discovery (READ-ONLY)

**Date:** 2026-07-29
**Repo:** `/Users/chirag/dsa-spaced-repetition`
**Scope:** Map every API and DB path that touches cards, designs, import, export, stats for future owner-scoped auth (Clerk + `owner_id`, no friends).
**Constraint:** Application files NOT modified. No production write hits. No `/api/import` exercised.

**Auth baseline today:** No `owner_id`, Clerk, or require-auth anywhere in app code (only a comment in `lib/leetcode.js` about public GraphQL). All data is **global single-tenant**.

---

## 1. Schema (`schema.sql`)

| Table | PK | Notes | owner_id today |
|-------|-----|-------|----------------|
| `cards` | `id TEXT` | SM-2 columns inline | **NONE** |
| `tags` | `id TEXT`, `name UNIQUE` | Shared global tag pool | **NONE** (by design may stay global or become per-owner later) |
| `cards_tags` | `(card_id, tag_id)` | CASCADE on card/tag delete | via card only |
| `designs` | `id TEXT` | `kind IN ('lld','hld')` | **NONE** |
| `designs_tags` | `(design_id, tag_id)` | CASCADE | via design only |

Indexes: `idx_cards_due (next_review)`, tag join indexes, `idx_designs_kind`.

### Exact schema changes needed for owner-scope
1. `ALTER TABLE cards ADD COLUMN IF NOT EXISTS owner_id TEXT NOT NULL DEFAULT '<legacy-owner>';` then drop default / backfill, then require NOT NULL without unsafe default for new rows.
2. Same for `designs.owner_id TEXT NOT NULL`.
3. Optional: `tags.owner_id` + unique `(owner_id, name)` if tags must not leak across users; today tags are **global by name** (`ON CONFLICT (name)` in db.js).
4. Indexes: `CREATE INDEX IF NOT EXISTS idx_cards_owner ON cards(owner_id);`, `idx_cards_owner_due ON cards(owner_id, next_review);`, `idx_designs_owner ON designs(owner_id);`, `idx_designs_owner_kind ON designs(owner_id, kind);`.
5. Apply via `scripts/setup-db.mjs` / `scripts/apply-schema.mjs` (both only run `schema.sql` statements — no code change beyond SQL file).

**Line refs:** tables `cards` L6–25, `tags` L27–30, `cards_tags` L32–36, `designs` L65–81, `designs_tags` L83–87.

---

## 2. DB layer (`lib/db.js`) — global load/save surface

| Export | Lines | Scope today | Change for owner_id |
|--------|-------|-------------|---------------------|
| `load()` | L91–111 | `SELECT … FROM cards c` **all rows** | Add `WHERE c.owner_id = ${ownerId}`; require `ownerId` arg |
| `save(data)` | L122–226 | Upsert by `id` only; **targeted DELETE of cards not in payload is GLOBAL** | Thread `ownerId`; INSERT set `owner_id`; ON CONFLICT only if same owner; **DELETE must be `WHERE owner_id = $owner AND id <> ALL($ids)`** — critical |
| `countStreak(cards?)` | L232–253 | If no cards: `SELECT DISTINCT last_review FROM cards` **global** | Scope query `WHERE owner_id = $1` or always pass owner-filtered cards |
| `loadDesigns(opts)` | L275–300 | `FROM designs d` optional `kind` only | `WHERE d.owner_id = ${ownerId}` (+ kind) |
| `saveDesign(design)` | L306–363 | Upsert by `id` only; no ownership check | Set/check `owner_id`; refuse update if row owned by other |
| `deleteDesign(id)` | L365–369 | `DELETE FROM designs WHERE id = $1` | `AND owner_id = $2` |
| `getDesign(id)` | L371–388 | By id only | `AND d.owner_id = ${ownerId}` or check after load |
| `rowToCard` / `rowToDesign` | L49–82, L265–270 | N/A | Optionally expose `ownerId` in JSON (usually omit) |
| Helpers `todayISO`, `generateId`, `defaultSm2` | L25–42 | pure | no change |

### CRITICAL: `save()` wipe / cross-user risk
- **L213–223:** If `cards.length > 0`, runs
  `DELETE FROM cards WHERE id <> ALL($1)`
  with **no owner filter**.
  Effect today (single user): intentional “replace set” for import + DELETE-via-save after splice.
  Effect multi-user: **User A’s save/import/delete/review/update that load→mutate→save full list will delete every other user’s cards not in A’s payload.**
- Comment at L114–119 claims “never wipes whole table” and empty payload is safe — true for empty, **false for multi-tenant** on non-empty.
- **Import path** (`api/import.js`) calls `save({ cards })` directly → **full global replace** of card set to imported IDs.
- **POST/PUT/DELETE/review** all do `load()` entire DB → mutate one card → `save(fullArray)` → DELETE of all cards not in that full array. Today load is global so array includes everyone; after owner-scoped load without fixing DELETE, **save would delete all other owners’ cards**.

**Required save() semantics after auth:**
1. Never delete across owners.
2. Prefer: upsert single card APIs without full-table replace; or delete only `WHERE owner_id = $owner AND id <> ALL($ids)` when doing import-replace **for that owner only**.
3. Single-card mutations should **not** use “delete absent from full list”; use UPDATE/DELETE by `(id, owner_id)`.

Tags in `save`/`saveDesign`: `INSERT INTO tags … ON CONFLICT (name)` is **global** (L194–198, L349–353). Cross-user tag name sharing is OK if tags are non-sensitive; else scope tags by owner.

---

## 3. HTTP helpers (`lib/api.js`)

| Export | Lines | Auth today | Change |
|--------|-------|------------|--------|
| `corsHeaders` | L1–7 | `Access-Control-Allow-Headers: Content-Type` only | Add `Authorization` (and Clerk header if needed) |
| `applyCors` / `sendJSON` / `handleOptions` | L9–31 | open CORS `*` | Keep `*` or tighten later; must allow auth header |
| `getBody` / `badBodyError` | L33–52 | N/A | no change |

**Missing:** `requireAuth(req)` helper (verify Clerk session/JWT, return `userId` / 401). Add here or `lib/auth.js`.

---

## 4. API routes (method × global × auth change)

Dev wiring: `dev-server.js` L25–39. Vercel: filesystem routes under `api/**` (`vercel.json` has no rewrites).

### 4.1 Cards collection — `api/cards.js`

| Method | Lines | Behavior | Global? | owner_id + require-auth change |
|--------|-------|----------|---------|--------------------------------|
| OPTIONS | via handleOptions | CORS | N/A | allow Authorization |
| GET | L7–18 | `load()` all cards | **YES** | require auth; `load(ownerId)` |
| POST | L21–52 | build card, `load()`, push, `save(full)` | **YES** + wipe risk via save | require auth; set `owner_id` on insert; prefer single-row upsert **without** global delete; if keep load/save pattern, save must be owner-scoped |
| other | L55 | 404 | | |

### 4.2 Card by id + review — `api/cards/[...cardId].js`

| Method / path | Lines | Behavior | Global? | Change |
|---------------|-------|----------|---------|--------|
| POST `…/review` | L26–57 | load all, find id, sm2, save full | **YES** + wipe risk | auth; load/get by `(id, owner)`; update one row or owner-scoped save |
| GET `…/:cardId` | L65–83 | load all, find id | **YES** (info leak) | auth; 404 if not owner |
| PUT `…/:cardId` | L86–123 | load, mutate, save full | **YES** + wipe risk | auth; owner check; scoped save |
| DELETE `…/:cardId` | L126–146 | splice one, save full | **YES** + wipe risk | auth; `DELETE WHERE id AND owner_id` preferred over save-replace |
| path parse | L5–24, L60–62 | `parts[2]` = cardId | | no change |

### 4.3 Due — `api/cards/due.js`

| Method | Lines | Behavior | Global? | Change |
|--------|-------|----------|---------|--------|
| GET | L7–33 | `load()` filter nextReview ≤ today | **YES** | auth; `load(ownerId)` or SQL `WHERE owner_id AND (next_review IS NULL OR next_review <= today)` |

### 4.4 Mastered — `api/cards/mastered.js`

| Method | Lines | Behavior | Global? | Change |
|--------|-------|----------|---------|--------|
| GET | L7–21 | `load()` filter repetitions ≥ 5 | **YES** | auth; owner-scoped load/filter |

### 4.5 Designs collection — `api/designs.js`

| Method | Lines | Behavior | Global? | Change |
|--------|-------|----------|---------|--------|
| GET | L7–18 | `loadDesigns({ kind, tag })` all designs | **YES** | auth; pass ownerId into loadDesigns |
| POST | L21–34 | `saveDesign(body)` | **YES** (writes without owner) | auth; `saveDesign({…, owner_id})` |

### 4.6 Design by id — `api/designs/[id].js`

| Method | Lines | Behavior | Global? | Change |
|--------|-------|----------|---------|--------|
| GET | L13–25 | `getDesign(id)` | **YES** (any id) | auth; owner check / scoped get |
| PUT | L28–37 | `saveDesign({…body, id})` no prior owner check | **YES** (can overwrite any id) | auth; verify ownership before update |
| DELETE | L40–48 | `deleteDesign(id)` | **YES** | auth; delete where id+owner |
| id from | L7 `req.query.id` | Vercel dynamic | | dev-server uses `:id` — confirm query param in Express if needed |

### 4.7 Export — `api/export.js`

| Method | Lines | Behavior | Global? | Change |
|--------|-------|----------|---------|--------|
| GET | L7–21 | `load()` → download JSON `{ cards }` | **YES** (full dump) | **require auth**; export **only** owner cards (and optionally designs later) |

### 4.8 Import — `api/import.js` ⚠️ HIGH RISK

| Method | Lines | Behavior | Global? | Change |
|--------|-------|----------|---------|--------|
| POST | L7–22 | `save({ cards: body.cards })` | **YES replace-set** | **require auth**; import-replace **only that owner’s** cards; never DELETE other owners; validate card payloads; consider merge vs replace flag |

**Wipe risk flag:** Import + `save()` L220–222 = **mass delete of all cards whose ids are not in the import payload**. Multi-user without owner filter = catastrophic. Even single-user: non-empty import replaces entire journal.

### 4.9 Stats — `api/stats.js`

| Method | Lines | Behavior | Global? | Change |
|--------|-------|----------|---------|--------|
| GET | L7–36 | `load()` compute total/due/mastered; `countStreak(allCards)` | **YES** | auth; owner-scoped cards only |

### 4.10 Health — `api/health.js` (adjacent)

| Method | Lines | Behavior | Global? | Change |
|--------|-------|----------|---------|--------|
| GET | L7–17 | `load()` returns `{ status, cards: count }` | exposes **global** count | optional: unauthenticated health without count, or auth; do not leak other users’ counts |

### 4.11 Migrate — `api/migrate.js` (DDL, not user data CRUD)

| Method | Lines | Behavior | Global? | Change |
|--------|-------|----------|---------|--------|
| POST | L23–46 | `ALTER TABLE cards ADD COLUMN question_description…` | admin DDL | **lock down** (secret/admin only or remove); not owner-scoped data; dangerous open POST |

### 4.12 LeetCode fetch — `api/leetcode/fetch.js`

| Method | Lines | Behavior | Global? | Change |
|--------|-------|----------|---------|--------|
| POST | L7–39 | external GraphQL proxy; **no DB** | N/A DB | optional auth to prevent abuse; no owner_id |

---

## 5. Dev server route map (`dev-server.js`)

| Express route | Handler file | Lines |
|---------------|--------------|-------|
| `ALL /api/health` | `api/health.js` | L25 |
| `ALL /api/cards/due` | `api/cards/due.js` | L26 |
| `ALL /api/cards/mastered` | `api/cards/mastered.js` | L27 |
| `ALL /api/stats` | `api/stats.js` | L28 |
| `ALL /api/export` | `api/export.js` | L29 |
| `ALL /api/import` | `api/import.js` | L30 |
| `ALL /api/leetcode/fetch` | `api/leetcode/fetch.js` | L31 |
| `ALL /api/migrate` | `api/migrate.js` | L32 |
| `ALL /api/cards` | `api/cards.js` | L33 |
| `ALL /api/cards/:cardId` | `api/cards/[...cardId].js` | L34 |
| `POST /api/cards/:cardId/review` | same | L35 |
| `ALL /api/designs` | `api/designs.js` | L38 |
| `ALL /api/designs/:id` | `api/designs/[id].js` | L39 |

No auth middleware in Express. Future: mount `requireAuth` before data routes (except health/options).

---

## 6. Setup scripts

| File | Role | owner_id impact |
|------|------|-----------------|
| `scripts/setup-db.mjs` | Build-time apply `schema.sql` statement-by-statement | picks up new ALTERs when schema.sql updated |
| `scripts/apply-schema.mjs` | Manual same | same |

No runtime auth. No data migration of owner backfill in scripts yet — **need a one-time backfill** assigning existing rows to Chirag’s Clerk user id.

---

## 7. Designs paths (summary)

| Path | Methods | DB functions |
|------|---------|--------------|
| `/api/designs` | GET, POST | `loadDesigns`, `saveDesign` |
| `/api/designs/:id` | GET, PUT, DELETE | `getDesign`, `saveDesign`, `deleteDesign` |
| Tables | `designs`, `designs_tags` (+ shared `tags`) | |
| Schema | `schema.sql` L65–91 | |
| DB | `lib/db.js` L256–388 | |

Designs **do not** use bulk `save()` wipe pattern; single-row upsert/delete. Still **unauthenticated** and **not owner-scoped** — any client can list/overwrite/delete any design by id.

---

## 8. Priority change checklist (for parent implementation)

1. **P0 — Stop multi-user wipe:** Rewrite `save()` delete clause to owner-scope; stop using full-list save for single-card mutations (POST/PUT/DELETE/review).
2. **P0 — Import:** Owner-scoped replace only; never call unscoped `DELETE FROM cards WHERE id <> ALL`.
3. **P0 — Schema:** `owner_id` on `cards` + `designs`; backfill legacy rows; indexes.
4. **P1 — requireAuth** on all card/design/import/export/stats routes; CORS Authorization header.
5. **P1 — load/loadDesigns/get/delete/countStreak** all take `ownerId`.
6. **P2 — migrate endpoint** lock/remove; health stop leaking global counts.
7. **P2 — tags** decide global vs per-owner unique name.
8. **P3 — leetcode/fetch** rate-limit or auth optional.

---

## 9. Files read (verified)

- `api/cards.js`, `api/cards/[...cardId].js`, `api/cards/due.js`, `api/cards/mastered.js`
- `api/designs.js`, `api/designs/[id].js`
- `api/export.js`, `api/import.js`, `api/stats.js`, `api/health.js`, `api/migrate.js`, `api/leetcode/fetch.js`
- `lib/db.js`, `lib/api.js`
- `schema.sql`, `scripts/setup-db.mjs`, `scripts/apply-schema.mjs`, `dev-server.js`, `vercel.json`
- Content search: no existing owner_id/Clerk/requireAuth in app sources

---

## 10. Verification

- Discovery is documentation-only.
- No production endpoints called.
- No `/api/import` invoked.
- No git checkout/restore/reset.

**Application files modified: NONE**

**Log file only:** `_subagent-logs/phase-0-auth-api-discovery.md`

---

## File content verified (post write re-read)

- Log path exists; 251 lines after initial write; sections 1–10 present.
- Critical wipe call site confirmed in log: `lib/db.js` L220–222 `DELETE FROM cards WHERE id <> ALL($1)`.
- Designs paths documented: `/api/designs`, `/api/designs/:id`, `lib/db.js` designs block L256–388, schema L65–91.
- Git status for this task: only new untracked log under `_subagent-logs/` from this agent; no application source edits by this agent.
- **Application files modified: NONE**
