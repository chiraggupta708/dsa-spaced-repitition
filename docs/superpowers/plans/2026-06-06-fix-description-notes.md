# Fix: LeetCode Description Should Not Go Into Notes

## Problem

The `CJ.form.fetchLeetCode` function writes the problem description to **both** the `fNotes` textarea (visible notes field) and the hidden `fQDesc` input field.

```
fetch → fNotes.value = description  (WRONG - pollutes user's notes)
fetch → fQDesc.value = description  (RIGHT - stored as questionDescription)
```

This causes:
- Notes field gets filled with the problem statement instead of staying empty for the user's own observations
- If user already wrote notes, the description is prepended with a `---` separator, which is noisy
- `questionDescription` field is also set correctly, so card/review views show the description fine — but notes is polluted

## Fix

**File:** `coding-journal-vercel/index.html` — the `CJ.form.fetchLeetCode` function

**Change:** Remove the block that writes description to `fNotes`. Keep only the `fQDesc` assignment.

### Current code (lines ~1447):

```js
// DELETE THIS ENTIRE BLOCK:
if (fNotes) {
    var existingNotes = fNotes.value.trim();
    fNotes.value = d.description || '';
    if (existingNotes) {
        fNotes.value += '\n\n---\n\n' + existingNotes;
    }
}

// KEEP THIS:
var fQDesc = document.getElementById('fQDesc');
if (fQDesc) fQDesc.value = d.description || '';
```

### After fix:

```js
// Only set the hidden field, NOT the notes textarea
var fQDesc = document.getElementById('fQDesc');
if (fQDesc) fQDesc.value = d.description || '';
```

## Verification

1. Open app, go to +New tab
2. Fetch a LeetCode problem (e.g. Two Sum)
3. **Notes field** should be empty / unchanged (user's own space)
4. **questionDescription** should still be set (verify by saving the card, expanding it — description should show at top)
5. **Review mode** should still show the description on the question side
6. Edit an existing card with a saved description — populate should still fill the hidden field correctly

## Files Changed

- Modify: `coding-journal-vercel/index.html`

## Testing

No backend or test changes needed — this is purely a frontend fix. The `questionDescription` field is already stored/loaded correctly. The card view and review mode already read from `questionDescription`, not from `notes`. So removing the notes assignment won't affect anything else.