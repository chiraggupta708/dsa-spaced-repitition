# Phase 7 — Legacy import ID-collision fix

**Status:** Complete — source-only implementation and local verification.

## Scope and safety boundary

- Allowed writes used only: `lib/db.js`, `api/import.js`, this log, and `scripts/test-legacy-import-contract.mjs`.
- No schema, frontend, auth helper, package/config, deployment config, or unrelated route was changed.
- No real database, Vercel deployment, or HTTP endpoint was accessed.
- No commit or push was performed.
- Pre-existing unrelated working-tree changes were left untouched.

## Confirmed root cause (source inspection)

- Normal `upsertCard` in `lib/db.js` uses `ON CONFLICT (id) DO UPDATE` with `WHERE cards.owner_id = EXCLUDED.owner_id`.
- A legacy collision with `cards.owner_id IS NULL` does not satisfy that equality, so PostgreSQL returns no row from `RETURNING id` and the import stops at that card.
- `replaceCardsForOwner` had delegated every import card to normal `upsertCard`.
- `api/import.js` had authenticated the request but not provisioned its JWT-derived owner in `users` before a non-empty owner-backed import.

## Implemented behavior

- Kept normal `upsertCard` unchanged: normal create/edit/review cannot update a row belonging to another user or an unowned legacy row.
- Added private `upsertImportedCard`, used only by `replaceCardsForOwner`. A post-change source call-site scan found `replaceCardsForOwner` only in `api/import.js` and `lib/db.js`, and `upsertImportedCard` only in `lib/db.js`. Its conflict update assigns `owner_id = EXCLUDED.owner_id` and is limited to:
  ```sql
  WHERE (cards.owner_id = EXCLUDED.owner_id OR cards.owner_id IS NULL)
  ```
  Therefore a non-null row owned by a different user is not overwritten, while an exact conflicting legacy ID can be transferred to the authenticated import owner.
- Tag replacement remains after the successful ownership/data upsert; a rejected different-owner collision throws before tags are changed.
- Authenticated `POST /api/import` now calls `upsertUser({ clerkId: userId })` before a non-empty replace operation. The call is guarded by `body.cards.length > 0`, so an empty import makes no user or card database write; `replaceCardsForOwner` retains its existing empty-array no-op and non-empty owner-scoped delete.

## Exact files changed

1. `lib/db.js` — added import-only legacy collision upsert and made `replaceCardsForOwner` use it.
2. `api/import.js` — imports/provisions `upsertUser` before a non-empty replace.
3. `scripts/test-legacy-import-contract.mjs` — created dependency-free source contract test.
4. `_subagent-logs/phase-7-legacy-import-collision.md` — created this log.

## Local verification

### TDD baseline (before production edit)

`node scripts/test-legacy-import-contract.mjs` exited `1` because the expected import-only helper did not yet exist. This was the intended RED state.

### Final contract test

Command:
```sh
node scripts/test-legacy-import-contract.mjs
```

Output:
```text
PASS normal upsert cannot claim unowned legacy rows
PASS legacy import upsert claims only an exact unowned collision and assigns owner
PASS owner replacement uses the import-only upsert and preserves owner-scoped deletion/no-op guard
PASS authenticated import provisions the verified owner before replacing cards
Legacy import collision source contract passed.
```

The contract reads source and asserts normal-upsert isolation, the exact-ID `NULL`-owner import condition plus owner assignment, post-upsert tag replacement, owner-scoped/non-empty deletion behavior, empty-import guard, and JWT-authenticated user provisioning before replacement.

### Syntax, build, and diff checks

- `node --check lib/db.js && node --check api/import.js && node --check scripts/test-legacy-import-contract.mjs` — exit `0` (no output).
- `env -u DATABASE_URL -u POSTGRES_URL -u POSTGRES_PRISMA_URL npm run build` — exit `0`:
  ```text
  > coding-journal@1.0.0 build
  > node scripts/setup-db.mjs

  [setup-db] DATABASE_URL not set — skipping schema setup.
  ```
- `git diff --check` — exit `0` (no whitespace errors).
- Post-write source reread completed for `lib/db.js`, `api/import.js`, and `scripts/test-legacy-import-contract.mjs`.

## Untested live verification (intentionally)

No live PostgreSQL/Neon round trip, production data import, Vercel deployment, or HTTP request was performed. The local contract validates generated source structure and ownership guards; a real database flow remains untested by design.

File content verified: YES
