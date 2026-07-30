# Phase 1C — Clerk server auth helper + API CORS foundation

## Scope and constraints
- Allowed application writes: `lib/auth.js` (new) and `lib/api.js` only.
- No DB connection, deployment, or HTTP requests were made.
- This log was created before source inspection or edits.

## Pre-edit inspection
- Re-read source: `/Users/chirag/dsa-spaced-repetition/lib/api.js` — existing JSON/CORS convention is `sendJSON(res, statusCode, data)` via `applyCors`.
- Re-read source: `/Users/chirag/dsa-spaced-repetition/lib/auth.js` — confirmed absent before creation.
- Verified installed package: `/Users/chirag/dsa-spaced-repetition/node_modules/@clerk/backend/package.json` reports `@clerk/backend` version `1.34.0`.
- Inspected `/Users/chirag/dsa-spaced-repetition/node_modules/@clerk/backend/dist/tokens/verify.d.ts` and implementation. `verifyToken(token, options)` supports `secretKey` through its verification options, but this version fetches remote JWKS when `jwtKey` is omitted and `secretKey` is supplied. To meet the networkless-verification constraint, implementation requires `CLERK_JWT_KEY` (the Clerk PEM public key) as well as `CLERK_SECRET_KEY`, and calls `verifyToken(token, { secretKey, jwtKey })`. The supplied `jwtKey` takes the local-key branch; no live JWKS is fetched.

## Changes
- Added `/Users/chirag/dsa-spaced-repetition/lib/auth.js`:
  - `getBearerToken(req)` safely accepts only a nonempty Bearer token and raises a typed `AuthError` otherwise.
  - `requireAuth(req)` obtains identity exclusively from verified JWT `sub`, returning `{ userId }` only for a nonempty string.
  - Missing Clerk configuration produces typed `CONFIGURATION` error; all token verification failures are classified as unauthorized without exposing token or secret details.
  - `getAuthErrorResponse(error)` safely maps errors to `{ status, error }`.
- Updated `/Users/chirag/dsa-spaced-repetition/lib/api.js`:
  - Added `Authorization` to `Access-Control-Allow-Headers`.
  - Added `sendAuthError(res, error)`, which uses existing `sendJSON`/CORS conventions and safe auth-error mapping.

## Post-edit source verification
- Re-read exact file: `/Users/chirag/dsa-spaced-repetition/lib/auth.js` — File content verified: YES.
- Re-read exact file: `/Users/chirag/dsa-spaced-repetition/lib/api.js` — File content verified: YES.

## Offline verification
- `node --check lib/auth.js` — PASS.
- `node --check lib/api.js` — PASS.
- Import smoke with `CLERK_SECRET_KEY` and `CLERK_JWT_KEY` unset — PASS:
  - Missing Authorization header maps deterministically to `{"status":401,"error":"Unauthorized."}`.
  - Bearer header with missing Clerk configuration maps to `{"status":503,"error":"Authentication service unavailable."}`.
  - `corsHeaders()['Access-Control-Allow-Headers']` is `Content-Type, Authorization`.
  - `sendAuthError` returned 401 and applied CORS headers for an untrusted error.
- No valid Clerk token verification was attempted or claimed because no Clerk credentials were used.

## Phase 1D route calling convention
```js
import { requireAuth } from '../lib/auth.js';
import { handleOptions, sendAuthError } from '../lib/api.js';

export default async function handler(req, res) {
  if (handleOptions(req, res)) return;

  let auth;
  try {
    auth = await requireAuth(req);
  } catch (error) {
    return sendAuthError(res, error);
  }

  const { userId } = auth;
  // Pass userId to owner-scoped DB operations; never accept it from the client.
}
```

Application files modified: lib/auth.js and lib/api.js only
