# UX Improvements — Round 2

## Summary
6 UX improvements to the Coding Journal SPA. All changes go into `index.html`.

## Items

### 1. Global keyboard shortcuts
- **When:** App is in browse mode (not review, not adding card)
- **Shortcuts:**
  - `N` → open new card form (click `+ New` button)
  - `S` → focus search input (`#cjSearch`)
  - `R` → start review session (click `Review Now →` button)
- **Where:** In the DOMContentLoaded event listener (bottom of first long script section), add keydown listener that checks `!isReviewing()` and mode state
- **Note:** Don't interfere with typing in input fields — check `e.target.tagName` isn't `INPUT`, `TEXTAREA`, `SELECT`

### 2. Remember last tab
- **Where:** `CJ.renderer.switchTab`
- **What:** After switching tab, save `CJ.renderer.tab` to `localStorage.setItem('cj-last-tab', tab)`
- **What:** On page load (DOMContentLoaded), read from localStorage and call `switchTab(savedTab)` instead of defaulting to 'due'
- **Note:** Only do this if the stored tab is a valid tab name ('due', 'all', 'mastered')

### 3. Auto-resizing textareas
- **Where:** CSS + CJ.form.wire
- **CSS:** Add `textarea.auto-resize{overflow:hidden;resize:none}` and a rule to allow `min-height`
- **JS:** Add a helper: set `el.style.height = 'auto'; el.style.height = el.scrollHeight + 'px'`
- **Wire:** In `CJ.form.wire`, after form is rendered, query all textareas and attach `input` event listener for auto-resize
- **Note:** Don't remove the `resize:vertical` entirely — keep manual resize as an option. Just auto-grow on input

### 4. Undo delete
- **Where:** `CJ.renderer.del`
- **What:** Instead of `confirm()` + immediate delete, show a toast with "Undo" button that stays for 5 seconds. After 5 seconds, do the actual delete.
- **Implementation:**
  - `CJ.showUndoToast(message, undoCallback, timeoutMs)` — shows toast with Undo button
  - On undo click: clear the timeout, hide toast
  - On timeout: execute the delete, call the callback
- **Note:** The toast already exists — modify `CJ.showToast` to support an undo action, or add a separate `CJ.showUndoableAction` function

### 5. Content width increase
- **Where:** CSS `.app` class (line 103)
- **What:** Change `max-width: 680px` to `max-width: 960px`
- **Why:** Better use of modern screen real estate without losing readability
- **Also:** Adjust the responsive breakpoint from `620px` to match

### 6. Duplicate card button
- **Where:** `CJ.renderer.renderCard` override (the `.dt` section)
- **What:** Add a "Duplicate" button next to "Edit" and "Delete" in the expanded card view
- **What it does:** Calls `CJ.form.render(cardClone)` where `cardClone` is the existing card but with `id` set to null and title appended " (copy)"
- **Helper:** `CJ.form.duplicateCard = function(card) { var clone = JSON.parse(JSON.stringify(card)); delete clone.id; if(clone.question) clone.question += ' (copy)'; if(clone.title) clone.title += ' (copy)'; CJ.form.render(clone); }`

## Files
- `index.html` — all changes (CSS + JS inline)
- `test/api-test.js` — any new tests needed for the changes

## Implementation Order (sequential in one file)
1. Content width (simplest, pure CSS)
2. Auto-resizing textareas (CSS + small JS)
3. Remember last tab (localStorage + DOMContentLoaded)
4. Global keyboard shortcuts (keydown listener)
5. Undo delete (toast modification)
6. Duplicate card (card rendering + helper)