# Feature Plans: Coding Journal

Research conducted 2026-06-05. Competitive landscape: Anki, LeetSRS, DSAPrep, HashTry, CForge, LeetSpace, SpacedSmart, LeetCode Daily Study Companion, LeetTracker.

---

## Executive Summary

**Current app:** Single-file SPA (Vercel + Neon PG). SM-2 SR, CRUD cards, Browse/Review modes, Light/Dark themes, export/import. Lacks search, analytics, platform integration, and advanced review features.

**Our differentiated angle:** Most SR tools for coding focus on *solve + schedule + forget*. Our app already captures *reflection* — thinking notes, code vs. right answer comparison. We should lean into this as the differentiator: it's not just "when to review" but "what to learn from each review."

---

## Plan 1: Search, Filter & Discover (Frontend Only)

**Effort:** Low. **Impact:** High. **API changes:** None (client-side filter on `/api/cards`).

### Features

**Search bar** — real-time full-text across question, tags, code, thinking, notes. 300ms debounce.
**Filter chips** — By tag (auto-extracted from all cards), by difficulty (easy/medium/hard), by status (due/overdue/mastered/new). Chips show count: `hash-map (3)`.
**Sort dropdown** — next review (default), created date, EF, reps, random shuffle, last reviewed.
**Tag management** — rename, merge, delete tags globally from a "manage tags" dialog.
**Shareable filter state** — URL hash: `?tab=due&q=two+sum&difficulty=hard&tags=arrays`.

### Implementation
- Client-side JS in `CJ.search` module. Reuses `CJ.api.getAll()`, filters/sorts locally.
- Tag extraction: `CJ.tags.getAll()` returns `{name, count}` from card list.
- Search uses `String.includes()` — good enough for personal use. No FTS engine needed.
- URL hash: `window.location.hash` → parse → apply filters on load.

### Key Decisions
- Why not server-side search? Data set is small (<1000 cards for a single user). Client-side is instant and free.
- Why debounce? Avoids re-rendering on every keystroke when typing.

---

## Plan 2: Rich Review Engine (Backend + Frontend)

**Effort:** Medium-High. **Impact:** Very High.

### Feature Set

**A. FSRS Algorithm (Free Spaced Repetition Scheduler)**
- **What:** Modern algorithm replacing SM-2. Uses a probabilistic memory model (stability, difficulty, retrievability) personalized to your review history.
- **Why:** Anki's data shows FSRS schedules 20-30% *fewer* reviews for the *same* retention rate. SM-2 is from the 1980s — static formula ignores individual differences.
- **Implementation:** The Open Spaced Repetition community maintains `ts-fsrs` on npm — battle-tested TypeScript port of the FSRS math. Can be embedded server-side. No external dependency at runtime (the math is ~500 lines).
- **User choice:** Keep SM-2 as default, allow opt-in to FSRS. Show a comparison: "FSRS would schedule this card in 14 days vs. SM-2's 10 days."
- **Research source:** [open-spaced-repetition.github.io](https://open-spaced-repetition.github.io/) — FSRS is backed by published papers (ACM SIGKDD 2022, IEEE 2023).

**B. Session Configuration Panel**
- Pre-review modal (shown before first card):
  - Cards per session: 5 / 10 / 20 / All
  - Timer per card: None / 30s / 60s / 90s / 120s
  - Sort: hardest-first / oldest-first / random / by EF
  - Mix: allow new cards alongside due (slider: 0-100% new)
- Session header shows timer, progress, currently remaining

**C. Review History (New DB Table)**
- New field in card schema OR separate `review_log` array:
  ```js
  reviewLog: [
    {
      date: "2026-06-05",
      quality: 4,
      intervalBefore: 6,
      intervalAfter: 14,
      efBefore: 2.5,
      efAfter: 2.6,
      algorithm: "sm2" | "fsrs",
      timeSpent: 45  // seconds
    }
  ]
  ```
- Server-side: update at end of each review, return with card
- Client-side: display on expanded card as mini timeline
- Enables: Plan 3 analytics, Plan 2 retention curves, manual reschedule

**D. Manual Reschedule & Overrides**
- In card detail: "Review tomorrow", "Review in 3 days", "Review in 1 week"
- "Mark as mastered" → set reps to 5, nextReview to null
- "I forgot" → reset card (reps=0, interval=0)
- "Snooze" → push due date by N days without changing EF/reps

**E. Card-Level Insights (in expanded card)**
- Retention prediction: "You had a 78% chance of recalling this. You rated it 4 (Good)."
- Quality trend: mini sparkline of last 10 ratings
- Next review countdown: "Due in 3 days"

### Backend Changes
- `POST /api/cards/:id/reschedule` → body: `{action: "tomorrow" | "3days" | "week" | "mastered" | "reset"}`
- `GET /api/cards/:id/history` → returns reviewLog array
- Updated `POST /api/cards/:id?review=1` → appends to reviewLog, returns updated card
- FSRS version: `POST /api/settings` → `{algorithm: "sm2" | "fsrs"}` (stored in memory, or new DB table)

### Research Note: SM-2 vs FSRS
- SM-2: 3 fixed params (EF, interval, repetitions). Quality < 3 → reset. Simple, predictable.
- FSRS: ~17 trainable params fit to your history. Requires ~400+ reviews to optimize. Falls back to defaults for new users.
- Recommendation: Ship SM-2 improvements first (review history, session config, reschedule). Add FSRS toggle as a second iteration once users have data to train it.

---

## Plan 3: Analytics Dashboard (Backend + Frontend)

**Effort:** Medium. **Impact:** High.

### Features

**A. GitHub-Style Review Heatmap**
- 365-day grid (53 cols × 7 rows)
- Color intensity = reviews that day (0, 1-3, 4-7, 8-15, 16+)
- Click a cell → show card titles reviewed that day
- Implementation: inline CSS grid, no canvas/library needed. Each cell is a `<div>`.

**B. Topic Mastery Breakdown**
- Summary by tag: how many cards total / mastered / due / overdue
- Rendered as a compact table with progress bars
- Color: green = mastered, yellow = due, red = overdue, gray = new

**C. Workload Forecast**
- "Cards due this week" / "next week" / "next 30 days"
- Bar chart (CSS) showing due count per day for next 30 days
- Helps plan: "Big spike Friday — prepare"

**D. Retention & Performance Trends**
- Weekly average rating (line chart, CSS-only or SVG)
- Retention rate: of cards due this week, what % were rated ≥ 3
- Streak length / longest streak / current streak

**E. Interview Readiness Score (0-100)**
Composite of:
1. Mastery % (cards with reps ≥ 5 / total) — 30%
2. Topic coverage (% of distinct tags with at least 1 mastered card) — 20%
3. Consistency (daily reviews over last 30 days, capped at 20/day) — 20%
4. Average quality (last 50 reviews, scale to 0-100) — 15%
5. Recency (last review < 3 days ago? +10pt, < 7 days? +5pt) — 15%

### Backend Changes
- `GET /api/analytics/heatmap?days=365` → `{ "2026-06-05": 12, ... }`
- `GET /api/analytics/mastery` → `[{ tag: "arrays", total: 10, mastered: 3, due: 2, overdue: 1 }]`
- `GET /api/analytics/forecast?days=30` → `[{ date: "2026-06-06", count: 3 }, ...]`
- `GET /api/analytics/readiness` → `{ score: 72, components: {...} }`

### Frontend
- New "Analytics" tab (alongside Due/All/Mastered/Add)
- Pure CSS/HTML charts — no Chart.js dependency (keep single-file)
- Heatmap: CSS grid with `background-color` per cell
- Bar chart: flexbox bars with `height: X%`
- Sparkline: SVG `<polyline>` or inline CSS width

### Dependency
- Requires review log from Plan 2. Without it: only basic stats (total, due, mastered, streak).

---

## Plan 4: Platform Integrations (Backend + Frontend)

**Effort:** High. **Impact:** Highest.

### Features

**A. LeetCode Problem Sync**
- **Quick-add from URL:** User pastes a LeetCode URL → backend fetches problem data via LeetCode's public GraphQL API → pre-fills form
- **GraphQL query** (public, no auth needed for problem data):
  ```graphql
  query questionData($titleSlug: String!) {
    question(titleSlug: $titleSlug) {
      questionId, questionFrontendId, title, titleSlug
      difficulty, topicTags { name, slug }
      content  # HTML description
      codeSnippets { lang, code }  # starter code
    }
  }
  ```
- Endpoint: `POST https://leetcode.com/graphql/` — no auth header required for this query (tested by LeetSRS and other open-source projects)
- **Title slug extraction:** Parse LeetCode URL: `https://leetcode.com/problems/two-sum/` → `"two-sum"`
- **Auto-fill:** question title, difficulty, tags, link field — user only fills in thinking notes and code
- **"Open on LeetCode"** button on card detail (already supported via `card.link`)

**B. Curated Problem Lists**
- Blind 75, NeetCode 150, Grind 169, LeetCode Top 100 Interview Questions
- Each list as a JSON file in `/data/lists/`:
  ```json
  {
    "name": "Blind 75",
    "problems": [
      { "titleSlug": "two-sum", "title": "Two Sum", "difficulty": "easy", "tags": ["array", "hash-table"] },
      ...
    ]
  }
  ```
- Data source: public GitHub repos (envico801/Neetcode-150-and-Blind-75, etc.)
- "Import List" button → creates cards for all problems in the list with minimal data (title, difficulty, tags, link). User fills in thinking/code later.
- Progress tracker: "12 / 75 Blind 75 solved" in Browse header

**C. Anki Import**
- `.apkg` format: ZIP containing SQLite (`collection.anki2` or `collection.anki21`) + `media` JSON
- Internal structure: tables `notes`, `cards`, `decks`, `revlog`, `col` (config)
- Key table: `notes` → fields (JSON array), `cards` → scheduling data (did=deck, type, queue, due, ivl, factor)
- Implementation options:
  1. Server-side: `multer` upload + use `better-sqlite3` or `sql.js` to read SQLite in Node
  2. Client-side: unzip in browser using `JSZip`, read SQLite using `sql.js` (WebAssembly)
- **Recommended:** Client-side with `JSZip` + `sql.js` (~50KB gzipped combined). No backend dependency.
- Map: Anki `notes.flds` → card fields, Anki `cards.factor` → EF, `cards.ivl` → interval, `cards.due` → nextReview

**D. GitHub Gist Backup**
- One-click backup to a private GitHub Gist
- Uses GitHub's personal access token (user provides via settings)
- `PUT /gists/:id` with card data as JSON payload
- Like LeetSRS's approach: cross-device sync without a dedicated server

### Backend Changes
- `POST /api/leetcode/fetch` → proxy to `https://leetcode.com/graphql` (to avoid CORS)
- `POST /api/cards/bulk` → `{ cards: [...] }` — creates many at once (also serves batch import)
- `/data/lists/` — static JSON files for curated problem lists (served statically, no API needed)
- GitHub Gist backup: optional, on-client via GitHub API (no backend proxy needed)

### Why This Plan Last
- Highest complexity — needs networking, parsing, data mapping
- But highest user value — zero-friction card creation is a game-changer
- Every competitor does LeetCode sync — without it, the app requires manual entry

---

## Plan 5: PWA & Mobile Experience (Frontend Only)

**Effort:** Low-Medium. **Impact:** Medium.

### Features

**A. Service Worker**
- Cache app shell (`index.html`, no external assets) on first load
- Serve from cache when offline (read-only card browsing)
- `manifest.json`: scope, icons (auto-generated via emoji + canvas), theme color matching dark/light

**B. Install Prompt**
- `beforeinstallprompt` event → show install button in toolbar
- Works on Chrome Android, Safari iOS (via Share → Add to Home Screen)

**C. Push Notifications**
- Request permission → subscribe → receive "X cards due today" reminders
- Implementation: browser's Push API + VAPID keys
- Requires a lightweight push service (or use service worker's `showNotification`)
- Alternative (simpler): schedule via `setInterval` in service worker for daily check
- Or: cron-based via Vercel (free tier cron jobs) → pushes notification via web push

**D. Mobile Touch Optimizations**
- Swipe left/right on card in review mode (4 → mark Good, go next)
- Pull-to-refresh on Browse mode (re-fetch data)
- Bottom sheet for filters on mobile (was: inline chips)
- Increase all tap targets to 44px min

### Implementation
- `sw.js` in root, registered from main page
- `manifest.json` with proper icons (72/96/144/192/512)
- `vercel.json` headers: `service-worker.js` → `Cache-Control: no-cache`
- No backend changes — all client-side

### Why
- Learning happens on mobile (commute, gaps between meetings)
- Push notifications are the #1 feature to maintain review habit
- Very low code change for a big UX win

---

## Plan 6: Card Templates & Rich Content (Frontend Only)

**Effort:** Low. **Impact:** Medium.

### Features

**A. Code Syntax Highlighting**
- **Approach:** Load highlight.js or Prism.js from CDN. No npm, no build step.
- highlight.js: `https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.11.1/highlight.min.js` (~27KB gzipped). Auto-detects language. 192 languages.
- Prism.js: lighter (~12KB gzipped for core + 5 languages). Manual language selection.
- **Recommendation:** highlight.js — auto-detect works well for code blocks. `<pre><code class="hljs">${code}</code></pre>` → `hljs.highlightElement(el)`.
- Apply after each render that includes code blocks.
- Under light/dark theme: use CSS variables for highlights (hljs supports CSS custom properties).

**B. Markdown Support**
- Notes and thinking fields support basic Markdown: `**bold**`, `*italic*`, `` `code` ``, lists, `[links](url)`
- Implementation: simple regex-based renderer (~50 lines). No library needed.
  ```js
  function renderMarkdown(text) {
    return text
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/\*([^*]+)\*/g, '<em>$1</em>')
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')
      // lists, headings, etc.
  }
  ```
- Why no full parser? Markdown-it or marked would add 30KB+. The limited subset covers 80% of use cases.

**C. Image Attachments**
- Paste or drag-drop image into notes field
- Convert to base64, store in card data (OK for small diagrams/screenshots)
- Display as inline image in card detail
- Size limit: 300KB per image (avoid bloating Neon DB storage)

**D. Card Templates**
- Templates for different problem types, pre-populating structure:
  - **Algorithm:** question, approach, code, time/space complexity, notes
  - **System Design:** requirements, constraints, architecture, data model, tradeoffs
  - **SQL:** schema, query, expected output, optimization notes
  - **Behavioral (STAR):** Situation, Task, Action, Result
  - **General:** question, my thinking, right thinking, code, notes
- Template selector shown on "New Card" form (radio buttons)
- Each template defines which fields are visible and their labels

### Implementation
- All client-side JS/CSS
- Image handling: `FileReader.readAsDataURL()` → base64 string stored in card
- Syntax highlighting: load CDN script once on first render, cache
- Templates: JS objects defining field order, labels, placeholders

---

## Plan 7: Bulk & Power Tools (Frontend + Minor Backend)

**Effort:** Low. **Impact:** Medium.

### Features

**A. Multi-Select Mode**
- Toggle button activates checkboxes on each card
- "Select All" / "Select None" buttons
- Action bar appears when selection count > 0

**B. Batch Operations**
- **Batch tag:** modal with tag input field. Apply to all selected cards.
- **Batch reschedule:** "Review tomorrow", "Review in 3 days", "Reset all"
- **Batch delete:** confirm with count, then delete all selected
- **Batch algorithm override:** "Switch all to FSRS" / "Switch all to SM-2"

**C. Duplicate Detection & Merge**
- When adding a new card, detect similar titles (simple Levenshtein distance < 5 chars)
- Show: "Similar card exists: 'Two Sum'. Merge or create anyway?"
- Merge: combine tags, keep the most recent thinking notes, merge code with separator

**D. Advanced Export**
- Current: full JSON export
- New: filtered export by tag/difficulty/status
- New: CSV export (question, tags, difficulty, code, thinking, reps)
- New: Markdown export (one card = one section, formatted)

**E. Anki Export**
- Generate `.apkg` from all cards (reverse of Plan 4C's import)
- Use `genanki` or generate the SQLite + collections JSON directly
- Audience: users who want to continue in Anki

### Backend Changes
- Minor: batch operations via existing `PUT /api/cards/:id` looped (no new endpoint needed for <50 cards)
- Better: `PATCH /api/cards/batch` → `{ ids: [...], updates: { difficulty: "hard" } }`
- `GET /api/cards/export/csv` → CSV download
- `POST /api/cards/detect-duplicates` → `{ title: "Two Sum" }` → return candidates

### Why Put This Last
- Utility features, not core retention value
- Low-medium effort but medium impact for power users
- Can be shipped incrementally (batch delete first, merge last)

---

## Priority & Dependency Graph

```
NO DEPS (ship any order):
  Plan 1: Search & Filters       ─── P1 (high impact, low effort)
  Plan 5: PWA & Mobile            ─── P1 (medium impact, low effort)
  Plan 6: Templates & Highlights  ─── P1 (medium impact, low effort)

DEPS CHAIN:
  Plan 2A (FSRS)                  ─── P2 (independent, backend)
  Plan 2B (Session config)        ─── P2 (frontend only)
  Plan 2C (Review history)        ─── P2 (backend, enables analytics)
  Plan 2D (Reschedule)            ─── P2 (small backend)
  Plan 2E (Card insights)         ─── P2 (needs 2C)
    ↓
  Plan 3: Analytics               ─── P2 (needs 2C's review log)
    ↓
  Plan 7: Bulk & Power Tools      ─── P2 (standalone but nice after organization features)

  Plan 4: Platform Integrations   ─── P3 (largest scope, highest value)
```

## Implementation Order Recommendation

### Wave 1 (P1): "Make It Findable & Pleasant"
1. **Plan 1 — Search & Filters** (one session, frontend only)
2. **Plan 6 — Syntax highlighting + Markdown** (one session, frontend only)
3. **Plan 5 — PWA basics** (manifest, service worker, install prompt) (one session, frontend only)

### Wave 2 (P2): "Make It Smart"
1. **Plan 2C — Review history** (backend schema change, frontend display)
2. **Plan 2B — Session configuration** (frontend)
3. **Plan 2D — Manual reschedule** (minor backend + frontend)
4. **Plan 2A — FSRS algorithm** (backend math. High value after review history exists)
5. **Plan 3 — Analytics dashboard** (backend endpoints + frontend charts. Needs review history)
6. **Plan 7 — Bulk tools** (minor backend + frontend)

### Wave 3 (P3): "Connect to LeetCode"
1. **Plan 4A — LeetCode URL sync** (proxy endpoint + frontend form integration)
2. **Plan 4B — Curated problem lists** (JSON data + one-click import)
3. **Plan 4D — GitHub Gist backup** (client-side)
4. **Plan 4C — Anki import** (client-side or server-side SQLite parsing)

---

## Data Model Additions (for plans 2, 3, 4)

### For Plan 2C — Review History
```js
// Add to existing card schema
reviewLog: [
  {
    date: "2026-06-05",
    quality: 4,
    intervalBefore: 6,
    intervalAfter: 14,
    efBefore: 2.5,
    efAfter: 2.6,
    algorithm: "sm2",  // "sm2" | "fsrs"
    timeSpent: 45      // seconds, if timer active
  }
]
// Maximum entries: keep last 100 per card (trim oldest)
```

### For Plan 4 — LeetCode Integration
```js
// Additional card fields (optional)
platform: "leetcode",          // or "manual" or "anki-import"
platformId: "1",               // LeetCode questionId
platformSlug: "two-sum",       // LeetCode titleSlug (for Open in LC)
hasSolution: true,             // LeetCode has official solution
hasVideoSolution: false        // LeetCode has video solution
```

### For Plan 6 — Image Attachments
```js
images: [
  {
    name: "diagram.png",
    data: "data:image/png;base64,..."   // base64 encoded
  }
]
// Size limit per image: 300KB
// Size limit total per card: 1MB
```

---

## Technical Constraints

### Single-File SPA Limit
- Keep `index.html` as single deployable. No build step.
- If the file grows past 500KB, split into:
  - `index.html` (skeleton + critical CSS)
  - `app.js` (all JS, loaded async)
  - `style.css` (full theme CSS)
- For now (34KB), keep single-file.

### CDN Dependencies (zero-config)
| Feature | What | Size (gzip) | CDN URL |
|---|---|---|---|
| Syntax highlighting | highlight.js core | ~27KB | cdnjs (no auth) |
| LeetCode import | none (fetch proxy) | 0 | — |
| Anki import | sql.js + JSZip | ~50KB | CDN (optional) |
| Charts | CSS/HTML only | 0 | — |

### Backend (Vercel Serverless)
- Each API call is a lambda invocation. Keep endpoints focused.
- New DB fields: store `review_log` as JSON string in Postgres column (Neon supports JSONB).
- FSRS: compute server-side on review, save result + log entry.
- LeetCode proxy: serve as an API route that forwards to leetcode.com/graphql (to avoid CORS in browser).

### Database (Neon PG, SQL via @neondatabase/serverless)
- Current schema: `cards` table with individual columns + `card_tags` junction + `tags` table
- Adding `review_log` as JSONB column on `cards` table (avoids separate table, keeps queries fast for single-card access)
- Migration: one-time `ALTER TABLE cards ADD COLUMN review_log JSONB DEFAULT '[]'::jsonb;`

---

## Competitor Feature Matrix

| Feature | Us | LeetSRS | HashTry | DSAPrep | CForge | LeetSpace |
|---|---|---|---|---|---|---|
| Spaced repetition | ✅ SM-2 | ✅ FSRS | ✅ Proprietary | ✅ Basic | ✅ Custom | ❓ |
| Search / Filter | ❌ | ❓ | ✅ | ❓ | ❓ | ❓ |
| Thinking notes | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Code in cards | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| LeetCode sync | ❌ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Curated lists | ❌ | ❌ | ✅ | ❌ | ✅ | ❓ |
| Analytics/Heatmap | ❌ | ❌ | ✅ | ❌ | ✅ | ❓ |
| PWA/Mobile | ❌ | ✅ (ext) | ✅ (ext) | ❌ | ✅ PWA | ❓ |
| Export/Import | ✅ | ❓ | ❓ | ❓ | ❓ | ❓ |
| FSRS algorithm | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ |
| Review settings | ❌ | ❌ | ❓ | ❌ | ❓ | ❓ |
| Tags/Bulk | ❌ | ❓ | ❓ | ❓ | ❓ | ❓ |
| Free | ✅ | ✅ | Freemium | ✅ | ✅ | ✅ |
| Open source | ✅ | ✅ | ❌ | ❓ | ✅ | ❓ |

Key insight: **No competitor has thinking notes + spaced repetition + LeetCode sync in one app.** That's our gap to fill.

---

## Technical Risk Areas

1. **FSRS complexity:** 17 parameters, needs ~400 reviews to optimize. For new users, fall back to SM-2 or FSRS defaults. Optimize button (like Anki) runs on server.
2. **LeetCode fetching:** If LeetCode rate-limits or changes their GraphQL schema, the sync breaks. Mitigation: graceful fallback (manual entry still works).
3. **Anki import via sql.js:** WebAssembly SQLite in browser works but needs newer browser APIs. Fallback: server-side parsing with better-sqlite3.
4. **Push notifications:** Vercel serverless functions can't run long-lived push workers. Need alternative: client-side service worker sets up periodic sync, or use cron job + VAPID web push via a small notification service.
5. **Image attachments base64:** Neon PG has column size limits. 1MB base64 per card × 1000 cards = 1GB DB. Mitigation: store images as separate URLs (Vercel Blob or S3) or cap at 3 images per card 300KB each, with cleanup on edit.

---

*Document written 2026-06-05. Research sources: open-spaced-repetition.github.io (FSRS), github.com/akarsh1995/leetcode-graphql-queries (LeetCode API), implicit.computer/blog/2024/03/anki-apkg (Anki format), activerecalling.com/blog/spaced-repetition-ultimate-guide (SR best practices), dasroot.net/posts/2025/12 (developer SR), leetsrs.com/hashtry.io/leetspace.dev (competitive research).*
