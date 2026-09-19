# Runtime and Mobile Modal Fixes

## Scope

Apply a surgical fix to the `dev` branch without changing APIs, persistence, scheduling, or the unfinished LLD/HLD product design.

## Runtime behavior

- Legacy navigation code must tolerate the removed `dueCount` element.
- Optional LLD backup controls must only be bound when their elements exist.
- Switching between DSA and LLD/HLD must not produce application-owned uncaught exceptions.

## Mobile modal behavior

- DSA overlays must render above the fixed mobile navigation.
- The add-problem dialog must use the available mobile width.
- Form controls and grouped fields must collapse to a single full-width column on narrow screens.
- The dialog must remain independently scrollable without its actions being blocked by navigation.

## Non-goals

- No copy changes to the server/status labels.
- No broader DSA or LLD/HLD redesign.
- No API, schema, scheduling, or database changes.
- No new automated regression tests, per the user's request.

## Verification

- Run the existing build and DSA UI contract checks.
- Reopen the deployed or local UI at desktop and mobile widths.
- Confirm the previously observed null-binding errors no longer occur.
- Confirm the mobile bottom navigation no longer covers the modal and controls fill the modal width.
