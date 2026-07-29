# Phase 0 — Backend/API Discovery Log

**Scope:** Read-only backend/API discovery for V1 Quiet Study Desk. No build run, by request.

## File-read inventory

| File | Lines read | Purpose / key finding |
|---|---:|---|
| `lib/db.js` | 1–418 | Card row mapper and save/upsert implementation; design persistence also present. |
| `api/cards.js` | 1–51 | Collection GET and card creation handler. |
| `api/import.js` | 1–23 | Bulk import handler. |
| `api/leetcode.js` | absent | Exact requested file does not exist. The implemented route is in `api/leetcode/fetch.js`. |
| `api/leetcode/fetch.js` | 1–39 | LeetCode route, request validation, and status mapping. |
| `lib/leetcode.js` | 1–127 | Slug validation, GraphQL request, normalized fetch payload, and error origins. |
| `api/designs.js` | 1–38 | Inspected as requested; it is separate LLD/HLD design CRUD, not needed for V1 card persistence. |
| `schema.sql` | 1–91 | `cards`, tags, joins, and design schema definitions. |
| `test/api-test.js` | 1–348 | Existing API test sequence, including destructive import test and LeetCode coverage. |
| `package.json` | 1–19 | ESM Node 20 project; build only runs DB setup script. |
| `api/cards/[...cardId].js` | 1–145 | Card GET/PUT/DELETE and review behavior needed to answer creation/update/review questions. |
| `lib/sm2.js` | 1–37 | Exact review-quality/SM-2 calculation. |
| `lib/api.js` | 1–52 | JSON body parsing and API helper behavior. |

## Findings

### 1. Existing card fields and Markdown storage

**External card JSON shape:**
- `id`, `created`, `updated`, `question`, `answer`, `link`, `tags`, `difficulty`, `actual_code`, `my_thinking`, `right_thinking`, `notes`, `questionDescription`, and `sm2` (`easinessFactor`, `interval`, `repetitions`, `nextReview`, `lastReview`, `lastQuality`) are emitted by `rowToCard` (`lib/db.js:51–81`).
- The physical `cards` columns are `id`, `created_at`, `updated_at`, `question`, `answer`, `link`, `difficulty`, `actual_code`, `my_thinking`, `right_thinking`, `notes`, `question_description`, `easiness_factor`, `interval`, `repetitions`, `next_review`, `last_review`, and `last_quality` (`schema.sql:6–25`). Tags are normalized into `tags` and `cards_tags` (`schema.sql:27–36`).
- `answer`, `actual_code`, `my_thinking`, `right_thinking`, `notes`, and `question_description` are existing PostgreSQL `TEXT` columns (`schema.sql:11,14–18`), as is `question` (`schema.sql:10`). PostgreSQL `TEXT` stores arbitrary-length text (within PostgreSQL field limits), so these columns safely preserve Markdown source without a schema change. Markdown safety here is persistence-only; rendering must still escape/sanitize before HTML insertion.
- Important current API gap: `answer` is mapped and persisted by `lib/db.js` (`lib/db.js:60,142–177`), but collection POST does **not** set it (`api/cards.js:24–38`) and card PUT does **not** permit updating it (`api/cards/[...cardId].js:101–111`). The V1 Reference Answer/Code field therefore needs explicit API acceptance.

### 2. Card creation, update, and persisted review quality

- `POST /api/cards` generates ID/date strings, initializes SM-2, accepts `question`, `link`, `tags`, `difficulty`, `actual_code`, `my_thinking`, `right_thinking`, `notes`, and `questionDescription`, then `load()`s all cards, appends, and calls `save()` (`api/cards.js:21–42`). It returns `201 { ok: true, card }` (`api/cards.js:42`). It defaults omitted string fields and does not validate required question/link.
- `PUT /api/cards/:id` finds a loaded card and partially updates the supplied allowlisted fields: question/link/tags/difficulty/actual_code/my_thinking/right_thinking/notes/questionDescription. It sets `updated` then calls `save()` and returns `200 { ok: true, card }` (`api/cards/[...cardId].js:86–118`).
- `save()` is per-card Postgres UPSERT on `id` (`lib/db.js:132–185`) and writes `last_quality` from `sm2.lastQuality` (`lib/db.js:146,164,178–183`). Tags are upserted by lowercased name and each card's tag links are replaced (`lib/db.js:187–210`). For a nonempty payload it deletes cards absent from the payload (`lib/db.js:213–223`), so handlers perform load–mutate–save of the entire snapshot.
- Review is `POST /api/cards/:id/review` or `POST /api/cards/:id?review=1|true` (`api/cards/[...cardId].js:23–26`). It accepts integer quality **0–5**, rejecting invalid/missing values with `400 { ok:false, error:'quality must be an integer 0-5' }` (`api/cards/[...cardId].js:26–34`); missing cards return 404 (`:43–45`). It calls `sm2Calc`, writes `card.sm2`, updates date, saves, and returns the full card (`:47–55`).
- `sm2Calc` resets repetitions/interval for ratings below 3; for ratings 3+ it assigns intervals 1 then 6 then `round(interval * EF)`, calculates the next date, and returns/persists `lastQuality` (`lib/sm2.js:7–35`). Schema stores it in nullable integer `last_quality` (`schema.sql:19–24`). The V1 UI’s 1–5 ratings are a compatible subset of this existing server contract.

### 3. Exact LeetCode fetch route, payload, and failure behavior

- `api/leetcode.js` is absent; Vercel route implementation is `POST /api/leetcode/fetch` (`api/leetcode/fetch.js:4–9`; test path confirmation in `test/api-test.js:256–295`).
- Request body: `{ "url": "https://leetcode.com/problems/<slug>/" }`. A valid URL must have a host ending in `leetcode.com` and a pathname exactly `/problems/<lowercase-or-digit-or-hyphen-slug>/`, with optional final slash (`lib/leetcode.js:25–34`).
- Success: `200 { ok: true, data }` (`api/leetcode/fetch.js:30–31`), with `data` equal to `{ title, titleSlug, difficulty: lowercase, tags: string[], description: cleaned text, url: canonical URL }` (`lib/leetcode.js:69–76`). It POSTs LeetCode GraphQL with `questionData` for id/title/difficulty/content/topic tags (`lib/leetcode.js:6–19,40–48`); description conversion preserves several Markdown-like forms including backticks and bold/italic markers (`lib/leetcode.js:83–124`).
- OPTIONS is handled before method validation and returns 204 through `handleOptions` (`api/leetcode/fetch.js:5`; `lib/api.js:21–30`). Other methods return `405 { ok:false, error:'Method not allowed' }` (`api/leetcode/fetch.js:7–9`).
- Empty, absent, or invalid JSON body and blank URL return `400 { ok:false, error:'URL is required' }` (`api/leetcode/fetch.js:12–23`). Invalid non-LeetCode/malformed/path-invalid URL returns `400 { ok:false, error:'Invalid LeetCode URL. Expected format: https://leetcode.com/problems/<slug>/' }` (`:25–28`). Missing problem returns `404 { ok:false, error:'Problem not found on LeetCode' }` (`:33–37`); upstream GraphQL/network/non-not-found errors return `502 { ok:false, error:'Failed to fetch from LeetCode. Please try again.' }` (`:33–39`).

### 4. Tests safe to extend without the destructive import route

- **Do not run or extend `testImport` as part of V1 card API tests:** it calls `POST /api/import` (`test/api-test.js:218–250`), and import calls `save({cards: body.cards})` (`api/import.js:12–19`). Because nonempty save deletes every card omitted from its payload (`lib/db.js:213–223`), this is destructive replacement of the target database.
- Safe *without invoking the import route*: health (`test/api-test.js:51–55,297–302`), LeetCode fetch success and error contracts (`:256–295`), and card create/get/update/review/due/mastered/stats/export sequence (`:57–216,149–191`) can be extended. Card tests still mutate the configured DB and should retain isolated IDs plus the existing cleanup delete (`:193–204`); they are not read-only tests.
- For V1, safely extend the create/update/review tests with Markdown fixtures, `answer` round-trip assertions after the API gap is fixed, direct `link` round-trip assertions, `questionDescription` mapping assertions, and ratings 1–5 behavior. Keep the runner’s import line excluded (`test/api-test.js:330`).

### 5. Recommended minimal backend contract changes for V1 (no V2 diagrams)

1. **Expose Markdown-first fields through the card endpoints:** add `answer` to POST creation and PUT allowlist, preserving its existing `TEXT`/mapper/UPSERT path. Use existing fields with V1 meaning: `my_thinking` = My Approach, `answer` = Reference Answer/Code, `notes` = Notes, `actual_code` remains optional user code, and `questionDescription` = fetched problem description.
2. **Require/validate only the V1 essentials:** reject blank `question`; validate `difficulty` against `easy|medium|hard`; normalize `tags` to an array of strings; validate `link` as a URL when supplied. Do not alter the schema for Markdown.
3. **Narrow review validation to UI contract 1–5** (or explicitly document server 0–5 while UI emits 1–5). Existing storage and SM-2 mapping already persist rating/quality correctly.
4. **Keep the existing LeetCode response shape** and map it client-side into question/link/difficulty/tags/questionDescription. Optionally add a testable error code only if the UI needs stable branching; the present human-readable error strings otherwise suffice.
5. **Avoid `/api/import` in V1 normal flows/tests.** No V1 diagram fields, schema, or API additions are recommended.

## Repository / tooling notes

- `package.json` declares ESM, Node `20.x`, `@neondatabase/serverless`, and `build: node scripts/setup-db.mjs` (`package.json:2–18`). No build was needed or run because this was read-only discovery.
- `api/designs.js` is an independent designs endpoint (`api/designs.js:7–38`); V1 card work should not add design/diagram functionality.

## Scope and verification

- Application files modified: NONE.
- Only assigned log file created/modified: `_subagent-logs/phase-0-backend-discovery.md`.
- File content verified: YES.
