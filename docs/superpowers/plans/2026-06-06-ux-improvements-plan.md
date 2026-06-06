# UX Improvements Plan

## Summary
11 UX improvements to make the Coding Journal more user-friendly. These are lower-effort, high-impact changes with no architectural changes.

## Changes (ordered by impact)

### 1. Add Edit button on expanded card view
- **File:** `index.html` — `CJ.renderer.renderCard` override (near bottom of file)
- **What:** Add `<button class="btn-g" onclick="event.stopPropagation();CJ.form.renderForEdit('...')">Edit</button>` next to Delete button in the `.dt` section
- **Note:** Need a helper `CJ.form.renderForEdit(id)` that fetches the card via `CJ.api.getCard(id)` then calls `CJ.form.render(card)`
- **Why:** Currently no way to edit cards from the UI — biggest UX gap

### 2. Cmd+Enter to save form
- **File:** `index.html` — `CJ.form.wire` override (inside the submit handler or a form keydown listener)
- **What:** Add a `keydown` listener on `#cardForm` that detects `e.metaKey && e.key === 'Enter'` (macOS) or `e.ctrlKey && e.key === 'Enter'` and triggers form submit
- **Code sketch:**
  ```js
  document.getElementById('cardForm').addEventListener('keydown', function(e) {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      document.getElementById('fSubmit').click();
    }
  });
  ```
- **Why:** Power users expect this for any form. Low effort, high satisfaction.

### 3. Autofocus first field on form open
- **File:** `index.html` — end of `CJ.form.render` override
- **What:** After the form HTML is set, call `document.getElementById('fQ').focus()`
- **Why:** Reduces one click when creating a card

### 4. Reorder LC URL row to appear below Question field
- **File:** `index.html` — `CJ.form.render` override (the HTML string in CJ.form.render)
- **What:** Move the `<div id="lc-wrap">...</div>` block to appear after `<div id="fg-fQ">` instead of before it
- **Current order:** lc-wrap → fQ → fL → fT → fD → fQDesc → fMyT → fRT → fCode → fNotes
- **Desired order:** fQ → lc-wrap → fL → fT → fD → fQDesc → fMyT → fRT → fCode → fNotes
- **Why:** User should see "what card am I creating" before "what LeetCode URL"

### 5. Loading spinners for API calls
- **File:** `index.html` — `CJ.renderer.refreshTabs`, `renderTab`, `refreshStats`
- **What:** 
  - Add a CSS class `.loading-shim` with a centered spinner
  - Add `<div id="loadingShim" class="hidden"><div class="spinner"></div></div>` to browse mode
  - Show `#loadingShim` before fetch, hide `.then()`
  - Use a simple CSS spinner (already have `.lc-spinner` animation in CSS)
- **Why:** Prevents blank-screen confusion during slow networks

### 6. Better empty state for filtered searches
- **File:** `index.html` — `CJ.renderer.renderCardList` override
- **What:** When filters are active (query, tags, difficulty, status) and results are empty, show specific message like "No cards match your search" instead of tab-specific empty state
- **Code sketch:** Check `S.query || S.selectedTags.length || S.selectedDifficulty || S.selectedStatus` — if any active, use filter-specific empty text
- **Why:** Reduces confusion when search returns nothing

### 7. Save & Add Another button
- **File:** `index.html` — `CJ.form.render` and submit handler
- **What:** 
  - Add a secondary submit button "Save & Add Another" alongside the primary save button
  - After save, instead of switching to 'all' tab, re-render a clean form
  - Button text: `Save & Add Another`
- **Why:** Makes bulk entry much faster

### 8. Confirm before ending review session
- **File:** `index.html` — `CJ.review.end` 
- **What:** If `state.active && state.cards.length > 0 && state.idx < state.cards.length`, show a `confirm()` dialog before ending
- **Why:** Prevents accidental loss of review progress

### 9. Confirm before delete (use modal instead of confirm)
- **File:** `index.html` — `CJ.renderer.del`
- **What:** Already uses `confirm()`, which is fine for now. Low priority.

### 10. Review mode touch/swipe support
- **File:** `index.html` — review mode
- **What:** Add touch event listeners to `#rvRatings` area — horizontal swipe maps to rating (1-5 based on swipe %)
- **Complexity:** Medium, requires touch start/move/end tracking
- **Note:** Can skip for now, lower priority

### 11. Autosave draft in form
- **File:** `index.html` — form
- **What:** Save form state to localStorage on each input change, restore on form open if no card is loaded
- **Complexity:** Medium, requires debounced writes
- **Note:** Nice-to-have, can skip for now

## Priority Implementation Order
High (must do): 1, 2, 3, 4, 5
Medium (should do): 6, 7, 8
Low (nice to have): 9, 10, 11

## Implementation Notes
- All changes go in `index.html` (single-file SPA)
- The `index.html` is ~81KB — be careful with string manipulation
- Always use the build script pattern for large writes (write to `/tmp/`, then `node /tmp/build_xxx.js`)
- After changes, start dev server (`node -r dotenv/config dev-server.js`) and verify page loads without console errors
- The `dev` branch is the work branch — commit to `dev` only, do NOT merge to `main`
- Run `git log --oneline -5` to see recent commit style before committing
