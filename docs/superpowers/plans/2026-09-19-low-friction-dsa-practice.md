# Low-Friction DSA Practice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the DSA workspace into a one-click daily recall flow with a distinct, low-friction Independent Solve mode and Library-only editing.

**Architecture:** Keep the existing single-page application and APIs. Consolidate whole-surface visibility in the DSA surface controller, reuse `/api/cards/*` for recall and `/api/practice` for independent attempts/history, and make presentation-only changes in `index.html`. SM-2 remains queue authority and FSRS remains shadow-only.

**Tech Stack:** Static HTML/CSS/JavaScript SPA, Vercel serverless functions, Clerk authentication, Neon PostgreSQL, existing SM-2 and `ts-fsrs` scheduling.

**Testing constraint:** Per user approval, add no new automated regression tests. Run the existing build and contract suite plus focused browser checks.

---

## File map

- Modify `index.html` — DSA layout, copy, styles, surface ownership, recall workflow, Independent Solve workflow, progressive capture, and history presentation.
- Modify `docs/superpowers/plans/2026-09-19-low-friction-dsa-practice.md` — check off completed work during execution.
- Do not create or modify files under `api/`; the repository already has 12 Vercel serverless entry files.
- Do not modify scheduling, database, Clerk, or schema files.

### Task 1: Establish one DSA surface owner and learner-facing navigation

**Files:**
- Modify: `index.html:450-590`
- Modify: `index.html:767`
- Modify: `index.html:1041-1070`

- [ ] **Step 1: Rename “Cold solve” to “Independent Solve” everywhere in the approved DSA navigation and headings**

Use this vocabulary consistently:

```html
<button type="button" class="dsa-nav-button" data-dsa-nav="cold">
  <span>Independent Solve</span><span class="nav-count" id="dsaSidebarColdCount">0</span>
</button>
```

The mobile label is `Independent`, and supporting copy uses “first independent solve” or “scheduled independent solve,” never “cold review,” “cold solve,” or “checkpoint” as a top-level product name.

- [ ] **Step 2: Remove implementation-language labels from the daily interface**

Delete `dsa-boundary-note` and `dsa-section-label` instances that say `Server-owned data`, `server-ordered`, `bounded server pages`, or `one selected prompt at a time`. Keep status regions for loading and errors.

Add this non-interactive row inside the Settings & data menu:

```html
<span class="dsa-settings-note">Scheduler: SM-2 · FSRS comparison running</span>
```

- [ ] **Step 3: Make `dsaActivateSurface` the only owner of legacy DSA visibility**

Add a helper and call it from both the DSA controller and `lldSurface`:

```js
function dsaSetLegacyVisibility(visible){
  document.querySelectorAll('.review-panel,.overview,.content-head,.filters,#content,#cardPagination')
    .forEach(function(element){dsaSetHidden(element,!visible)});
}
```

When leaving LLD, `lldSurface(false)` must not unhide legacy elements if `#appShell` has `dsa-approved-active`. This removes the timeout/listener race that currently reveals duplicate legacy content below the approved DSA workspace.

- [ ] **Step 4: Run build verification and commit**

Run: `npm run build`

Expected: exit 0 with build verification passing.

Commit:

```bash
git add index.html
git commit -m "fix: centralize DSA surface visibility"
```

### Task 2: Make Today queue-first with one primary action

**Files:**
- Modify: `index.html:490-545`
- Modify: `index.html:250-335`
- Modify: `index.html:950-1040`

- [ ] **Step 1: Replace the dashboard-first summary with a primary Today action**

Add this structure before the due list:

```html
<section class="dsa-today-action" aria-labelledby="dsaTodayActionTitle">
  <div>
    <p class="eyebrow">Today’s recall</p>
    <h2 id="dsaTodayActionTitle">Keep the approaches fresh</h2>
    <p id="dsaTodayProgress">Checking what is due…</p>
  </div>
  <button type="button" class="primary dsa-review-all" id="dsaReviewDue">Review due problems</button>
</section>
```

Keep compact counts, but rename them to `due for recall`, `scheduled independent`, and `saved problems`.

- [ ] **Step 2: Render the CTA from the loaded recall page**

Add a renderer that uses the current server page:

```js
function dsaRenderTodayAction(){
  var page=dsaState.recall.pages[dsaState.recall.page];
  var count=page&&Array.isArray(page.items)?page.items.length:0;
  var button=dsa$('dsaReviewDue'),progress=dsa$('dsaTodayProgress');
  if(button){
    button.textContent=count?'Review '+count+(page&&page.hasMore?'+':'')+' due problem'+(count===1?'':'s'):'Recall complete for today';
    button.disabled=!count;
  }
  if(progress)progress.textContent=count?'0 of '+count+(page&&page.hasMore?'+':'')+' reviewed today':'You are caught up.';
}
```

Call it after recall loading/rendering. The CTA starts the server-ordered batch through the existing `window.__cjStartReview` bridge, using the first due card or the existing batch entry point.

- [ ] **Step 3: Keep Independent Solve secondary**

Replace the large second Today section with a compact secondary action that opens the Independent Solve view. Show separate text for scheduled attempts and first independent attempts so `0 scheduled · 10 ready for first solve` is understandable.

- [ ] **Step 4: Hide successful status chatter**

After successful summary/list loads, clear the live banner instead of leaving messages such as `Practice summary updated.` Keep loading, error, and retry messages.

- [ ] **Step 5: Run build verification and commit**

Run: `npm run build`

Expected: exit 0.

Commit:

```bash
git add index.html
git commit -m "feat: make Today a one-click recall queue"
```

### Task 3: Simplify Recall Review and preserve scheduler semantics

**Files:**
- Modify: `index.html:681`
- Modify: `index.html:724-732`
- Modify: `index.html:400-445`

- [ ] **Step 1: Remove the `Solved from scratch` control from Recall Review**

Delete the `practice-credit` checkbox block. Recall Review must submit:

```js
body: JSON.stringify({
  rating: state.rating,
  idempotencyKey: pending.idempotencyKey,
  solvedFromScratch: false
})
```

This keeps independent-solve history separate while continuing to record SM-2 plus FSRS shadow transitions.

- [ ] **Step 2: Make the problem/reveal hierarchy compact**

Keep the prompt rendered with `renderMarkdown`. Place saved approach and explanation first, and wrap optional code and notes in collapsed `<details>` elements. Change the action label to **Reveal answer**.

- [ ] **Step 3: Track session results and show completion inside the dialog**

Extend review state with a rating tally:

```js
state.reviewResults={again:0,hard:0,good:0,easy:0};
```

Increment only after a successful response. At the end, replace the recall body with a summary showing total reviewed and non-zero rating counts, plus a **Done** button. Do not expose raw SM-2 or FSRS calculations.

- [ ] **Step 4: Keep mobile actions reachable**

Raise `#reviewDialog` above the mobile navigation and make `.review-foot` sticky inside the dialog:

```css
#reviewDialog { z-index: 30; }
.review-card { max-height: calc(100dvh - 28px); overflow: auto; }
.review-foot { position: sticky; bottom: 0; z-index: 2; background: var(--surface); }
```

- [ ] **Step 5: Run build verification and commit**

Run: `npm run build`

Expected: exit 0.

Commit:

```bash
git add index.html
git commit -m "feat: streamline recall review sessions"
```

### Task 4: Reduce Independent Solve to outcome plus optional reflection

**Files:**
- Modify: `index.html:590-632`
- Modify: `index.html:1087-1114`
- Modify: `index.html:1150-1180`

- [ ] **Step 1: Replace the mandatory-looking challenge form with one disclosure**

Use one optional field backed by the existing `reflection` property:

```html
<details class="dsa-reflection-disclosure">
  <summary>Add reflection <span>(optional)</span></summary>
  <div class="dsa-field">
    <label for="dsaColdDialogReflection">What were you thinking?</label>
    <textarea id="dsaColdDialogReflection" maxlength="2000"
      placeholder="Capture what worked, what confused you, or what you want to remember."></textarea>
  </div>
</details>
```

Remove the visible approach, invariant, complexity, and blocker controls. Do not require code entry.

- [ ] **Step 2: Rename outcomes without changing stored values**

Keep API values compatible while presenting plain labels:

```text
independent → Solved
hinted      → Needed a hint
unfinished  → Couldn’t solve
```

The payload remains:

```js
{
  idempotencyKey: flow.idempotencyKey,
  outcome: flow.outcome,
  reflection: flow.reflection,
  blocker: '',
  challenge: {approach:'',invariant:'',complexity:''}
}
```

- [ ] **Step 3: Render the prompt and saved material as Markdown**

Use the existing sanitized `renderMarkdown` helper for the problem prompt and textual reveal fields. Keep code in `<pre>` and reveal saved material only after an outcome has been successfully recorded.

- [ ] **Step 4: Preserve retry state**

On submission failure, keep the selected outcome and optional reflection in `dsaState.coldFlow`, re-enable Save, and reuse the same idempotency key on retry.

- [ ] **Step 5: Run build verification and commit**

Run: `npm run build`

Expected: exit 0.

Commit:

```bash
git add index.html
git commit -m "feat: simplify independent solve attempts"
```

### Task 5: Make the Library the only editing surface

**Files:**
- Modify: `index.html:540-585`
- Modify: `index.html:633-680`
- Modify: `index.html:1116-1145`

- [ ] **Step 1: Clarify Library actions**

Each Library row exposes **Open**, **Edit**, and **Solve independently**. Recall and Independent Solve reveal views remain read-only. Editing continues through the existing card editor bridge rather than a new endpoint.

- [ ] **Step 2: Simplify history language and details**

Render newest-first existing attempt history with user-facing outcomes:

```js
var dsaOutcomeLabel={independent:'Solved',hinted:'Needed a hint',unfinished:'Couldn’t solve'};
```

History rows show outcome, attempt date, and next practice. Attempt detail shows only Outcome, Recorded, and Reflection; omit empty legacy challenge fields. Attempts remain immutable.

- [ ] **Step 3: Make Add Problem progressive**

Keep title, URL, difficulty, and tags visible. Wrap description, approach, reference explanation, code, notes, insight, trap, and optional initial outcome in:

```html
<details class="dsa-capture-details">
  <summary>Add details <span>(optional)</span></summary>
  <div class="dsa-capture-details-body"></div>
</details>
```

Move the complete existing field nodes with IDs `dsaCaptureDescription`, `dsaCaptureApproach`, `dsaCaptureReference`, `dsaCaptureCode`, `dsaCaptureNotes`, `dsaCaptureInsight`, `dsaCaptureTrap`, and `dsaCaptureOutcome`, plus `dsaCaptureOutcomeCopy`, inside `dsa-capture-details-body` without changing their `data-dsa-capture` names.

Use **Save for later** as the default submit label. Do not add another endpoint or browser-local draft.

- [ ] **Step 4: Run build verification and commit**

Run: `npm run build`

Expected: exit 0.

Commit:

```bash
git add index.html
git commit -m "feat: focus DSA editing in the problem library"
```

### Task 6: Verify the complete workflow and deployment constraints

**Files:**
- Modify: `docs/superpowers/plans/2026-09-19-low-friction-dsa-practice.md`

- [ ] **Step 1: Run all existing automated checks**

Run:

```bash
npm run build
for script in $(node -e "const p=require('./package.json'); console.log(Object.keys(p.scripts).filter(k=>k.startsWith('test:')).join(' '))"); do npm run "$script"; done
```

Expected: build and every existing contract script exit 0.

- [ ] **Step 2: Verify the Vercel API budget**

Run:

```bash
find api -type f \( -name '*.js' -o -name '*.ts' -o -name '*.mjs' \) | wc -l
```

Expected: `12` or fewer.

- [ ] **Step 3: Perform authenticated desktop and mobile browser checks**

Verify:

- Today shows one primary `Review N due problems` action.
- Recall reveal is read-only, submits `solvedFromScratch: false`, advances, and ends with a summary.
- Independent Solve asks only for an outcome plus optional reflection; saved reflection appears in that problem’s history.
- Problem statements and saved explanations render Markdown.
- Add Problem starts compact and reveals optional details on demand.
- Switching DSA → LLD → DSA never reveals the legacy DSA content.
- All DSA dialogs sit above mobile navigation at 390×844 and remain scrollable.
- Daily practice contains no server-ordering or scheduler jargon; Settings shows `Scheduler: SM-2 · FSRS comparison running`.

- [ ] **Step 4: Commit plan completion**

```bash
git add docs/superpowers/plans/2026-09-19-low-friction-dsa-practice.md
git commit -m "docs: complete low-friction DSA implementation plan"
```

- [ ] **Step 5: Push `dev` and review the resulting Vercel deployment**

Run: `git push origin dev`

Expected: the remote `dev` branch accepts all commits. Open the resulting Vercel preview, authenticate, and repeat the focused smoke checks before reporting completion.
