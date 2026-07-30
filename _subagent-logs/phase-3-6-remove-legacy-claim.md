# Phase 3.6 — Remove Legacy Owner Claim

## Scope and Safety
- Code/UI removal only.
- No database access or mutation was performed: no data was read, modified, deleted, imported, or claimed in any dev or production database.
- No deploy, schema, environment, package, other API, or dev-server changes were made.
- Legacy `owner_id IS NULL` rows intentionally remain untouched and hidden; the selected migration path is a verified backup import after sign-in.

## Files Read Before Editing
- `/Users/chirag/dsa-spaced-repetition/index.html`
- `/Users/chirag/dsa-spaced-repetition/api/auth/[...auth].js`
- `/Users/chirag/dsa-spaced-repetition/lib/db.js`

## Changes
- `/Users/chirag/dsa-spaced-repetition/index.html`
  - Removed the authenticated legacy claim panel, button, status UI, related styles, `claimLegacy` functions, and click binding.
  - Preserved sign-in, Clerk user button, Add, review, import/export, delete, styles, and remaining app behavior.
- `/Users/chirag/dsa-spaced-repetition/api/auth/[...auth].js`
  - Removed `claim-legacy` routing and `claimLegacyContent` import.
  - Removed all `LEGACY_OWNER_CLERK_ID` handling.
  - Only `config` and `me` are supported; `claim-legacy` now follows the normal 404 path.
- `/Users/chirag/dsa-spaced-repetition/lib/db.js`
  - Removed `claimLegacyContent` and its unowned-row update queries.
  - Retained owner-scoped `replaceCardsForOwner`; its delete remains constrained by `owner_id`.

## Verification
- Re-read all three changed application files after editing: YES.
- `node --check api/auth/[...auth].js`: PASS.
- `node --check lib/db.js`: PASS.
- Extracted and checked every inline script in `index.html`: 1 script, PASS.
- Balanced `<div>` validation: PASS.
- Static scan of the three application files for `claimLegacy`, `claim-legacy`, `LEGACY_OWNER_CLERK_ID`, and `claimLegacyContent`: PASS (no matches).
- In-process route check: `POST /api/auth/claim-legacy` returned normal 404: PASS.
- `npm run build` was executed with `DATABASE_URL`, `POSTGRES_URL`, and `POSTGRES_PRISMA_URL` explicitly unset to prevent database access: PASS; setup script reported schema setup skipped.
- Hobby API function count: 12 (within the <=12 limit).
- Real sign-in or import data flow was NOT tested.

## Exact Application Files Modified
- `/Users/chirag/dsa-spaced-repetition/index.html`
- `/Users/chirag/dsa-spaced-repetition/api/auth/[...auth].js`
- `/Users/chirag/dsa-spaced-repetition/lib/db.js`

## File content verified: YES
