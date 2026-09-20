# Exact Counts and Independent Solve UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show exact filtered DSA totals and make the recommended Independent Solve action and reveal behavior clearer without increasing solution-body transfer.

**Architecture:** Existing cursor-paginated database readers will return a `totalCount` computed from the same snapshot and filters but without the cursor boundary. Existing API handlers will forward that integer. The single-page client will retain the total alongside cached pages, derive page totals, label the recommended Independent Solve from `summary.nextItem`, and render its fetched reference inside an open-by-default disclosure.

**Tech Stack:** Node.js ES modules, PostgreSQL/Neon SQL, Vercel serverless handlers, vanilla HTML/CSS/JavaScript.

---

### Task 1: Add exact totals to lightweight database pages

**Files:**
- Modify: `lib/db.js:225-426`
- Modify: `lib/db.js:1368-1470`

- [ ] **Step 1: Preserve pre-cursor filters in each paginated reader**

In `loadCardSummaries`, `loadDueCardSummaries`, and `listPracticeQueue`, copy the owner/snapshot/filter predicates and parameters after filters are applied but before the cursor predicate is appended:

```js
const countWhere = [...where];
const countParams = [...params];
if (cursor) addCardAfterKeySql(where, params, cursor.key);
```

Use the appropriate existing cursor helper in each function. The count copy must never receive the cursor predicate.

- [ ] **Step 2: Query the filtered total without loading card bodies**

After establishing `db`, execute an owner-scoped aggregate using the preserved predicates:

```js
const countRows = await db.query(
  `SELECT COUNT(*) AS total_count
   FROM cards c
   WHERE ${countWhere.join(' AND ')}`,
  countParams
);
const totalCount = Number(countRows[0]?.total_count || 0);
```

For `listPracticeQueue`, retain the same `LEFT JOIN fsrs_practice_states s ON s.owner_id = $1 AND s.card_id = c.id` used by its page query so bucket predicates can resolve. Search tag subqueries remain valid without joining tags in the outer count.

- [ ] **Step 3: Return `totalCount` from all lightweight page readers**

Update database-unavailable fallbacks and successful returns:

```js
return { cards: [], nextCursor: null, hasMore: false, totalCount: 0, version: snapshotAt };
```

```js
return { cards, nextCursor, hasMore, totalCount, version: snapshotAt };
```

Queue readers use `items` instead of `cards`.

- [ ] **Step 4: Run the existing build check**

Run: `npm run build`

Expected: exit code 0 and no syntax or API-file-count failure.

- [ ] **Step 5: Commit the database page changes**

```bash
git add lib/db.js
git commit -m "feat: return exact totals for DSA pages"
```

### Task 2: Forward totals through existing API responses

**Files:**
- Modify: `api/cards.js:31-51`
- Modify: `api/cards/due.js:39-57`
- Modify: `api/practice.js:81-89`

- [ ] **Step 1: Add `totalCount` to saved-card and due-card responses**

Add the field beside the pagination metadata:

```js
totalCount: page.totalCount,
```

Use `dueSummary.totalCount` in `api/cards/due.js`.

- [ ] **Step 2: Add `totalCount` to the shared practice page response**

Update `sendPracticePage`:

```js
function sendPracticePage(res, page) {
  sendJSON(res, 200, {
    ok: true,
    items: page.items,
    nextCursor: page.nextCursor,
    hasMore: page.hasMore,
    totalCount: page.totalCount,
    version: page.version,
  });
}
```

Selected-card session responses may omit the field internally; the shared sender can serialize it as absent/undefined because those responses are not paginated in the UI.

- [ ] **Step 3: Verify the serverless entry count remains 12**

Run: `find api -type f -name '*.js' | wc -l`

Expected: `12`.

- [ ] **Step 4: Commit the API propagation**

```bash
git add api/cards.js api/cards/due.js api/practice.js
git commit -m "feat: expose exact DSA page totals"
```

### Task 3: Render exact recall counts and filtered page totals

**Files:**
- Modify: `index.html:874-1057`

- [ ] **Step 1: Extend client page state with totals and page size**

Use a keyed page-size helper so Recall remains five items and other lists remain ten:

```js
function pageState(){return {pages:[],page:0,loading:false,error:null,request:0,totalCount:null}}
function dsaPageSize(key){return key==='recall'||key==='todayCold'?RECALL_LIMIT:QUEUE_LIMIT}
```

- [ ] **Step 2: Store the response total during page loads**

When a page succeeds, normalize the new field and retain it across cached cursor navigation:

```js
if(Number.isFinite(Number(data.totalCount)))state.totalCount=Math.max(0,Number(data.totalCount));
state.pages[pageIndex]={items:items,nextCursor:data.nextCursor||null,hasMore:!!data.hasMore,version:data.version||null};
```

Reset `totalCount` to `null` when filters trigger a reset so stale totals are not displayed during a new request.

- [ ] **Step 3: Replace approximate count rendering**

Use `dsaState.recall.totalCount` for the recall badge and Today action:

```js
var total=Number.isFinite(recallState.totalCount)?recallState.totalCount:0;
button.textContent=total?'Review '+total+' due problem'+(total===1?'':'s'):'Recall complete for today';
progress.textContent=total?'0 of '+total+' reviewed today':'You are caught up.';
```

Remove `dsaCountText` or stop using its `hasMore ? '+' : ''` behavior.

- [ ] **Step 4: Render `Page X of Y` from the filtered total**

Update `dsaPagerHtml`:

```js
var totalPages=Math.max(1,Math.ceil(Number(state.totalCount||0)/dsaPageSize(key)));
return '<button type="button" data-dsa-page="previous" data-dsa-page-key="'+key+'" '+(hasPrevious?'':'disabled')+'>Previous</button><span>Page '+(state.page+1)+' of '+totalPages+'</span><button type="button" data-dsa-page="next" data-dsa-page-key="'+key+'" '+(hasNext?'':'disabled')+'>Next</button>';
```

Keep existing Previous/Next cursor behavior and hide the pager when there is only one page.

- [ ] **Step 5: Run existing DSA UI and build checks**

Run: `npm run test:dsa-ui`

Expected: exit code 0.

Run: `npm run build`

Expected: exit code 0.

- [ ] **Step 6: Commit exact-count UI changes**

```bash
git add index.html
git commit -m "feat: show exact DSA counts and pages"
```

### Task 4: Clarify the recommended Independent Solve action

**Files:**
- Modify: `index.html:978-990`

- [ ] **Step 1: Expose the selected item's queue reason through the existing DTO**

Continue using `nextPracticeAt`, `dueReason`, and `historyStatus` already returned by `toPracticeQueueItem`; do not add prompt or solution fields to the summary.

- [ ] **Step 2: Label the Today action from `summary.nextItem`**

Inside `dsaRenderTodayAction`, update `#dsaStartNextIndependent`:

```js
var next=summary.nextItem,title=next&&(next.title||'').trim();
if(startIndependent){
  startIndependent.textContent=title
    ? (next.nextPracticeAt?'Retry '+title:'Solve '+title+' independently')
    : 'Start an independent solve';
}
```

The existing `dsaStartNextIndependent` click path remains unchanged: it opens that card directly or falls back to the Independent page.

- [ ] **Step 3: Run the existing DSA UI check**

Run: `npm run test:dsa-ui`

Expected: exit code 0.

- [ ] **Step 4: Commit the action-label change**

```bash
git add index.html
git commit -m "feat: name the recommended independent solve"
```

### Task 5: Make the Independent Solve reference collapsible

**Files:**
- Modify: `index.html:372-377`
- Modify: `index.html:622-628`
- Modify: `index.html:1114-1134`

- [ ] **Step 1: Convert the reveal container into an open disclosure**

Wrap all existing reveal sections without renaming their IDs:

```html
<details class="dsa-reveal-box hidden" id="dsaColdDialogRevealBox">
  <summary>Reference solution</summary>
  <div class="dsa-reveal-content" aria-live="polite">
    <div class="dsa-reveal-section"><h3>Reference approach</h3><div class="md" id="dsaColdDialogApproachReveal"></div></div>
    <div class="dsa-reveal-section"><h3>Reference explanation</h3><div class="md" id="dsaColdDialogReferenceReveal"></div></div>
    <div class="dsa-reveal-section"><h3>Reference code</h3><pre id="dsaColdDialogCodeReveal"></pre></div>
    <div class="dsa-reveal-section"><h3>Key insight</h3><div class="md" id="dsaColdDialogInsightReveal"></div></div>
    <div class="dsa-reveal-section"><h3>Recurring trap</h3><div class="md" id="dsaColdDialogTrapReveal"></div></div>
    <div class="dsa-reveal-section"><h3>Saved notes</h3><div class="md" id="dsaColdDialogNotesReveal"></div></div>
  </div>
</details>
```

- [ ] **Step 2: Add disclosure styling**

Keep the existing green reference treatment and add an explicit summary affordance:

```css
.dsa-reveal-box > summary { cursor:pointer; list-style:none; color:var(--dsa-success); font-weight:750; }
.dsa-reveal-box > summary::-webkit-details-marker { display:none; }
.dsa-reveal-box > summary:after { content:'＋'; float:right; }
.dsa-reveal-box[open] > summary:after { content:'−'; }
.dsa-reveal-content { display:grid; gap:12px; padding-top:12px; }
```

- [ ] **Step 3: Open the disclosure only when reveal data first arrives**

When `dsaRevealCold` succeeds, set the disclosure open before rendering:

```js
flow.reveal=data.reveal||{};
flow.revealed=true;
var disclosure=dsa$('dsaColdDialogRevealBox');
if(disclosure)disclosure.open=true;
```

Do not set `.open` inside every `dsaRenderColdDialog` call; otherwise the user could not keep the reference closed while other state rerenders.

- [ ] **Step 4: Run existing checks**

Run: `npm run test:dsa-ui`

Expected: exit code 0.

Run: `npm run build`

Expected: exit code 0 and 12 API entry files.

- [ ] **Step 5: Commit the disclosure behavior**

```bash
git add index.html
git commit -m "feat: collapse independent solve reference"
```

### Task 6: Final verification and branch handoff

**Files:**
- Verify: `lib/db.js`
- Verify: `api/cards.js`
- Verify: `api/cards/due.js`
- Verify: `api/practice.js`
- Verify: `index.html`

- [ ] **Step 1: Run all existing relevant checks without creating tests**

```bash
npm run test:dsa-ui
npm run test:review-pagination
npm run build
```

Expected: all commands exit 0.

- [ ] **Step 2: Inspect the final diff and working tree**

Run: `git diff HEAD~5 --check`

Expected: no whitespace errors.

Run: `git status --short`

Expected: only the pre-existing untracked merge plan may remain.

- [ ] **Step 3: Verify constraints directly**

Run: `find api -type f -name '*.js' | wc -l`

Expected: `12`.

Run: `sed -n '850,1250p' index.html | rg -n "Page .*more available|due problem.*\\+|Review .*\\+ due"`

Expected: no matches in the DSA UI paths.

- [ ] **Step 4: Push the completed `dev` commits**

Run: `git push origin dev`

Expected: `origin/dev` advances to the verified implementation commits.
