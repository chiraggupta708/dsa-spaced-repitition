# Exact Count, Stable Profile, and Safe Search Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show the exact saved-problem total with no full-list transfer, keep Clerk profile UI stable across repeated auth events, and repair bounded Library search.

**Architecture:** Extend the existing owner-scoped practice aggregate by one integer and render that integer independently of Library pagination. Treat Clerk notifications as state transitions so unchanged identities do not remount UI or refetch data. Repair the existing parameterized `ILIKE` filters with an unambiguous one-character escape marker while preserving cursor pagination and lightweight DTOs.

**Tech Stack:** Static HTML/CSS/JavaScript SPA, Clerk browser SDK, Vercel serverless functions, Neon PostgreSQL, existing source-contract scripts.

**Testing constraint:** Per user instruction, add no new automated tests. Run the existing build and contract suite plus authenticated browser checks.

---

## File map

- Modify `lib/db.js` — safe search escaping and exact aggregate card count.
- Modify `lib/dsa-practice.js` — expose `totalCount` in the existing summary DTO.
- Modify `index.html` — render the exact total and make Clerk component/data refresh lifecycle transition-based.
- Modify `docs/superpowers/specs/2026-09-19-exact-count-stable-profile-design.md` — record that unchanged auth events do not refetch data.
- Modify this plan only to mark completed steps.
- Do not add or rename files under `api/`; `/api/practice?view=summary` remains the existing summary route.

### Task 1: Repair bounded Library search

**Files:**
- Modify: `lib/db.js:1187-1205`

- [ ] **Step 1: Replace the ambiguous backslash escape marker**

Change `addQueueFilterSql` so user-entered `!`, `%`, and `_` remain literal:

```js
function addQueueFilterSql(where, params, filters) {
  let next = params.length + 1;
  if (filters.q) {
    params.push(`%${filters.q.replace(/[!%_]/g, '!$&')}%`);
    where.push(`(c.question ILIKE $${next} ESCAPE '!' OR c.link ILIKE $${next} ESCAPE '!' OR EXISTS (
      SELECT 1 FROM cards_tags queue_ct
      JOIN tags queue_t ON queue_t.id = queue_ct.tag_id
      WHERE queue_ct.card_id = c.id AND queue_t.name ILIKE $${next} ESCAPE '!'
    ))`);
    next += 1;
  }
  if (filters.difficulty) {
    params.push(filters.difficulty);
    where.push(`c.difficulty = $${next}`);
  }
  return params.length + 1;
}
```

Do not change the ten-row limit, cursor shape, selected columns, owner predicate, debounce, or API response envelope.

- [ ] **Step 2: Run the existing transfer and build checks**

Run:

```bash
npm run build
node scripts/test-dsa-transfer-backend-contract.mjs
npm run test:dsa-ui
```

Expected: all commands exit 0 and the source contracts still confirm lightweight cursor pagination.

- [ ] **Step 3: Commit the search repair**

```bash
git add lib/db.js
git commit -m "fix: make library search escaping valid"
```

### Task 2: Add the exact saved-problem count to the existing summary

**Files:**
- Modify: `lib/db.js:1326-1365`
- Modify: `lib/dsa-practice.js:920-930`
- Modify: `index.html:952-970`

- [ ] **Step 1: Count cards inside the existing aggregate query**

Add the total beside the existing filtered aggregates:

```sql
SELECT
  COUNT(*) AS total_count,
  COUNT(*) FILTER (WHERE next_practice_at IS NOT NULL AND next_practice_at <= $2::timestamptz) AS due_count,
  COUNT(*) FILTER (WHERE last_independent_solve_at IS NULL) AS first_check_count,
  COUNT(*) FILTER (WHERE recognition_trap_suggested) AS recognition_trap_count,
  COALESCE(MAX(revision), 0) AS version
FROM summary_rows
```

This must remain the same owner-scoped query and must not load card bodies.

- [ ] **Step 2: Expose the integer through the summary DTO**

Add the field without changing existing names:

```js
export function toPracticeSummary(row = {}) {
  return {
    totalCount: Number(rowValue(row, 'total_count', 'totalCount') || 0),
    dueCount: Number(rowValue(row, 'due_count', 'dueCount') || 0),
    firstCheckCount: Number(rowValue(row, 'first_check_count', 'firstCheckCount') || 0),
    nextItem: rowValue(row, 'next_item', 'nextItem') || null,
    recognitionTrapCount: Number(rowValue(row, 'recognition_trap_count', 'recognitionTrapCount') || 0),
    version: rowValue(row, 'version') || null,
  };
}
```

- [ ] **Step 3: Render the exact total independently of Library pages**

Update `dsaRenderCounts` to derive the saved-problem count only from the loaded summary:

```js
var summary=dsaState.summary||{},hasTotal=Object.prototype.hasOwnProperty.call(summary,'totalCount'),libraryText=hasTotal?String(Number(summary.totalCount||0)):'—';
```

Use `libraryText` for `dsaLibraryCount` and `dsaSidebarLibraryCount`. After `dsaLoadSummary` assigns `dsaState.summary`, call `dsaRenderCounts()` so the exact total appears without opening Library.

- [ ] **Step 4: Run existing summary/UI checks and commit**

Run:

```bash
npm run build
node scripts/test-dsa-practice-persistence-contract.mjs
node scripts/test-dsa-practice-api-contract.mjs
npm run test:dsa-ui
```

Expected: all commands exit 0.

Commit:

```bash
git add lib/db.js lib/dsa-practice.js index.html
git commit -m "feat: show exact saved problem count"
```

### Task 3: Make Clerk UI and data refresh transition-based

**Files:**
- Modify: `index.html:696-756`

- [ ] **Step 1: Track mounted Clerk components**

Next to `authIdentity`, add:

```js
var clerkSignInMounted=false;
var mountedUserButtonIdentity='';
```

Add guarded lifecycle helpers:

```js
function unmountSignIn(){
  var host=$('signIn');
  if(clerkSignInMounted&&window.Clerk&&typeof window.Clerk.unmountSignIn==='function')try{window.Clerk.unmountSignIn(host)}catch(e){}
  if(host)host.replaceChildren();
  clerkSignInMounted=false;
}
function unmountUserButton(){
  var host=$('userButton');
  if(mountedUserButtonIdentity&&window.Clerk&&typeof window.Clerk.unmountUserButton==='function')try{window.Clerk.unmountUserButton(host)}catch(e){}
  if(host)host.replaceChildren();
  mountedUserButtonIdentity='';
}
```

- [ ] **Step 2: Mount signed-out UI once**

In `showSignedOut`, unmount the user button on the actual transition, clear private state only when leaving a signed-in identity, and call `mountSignIn` only when `clerkSignInMounted` is false. Set the marker only after a successful mount.

```js
var wasSignedIn=!!authIdentity||!!mountedUserButtonIdentity;
authIdentity='';
if(wasSignedIn){unmountUserButton();clearPrivateView()}
// show auth gate
if(!clerkSignInMounted){window.Clerk.mountSignIn($('signIn'));clerkSignInMounted=true}
```

- [ ] **Step 3: Treat repeated signed-in notifications as no-ops**

At the beginning of `showSignedIn`, compute identity and return after maintaining visibility when both markers already match:

```js
var sameIdentity=!!identity&&authIdentity===identity&&mountedUserButtonIdentity===identity;
if(sameIdentity){
  $('authGate').classList.add('hidden');
  $('appShell').classList.remove('hidden');
  updateMobileNav();
  return;
}
```

For a real transition, unmount sign-in once, unmount the previous user button before clearing its host, mount the new user button once, set `mountedUserButtonIdentity=identity`, notify the DSA workspace, and call `refresh()` once. Do not call `refresh()` in the same-identity branch.

- [ ] **Step 4: Run existing authentication/UI checks and commit**

Run:

```bash
npm run build
npm run test:dsa-ui
npm run test:api-cache
```

Expected: all commands exit 0.

Commit:

```bash
git add index.html
git commit -m "fix: keep Clerk profile mounted per identity"
```

### Task 4: Verify transfer limits and deployed behavior

**Files:**
- Modify: `docs/superpowers/plans/2026-09-19-exact-count-stable-profile-safe-search.md`

- [ ] **Step 1: Run the complete existing suite**

```bash
npm run build
for script in $(node -e "const p=require('./package.json'); console.log(Object.keys(p.scripts).filter(k=>k.startsWith('test:')).join(' '))"); do npm run "$script"; done
node scripts/test-dsa-transfer-backend-contract.mjs
node scripts/test-dsa-practice-persistence-contract.mjs
node scripts/test-dsa-practice-api-contract.mjs
git diff --check
```

Expected: every command exits 0.

- [ ] **Step 2: Confirm the Vercel function budget**

```bash
test "$(rg --files api | wc -l | tr -d ' ')" = "12"
```

Expected: exit 0; no API entry file was added.

- [ ] **Step 3: Perform authenticated browser checks**

On the resulting exact Vercel deployment:

- confirm the saved-problems metric and Library navigation badge show the exact total;
- search by a normal title fragment and confirm a bounded result page;
- search for `%`, `_`, and `!` and confirm no `invalid escape string` error;
- confirm the Library still renders at most ten rows before pagination;
- wait through repeated Clerk listener updates and confirm the bottom-left avatar remains present;
- confirm browser logs contain no new application-triggered Clerk `removeChild` errors;
- confirm network behavior uses the existing practice summary plus only the active bounded list requests.

- [ ] **Step 4: Commit the completed checklist and push `dev`**

```bash
git add docs/superpowers/specs/2026-09-19-exact-count-stable-profile-design.md docs/superpowers/plans/2026-09-19-exact-count-stable-profile-safe-search.md
git commit -m "docs: complete count profile and search rollout"
git push origin dev
```
