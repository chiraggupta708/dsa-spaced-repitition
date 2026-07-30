# Phase 1D System Auth Build Log

- Started: Phase 1D-SYSTEM scoped hardening.
- Exclusive write allowlist acknowledged.
- No DB operations, deploys, production/dev HTTP write calls, endpoint imports, or destructive git actions were run.
- Initial log created before source inspection: YES.

## Changes
- `api/designs.js`: handles OPTIONS first, authenticates all other requests, uses the verified `userId` for owner-scoped design reads/writes, preserves `kind`/`tag` filters and title validation, and provisions write users with `upsertUser({ clerkId: userId })`.
- `api/designs/[id].js`: handles OPTIONS first, authenticates all other requests, passes only verified `userId` to owner-scoped get/save/delete functions, and provisions PUT/DELETE users before writes.
- `api/leetcode/fetch.js`: authenticates before method/body validation and existing LeetCode fetch logic; existing validation and upstream error mapping remain unchanged.
- `api/migrate.js`: removed global database migration path; every non-OPTIONS request returns 403 with the required disabled response.
- `api/health.js`: remains public and reports only generic status plus database configuration boolean; no data reads or count fields remain.
- `dev-server.js`: dynamically routes auth config, current-user, and legacy-claim endpoints while retaining existing routes.

## Verification
- `node --check` passed for every changed JavaScript file, including `dev-server.js`.
- Handler mocks without Authorization returned 401 `Unauthorized.` for designs collection, design item, and LeetCode fetch routes.
- Migrate POST handler mock returned 403 `{ ok: false, error: 'Migration endpoint is disabled.' }`.
- Health GET handler mock returned only `status` and `databaseConfigured`; no cards/designs/users/count fields leaked.
- No valid-token claim was attempted.

## File verification
- All changed files were read before editing and re-read from disk after editing: YES.
- File content verified: YES.

## Exact app files modified
- `api/designs.js`
- `api/designs/[id].js`
- `api/leetcode/fetch.js`
- `api/migrate.js`
- `api/health.js`
- `dev-server.js`
