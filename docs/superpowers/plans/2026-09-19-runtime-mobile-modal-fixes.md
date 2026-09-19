# Runtime and Mobile Modal Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the observed null-binding runtime errors and make the DSA capture modal usable at mobile widths.

**Architecture:** Keep the existing single-file frontend and apply a surgical compatibility fix. Optional legacy controls will be bound only when present, while the capture dialog receives the same stacking and responsive field treatment as the DSA overlay system without changing its existing dialog wiring.

**Tech Stack:** Vanilla HTML, CSS, and JavaScript in `index.html`; existing Node verification scripts.

---

### Task 1: Make legacy DOM bindings optional

**Files:**
- Modify: `index.html:703`
- Modify: `index.html:834`

- [x] **Step 1: Guard the removed due counter**

Replace the unconditional `dueCount` update in `updateNav()` with:

```js
var dueCount=$('dueCount');
if(dueCount)dueCount.textContent=String(state.due.length);
```

- [x] **Step 2: Guard optional backup controls**

Replace the unconditional LLD backup bindings with:

```js
var exportBackup=l$('exportBackup'),backupInput=l$('backupInput');
if(exportBackup)exportBackup.onclick=backupExport;
if(backupInput)backupInput.onchange=backupImport;
```

### Task 2: Apply mobile-safe capture dialog styling

**Files:**
- Modify: `index.html:250-252`
- Modify: `index.html:327-328`
- Modify: `index.html:340-343`

- [x] **Step 1: Raise the capture dialog above mobile navigation**

Give the existing capture dialog an explicit stacking override while retaining its current markup and JavaScript behavior:

```css
#dsaCaptureDialog { z-index: 30; }
```

- [x] **Step 2: Include selects in DSA overlay control styling**

Add `.dsa-approved-overlay select` beside the existing input and textarea selectors for typography, focus, and full-width field styling.

- [x] **Step 3: Give capture fields full-width responsive styling**

Apply the overlay control treatment directly to the existing capture dialog, including a useful textarea height. Keep the existing mobile rule:

```css
.dsa-modal-body .form-grid { grid-template-columns: 1fr; }
```

The dialog-specific controls fill their containers, while `z-index: 30` places the modal above the mobile navigation at `z-index: 25`.

### Task 3: Verify existing contracts and rendered behavior

**Files:**
- Verify: `index.html`

- [x] **Step 1: Run existing source checks**

```bash
npm run build
npm run test:dsa-ui
```

Expected: both commands exit 0.

- [x] **Step 2: Inspect the diff**

```bash
git diff --check
git diff -- index.html
```

Expected: no whitespace errors and only scoped runtime/modal changes.

- [ ] **Step 3: Verify in the browser**

At desktop and 390×844 mobile viewports, confirm that switching DSA/LLD does not emit the two application-owned null errors, the capture modal covers the mobile navigation, and its fields fill the available width.

- [ ] **Step 4: Commit the implementation**

```bash
git add index.html docs/superpowers/plans/2026-09-19-runtime-mobile-modal-fixes.md
git commit -m "fix: stabilize navigation and mobile capture modal"
```
