# Phase 1e — Hobby Function Consolidation

## Scope and source review
- Log created before source edits.
- Reviewed original `api/auth/config.js`, `api/auth/me.js`, `api/auth/claim-legacy.js`, `api/health.js`, `api/migrate.js`, `vercel.json`, `dev-server.js`, plus auth/API helpers.
- Preserved database semantics: the existing authenticated `me` upsert and configured-owner `claim-legacy` upsert/claim sequence and response shape are unchanged. No database connection, deployment, HTTP write, or data import was performed.

## Endpoint preservation
- `GET /api/auth/config` remains public and emits only `{ ok, publishableKey }`; missing publishable key returns its prior 503 response.
- `GET /api/auth/me` remains authenticated and upserts the Clerk user; missing authentication returns the existing safe 401 response.
- `POST /api/auth/claim-legacy` retains its `LEGACY_OWNER_CLERK_ID` 503/403 checks and prior count response `{ claimed: { cards, designs }, oneShot: true }`.
- Auth and system catch-alls accept Vercel catch-all query arrays/strings and local Express URL fallback; all OPTIONS return 204 and unknown actions return 404.
- `GET /api/health` and `/api/migrate` retain public URLs through Vercel rewrites to `/api/system/health` and `/api/system/migrate`. Health remains `{ status: 'ok', databaseConfigured }`; migrate remains disabled with 403.
- `dev-server.js` now loads only the new auth/system catch-all handlers and retains `/api/auth/:action`, `/api/health`, `/api/migrate` plus all other existing routes.

## Function entrypoint verification
```text
api/auth/[...auth].js
api/cards.js
api/cards/[...cardId].js
api/cards/due.js
api/cards/mastered.js
api/designs.js
api/designs/[id].js
api/export.js
api/import.js
api/leetcode/fetch.js
api/stats.js
api/system/[...action].js
```
- Count: **12** JavaScript API entrypoints.
- Confirmed absent: `api/auth/config.js`, `api/auth/me.js`, `api/auth/claim-legacy.js`, `api/health.js`, `api/migrate.js`.

## Checks
- RED check recorded: importing the not-yet-created auth catch-all failed with `ERR_MODULE_NOT_FOUND` before implementation.
- `node --check api/auth/[...auth].js`
- `node --check api/system/[...action].js`
- `node --check dev-server.js`
- `vercel.json` parsed successfully; both exact public rewrites verified.
- Mock handler tests passed: no-config auth config 503; unauthenticated me 401; generic health 200; migrate 403; unknown auth/system 404; OPTIONS auth/system 204.

## Exact app files changed
- Created: `api/auth/[...auth].js`, `api/system/[...action].js`
- Modified: `vercel.json`, `dev-server.js`
- Deleted: `api/auth/config.js`, `api/auth/me.js`, `api/auth/claim-legacy.js`, `api/health.js`, `api/migrate.js`
- Log: `_subagent-logs/phase-1e-hobby-function-consolidation.md`

## File content verified: YES
