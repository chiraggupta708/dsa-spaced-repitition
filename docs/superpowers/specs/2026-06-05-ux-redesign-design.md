# UI/UX Design: Coding Journal

## Overview

Redesign the Coding Journal with a minimal, calm, user-friendly interface combining two UX modes:

- **Browse Mode** (Compact layout) — default view, shows stats + card list
- **Review Mode** (Stepped layout) — wizard-style flow when reviewing cards

Theme toggle: **Light** (Clean White) / **Dark** (Soft Dark)

---

## Browse Mode (default)

### Header
- Compact: "✏️ Coding Journal" + due badge + date
- No large branding, no decorative elements

### Stats bar
- 4 stat cards in a row: Total, Due, Mastered, Streak
- Minimal: number + label, no gradients, no heavy boxes

### Tab bar
- Horizontal pill-style tabs: Due | All | Mastered | + New
- Active tab gets filled background
- + New is an accent pill on the right

### Card list
- Cards are compact: title, tags, difficulty, reps + next review + status
- No expand/collapse arrow — cards open inline
- Expanded state shows code block + thinking notes + right thinking
- Smooth height transition on expand

### Empty states
- Warm copy, no illustrations
- "Nothing due right now. Nice work!" type messages

---

## Review Mode (activated by "Review Now")

### Entry
- User taps "Review Now" from Browse Mode
- View transitions to stepped review flow

### Step flow
1. **Question step**: Show problem title + tags. Large, centered. Think about the approach.
2. **Rating step**: 5 buttons (Forgot / Vague / Fair / Good / Perfect). User taps one.
3. **Reveal step**: Show code block + thinking notes. SM-2 result shown (next review date).
4. **Next step**: "Next Card →" button advances. "End Session" exits.

### Progress
- Thin progress bar at top: current / total cards in session
- Step indicator: "2 / 5"

### Navigation
- Back button returns to Browse Mode (cancels session)
- End Session button exits review at any point
- Session completion shows summary + returns to Browse Mode

---

## Implementation

### Files to modify
- `index.html` — replace entire CSS and JS
- Keep inline JS architecture (single file deploy)

### What stays
- All API endpoints unchanged
- SM-2 algorithm unchanged
- Data model unchanged
- localStorage / Neon DB unchanged

### What changes
- Full CSS rewrite — clean, minimal, two themes
- JS rewrite for review flow — state machine (browse/review/stepped)
- Smooth CSS transitions between modes
- Theme toggle persists in localStorage