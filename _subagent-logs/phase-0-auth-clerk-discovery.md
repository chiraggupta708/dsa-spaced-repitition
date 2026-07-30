# Phase 0B — Clerk auth discovery (READ-ONLY)

**Status:** complete
**Date:** 2026-07-29
**Scope:** Google sign-in via Clerk for vanilla HTML + JWT verify on Vercel Node serverless
**Workspace:** `/Users/chirag/dsa-spaced-repetition`
**Application files modified:** NONE
**Exclusive write path:** this log only

**Docs snapshot (July 2026):**
- JS frontend quickstart: https://clerk.com/docs/js-frontend/getting-started/quickstart
- Making authenticated requests: https://clerk.com/docs/guides/development/making-requests
- `verifyToken()`: https://clerk.com/docs/reference/backend/verify-token
- `authenticateRequest()`: https://clerk.com/docs/reference/backend/authenticate-request
- Env vars: https://clerk.com/docs/guides/development/clerk-environment-variables
- Google SSO: https://clerk.com/docs/guides/configure/auth-strategies/social-connections/google
- Clerk class: https://clerk.com/docs/js-frontend/reference/objects/clerk
- Companion repo: https://github.com/clerk/clerk-javascript-quickstart (`with-script-tag` branch for CDN)

---

## Constraints / context

- ESM (`"type": "module"`), engines `node 20.x`
- Dev server: Express (`dev-server.js`); legacy Node HTTP also in `server.js`
- API handlers: Vercel-style `(req, res)` default exports under `api/`
- Shared helpers: `lib/api.js` (`corsHeaders`, `handleOptions`, `sendJSON`, `getBody`)
- Publishable key via small `/api/auth/config` is an **acceptable** pattern
- No friends this pass
- No production credentials in this log (names only)
- Do **not** rewrite app to Next.js — calm login shell on existing vanilla `index.html`

---

## Repo snapshot (package / layout)

### package.json

- **name:** `coding-journal`
- **type:** `module`
- **engines.node:** `20.x`
- **dependencies:**
  - `@clerk/backend`: `^1.34.0` ✅ already present
  - `@neondatabase/serverless`: `^1.1.0`
- **devDependencies:** `express` `^4.22.2`
- **scripts:** `start` → `node server.js`; `build` → `node scripts/setup-db.mjs`

### Installed version (lockfile / node_modules)

| Package | package.json | Resolved (lock / node_modules) |
| --- | --- | --- |
| `@clerk/backend` | `^1.34.0` | **`1.34.0`** (`@clerk/backend-1.34.0.tgz`) |
| `@clerk/shared` (transitive) | — | `3.47.8` |
| `@clerk/types` (transitive) | — | `4.101.26` |

### Import path notes for `@clerk/backend` (v1.34.0)

**Package exports** (from installed `package.json`):

```text
"."          → dist/index.mjs   (ESM import)
"./errors"   → dist/errors.mjs
"./internal" → dist/internal.mjs
"./jwt"      → dist/jwt/index.mjs
"./webhooks" → dist/webhooks.mjs
```

**Public named exports from `@clerk/backend` (runtime checked):**

```js
import { createClerkClient, verifyToken } from '@clerk/backend';
// also type exports: ClerkOptions, ClerkClient, VerifyTokenOptions, AuthObject, resources, …
```

| API | How to get it in v1.34.0 |
| --- | --- |
| `verifyToken(token, options)` | **Top-level** import from `@clerk/backend` |
| `createClerkClient(options)` | **Top-level** import; returns client |
| `authenticateRequest(request, options?)` | **On client:** `createClerkClient({…}).authenticateRequest(…)` — **not** a top-level named export of `dist/index.mjs` |
| Types `RequestState`, etc. | Available via types / `@clerk/backend/internal` |

**Recommended ESM usage for this repo:**

```js
import { createClerkClient, verifyToken } from '@clerk/backend';

const clerk = createClerkClient({
  secretKey: process.env.CLERK_SECRET_KEY,
  publishableKey: process.env.CLERK_PUBLISHABLE_KEY, // required for authenticateRequest
  // jwtKey: process.env.CLERK_JWT_KEY, // optional networkless JWKS
});
```

**Vercel Node note:** Handlers use Node `(req, res)`, not Fetch `Request`.
- `authenticateRequest` expects a **Web `Request`** (or compatible). Prefer either:
  1. **Simple path (recommended for this codebase):** read `Authorization` Bearer and call `verifyToken` (no need to synthesize a full Request), **or**
  2. Build `new Request(url, { headers: { authorization: req.headers.authorization, … } })` and call `clerk.authenticateRequest(request, { authorizedParties: […] })`.

**`verifyToken` payload claims of interest:** `sub` (user id), `sid` (session id), `azp` (authorized party / origin), `iss`, `exp`, `iat`, `nbf`.

**`authenticateRequest` → `toAuth()`:** when authenticated, yields Auth-like object with `userId`, `sessionId`, etc. Prefer `isAuthenticated` over deprecated `isSignedIn`.

### Existing API surface (auth-relevant)

| Path | File | Notes |
| --- | --- | --- |
| `/api/health` | `api/health.js` | likely public |
| `/api/cards`, due, mastered, `[...cardId]` | `api/cards/*` | unauthenticated today |
| `/api/designs`, `/api/designs/:id` | `api/designs*` | unauthenticated |
| `/api/stats`, `/api/export`, `/api/import` | respective | unauthenticated |
| `/api/leetcode/fetch` | `api/leetcode/fetch.js` | proxy |
| `/api/migrate` | `api/migrate.js` | has its own CORS (`Content-Type` only) |
| `/api/auth/*` | **does not exist yet** | config endpoint is greenfield |

`dev-server.js` mounts the handlers above via Express `app.all`. Any new `/api/auth/config` must be registered there too for local dev.

### Existing auth / env

`.env.example` today (names only):

- `DATABASE_URL`
- `POSTGRES_URL`

**No Clerk vars yet.** No secrets should be committed; add names to `.env.example` in an implementation phase.

`vercel.json`: static-ish deploy (`outputDirectory: "."`, no framework). Serverless functions under `api/` are the backend.

### Frontend shape (`index.html`)

- Single-file vanilla app: Quiet Study Desk shell (sidebar + main + dialogs).
- Central fetch helper (no auth headers today):

```js
function api(url, options) {
  return fetch(url, options).then(function (r) {
    return r.json().then(function (data) {
      if (!r.ok || !data.ok) throw new Error(data.error || 'Request failed');
      return data;
    });
  });
}
```

- All data load goes through `api('/api/cards')`, `api('/api/cards/due')`, designs, etc. — **one place to inject Bearer**.
- Theme already uses `localStorage` (`cj-theme`); no auth state.
- Already loads third-party scripts via `loadScript` (marked, DOMPurify) — same pattern can load Clerk UI/JS if not using fixed `<script defer>` tags.

### CORS today (`lib/api.js` + `server.js`)

```js
'Access-Control-Allow-Origin': '*',
'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
'Access-Control-Allow-Headers': 'Content-Type'  // ← MISSING Authorization
```

**Must change for Bearer auth:** allow `Authorization` (and keep `Content-Type`).
If ever locking origin (instead of `*`), cannot combine `Access-Control-Allow-Credentials: true` with `*`; same-origin deploy (HTML + `/api` on one Vercel host) makes cookie-based same-origin auth possible, but **Bearer is still the portable choice** and matches Clerk’s cross-origin guidance.

---

## Clerk research (current approach)

### Browser: ClerkJS CDN (vanilla JS) — current docs (2026)

Clerk’s JS quickstart supports **two** paths:

1. **npm** `@clerk/clerk-js` + bundler (Vite) — not required for this app.
2. **`<script>` CDN** — preferred for single-file `index.html`.

#### CDN scripts (current pattern)

From Dashboard → API keys → Quick Copy → **JavaScript**, and official quickstart `<script>` tab:

```html
<!-- 1) UI bundle -->
<script
  defer
  crossorigin="anonymous"
  src="https://{{fapi_url}}/npm/@clerk/ui@1/dist/ui.browser.js"
  type="text/javascript"
></script>

<!-- 2) Clerk JS — publishable key via data attribute -->
<script
  defer
  crossorigin="anonymous"
  data-clerk-publishable-key="{{pub_key}}"
  src="https://{{fapi_url}}/npm/@clerk/clerk-js@6/dist/clerk.browser.js"
  type="text/javascript"
></script>
```

Where:

- `{{fapi_url}}` = Frontend API host for the instance (e.g. `something.clerk.accounts.dev` in dev).
- `{{pub_key}}` = Publishable key (`pk_test_…` / `pk_live_…`).

**Do not hardcode production `pk_live_` in git** if avoidable. Prefer:

1. Server env `CLERK_PUBLISHABLE_KEY`
2. `GET /api/auth/config` → `{ ok: true, publishableKey, … }` (public by design)
3. Frontend injects `data-clerk-publishable-key` **or** constructs scripts after fetch

Script-tag supported **data attributes only** (per docs):
`data-clerk-publishable-key`, `data-clerk-proxy-url`, `data-clerk-domain`.
All other options go to `Clerk.load(…)`.

#### Initialize + UI mount

```js
window.addEventListener('load', async function () {
  await Clerk.load({
    ui: { ClerkUI: window.__internal_ClerkUICtor },
  });

  if (Clerk.isSignedIn) {
    // show app shell; mount user menu
    Clerk.mountUserButton(document.getElementById('user-button'));
  } else {
    // calm login shell only
    Clerk.mountSignIn(document.getElementById('sign-in'));
  }
});
```

Key globals/APIs after load:

| API | Use |
| --- | --- |
| `Clerk.isSignedIn` | Gate shell vs login |
| `Clerk.user` | Display name / email (optional) |
| `Clerk.session.getToken()` | Session JWT for `Authorization: Bearer …` |
| `Clerk.mountSignIn(el)` | Embedded sign-in (Google button appears if Google SSO enabled) |
| `Clerk.mountUserButton(el)` | Avatar + account + **sign out** |
| `Clerk.signOut()` | Programmatic sign-out |
| `Clerk.addListener` / `Clerk.on` | React to session changes without full reload |

**npm-equivalent modern note:** Vite quickstart now derives FAPI domain from publishable key (`atob(pk.split('_')[2])…`) and loads `@clerk/ui@1` dynamically. CDN Quick Copy is still the path of least resistance for vanilla HTML.

#### Getting a Bearer token (frontend)

```js
async function getSessionToken() {
  if (!window.Clerk || !Clerk.session) return null;
  return await Clerk.session.getToken(); // default session token
}

// Wire into existing api() helper:
async function api(url, options) {
  options = options || {};
  var headers = Object.assign({}, options.headers || {});
  var token = await getSessionToken();
  if (token) headers['Authorization'] = 'Bearer ' + token;
  // Content-Type only when body present (existing call sites already set it)
  return fetch(url, Object.assign({}, options, { headers })).then(/* same json/ok handling */);
}
```

Clerk docs: **same-origin** requests can rely on `__session` cookie automatically; **cross-origin** (or any case where you want explicit API auth) must send **Bearer** via `Authorization`. For this app (static HTML + `/api` on same Vercel deployment), cookies *may* work for `authenticateRequest`, but:

- Explicit Bearer matches existing CORS style and Express/dev quirks.
- Avoids depending on cookie name / SameSite edge cases in local Express.
- **Recommended default for implementer: always attach Bearer from `getToken()`.**

### Backend: `@clerk/backend` verifyToken / authenticateRequest

#### Option A — `verifyToken` (best fit for Vercel Node `(req,res)`)

```js
import { verifyToken } from '@clerk/backend';

function bearerFromReq(req) {
  const h = req.headers.authorization || req.headers.Authorization || '';
  const m = /^Bearer\s+(.+)$/i.exec(h);
  return m ? m[1] : null;
}

export async function requireUser(req, res) {
  const token = bearerFromReq(req);
  if (!token) {
    sendJSON(res, 401, { ok: false, error: 'Unauthorized' });
    return null;
  }
  try {
    const payload = await verifyToken(token, {
      secretKey: process.env.CLERK_SECRET_KEY,
      // jwtKey: process.env.CLERK_JWT_KEY, // optional networkless
      authorizedParties: [
        'http://localhost:3000',
        // production origin(s), e.g. 'https://your-app.vercel.app'
      ],
    });
    // payload.sub === Clerk user id
    return payload;
  } catch {
    sendJSON(res, 401, { ok: false, error: 'Unauthorized' });
    return null;
  }
}
```

Docs recommend `authenticateRequest` for full request auth; `verifyToken` is the documented lower-level path and is **ideal when you already have a Bearer string** from Node headers.

#### Option B — `authenticateRequest` (Web Request)

```js
import { createClerkClient } from '@clerk/backend';

const clerk = createClerkClient({
  secretKey: process.env.CLERK_SECRET_KEY,
  publishableKey: process.env.CLERK_PUBLISHABLE_KEY,
});

// Build Fetch Request from Node req (sketch):
function toWebRequest(req) {
  const host = req.headers.host;
  const proto = req.headers['x-forwarded-proto'] || 'http';
  const url = `${proto}://${host}${req.url}`;
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) {
    if (v == null) continue;
    headers.set(k, Array.isArray(v) ? v.join(',') : String(v));
  }
  return new Request(url, { method: req.method, headers });
}

const state = await clerk.authenticateRequest(toWebRequest(req), {
  authorizedParties: ['http://localhost:3000', 'https://your-prod-origin'],
  // jwtKey: process.env.CLERK_JWT_KEY,
});
if (!state.isAuthenticated) {
  sendJSON(res, 401, { ok: false, error: 'Unauthorized' });
  return;
}
const auth = state.toAuth(); // userId, sessionId, …
```

**Must provide** either `jwtKey` or `secretKey`.
**Should set** `authorizedParties` (CSRF / subdomain cookie leak protection).

Networkless verification: set `CLERK_JWT_KEY` (PEM public key from Dashboard → API keys → Show JWT public key).

### Env vars (names only)

| Name | Where | Purpose |
| --- | --- | --- |
| `CLERK_PUBLISHABLE_KEY` | Server (+ exposed via `/api/auth/config`) | Frontend Clerk init; also for `authenticateRequest` |
| `CLERK_SECRET_KEY` | Server **only** (Vercel env, local `.env`) | Backend verify / API |
| `CLERK_JWT_KEY` | Server optional | Networkless JWT verify (PEM) |
| `CLERK_AUTHORIZED_PARTIES` | Server optional (comma-separated origins) | Convenience for `authorizedParties` |

Next.js-prefixed names (`NEXT_PUBLIC_CLERK_*`) appear in Clerk’s generic env docs; **this app is not Next.js** — prefer unprefixed `CLERK_*` and a config endpoint for the publishable key.

**Never** put `CLERK_SECRET_KEY` or `CLERK_JWT_KEY` in frontend HTML or public config JSON.

Dashboard places:

- **API keys** → Publishable + Secret (+ JWT public key)
- **SSO connections** → Google
- **Paths / domains** → production domain allowlist for Clerk instance
- **Account Portal** (optional) for hosted sign-in testing

### CORS + Authorization header

**Required change** in `lib/api.js` (and any duplicate CORS in `server.js` / `api/migrate.js`):

```js
'Access-Control-Allow-Headers': 'Content-Type, Authorization'
```

Preflight `OPTIONS` must return the same headers (already handled by `handleOptions` if it uses `corsHeaders()`).

Same-origin Vercel: browser still sends preflight for non-simple headers like `Authorization` on some methods — keep OPTIONS working on all protected routes.

### Frontend Bearer attachment

1. After `Clerk.load` and signed-in, wrap `api()` to call `Clerk.session.getToken()`.
2. Set `headers.Authorization = 'Bearer ' + token`.
3. On 401 from API: optionally `Clerk.signOut()` or re-prompt sign-in; toast existing error path already works.
4. Token refresh: `getToken()` is designed to return a fresh/cached session JWT — call it **per request** (or short TTL cache), don’t stash forever in `localStorage`.

### Sign-out

| Method | Behavior |
| --- | --- |
| `Clerk.mountUserButton(el)` | Built-in menu includes Sign out |
| `await Clerk.signOut()` | Clears session; then re-render login shell |
| Hosted Account Portal | Not required if embedded SignIn is used |

After sign-out: hide main shell, clear in-memory `state.cards` / `state.due`, show `#sign-in` again via `mountSignIn`.

### Google OAuth (dashboard + frontend)

**Development instance**

1. Clerk Dashboard → **SSO connections** → Add connection → Google → For all users.
2. Dev can use **Clerk shared OAuth credentials** — no Google Cloud project required for basic testing.
3. Enable for sign-up and sign-in.

**Production instance**

1. Same toggle + **Use custom credentials**.
2. Google Cloud Console → OAuth client (Web application):
   - Authorized JavaScript origins: production origin(s) + `http://localhost:PORT` for local.
   - Authorized redirect URI: value copied from Clerk Google connection page.
3. Paste **Client ID** + **Client Secret** into Clerk (names only in docs; values only in Dashboard).
4. OAuth consent screen publishing status must be **In production** for real users (Testing = max 100 test users).
5. Keep **Block email subaddresses** enabled unless there is a strong reason not to.

**Frontend:** Once Google is enabled, `Clerk.mountSignIn` shows Google automatically — no custom Google SDK required for basic sign-in.
Google One Tap (`mountGoogleOneTap` / component) is optional polish, not required for Phase 0.

**Clerk instance domains:** Add production domain in Clerk Dashboard so redirects and `azp` checks succeed.

### Calm login shell integration (no Next.js)

Goal: keep Quiet Study Desk aesthetic; do not fork the whole app into a SPA framework.

**Recommended UX**

1. **Boot gate before `refresh()`**
   - Fetch `/api/auth/config` → get `publishableKey` (+ maybe `authorized` flag later).
   - Load Clerk UI + clerk-js (static tags with key injected, or dynamic scripts).
   - `await Clerk.load({ ui: { ClerkUI: window.__internal_ClerkUICtor } })`.

2. **If not signed in**
   - Hide `.shell` (or leave empty main).
   - Show a minimal full-viewport panel matching existing CSS tokens (`--bg`, `--surface`, `--muted`, Inter):
     - Brand mark “CJ / Coding Journal”
     - Short line: “Sign in to open your study desk.”
     - `<div id="sign-in"></div>` → `Clerk.mountSignIn`
   - No cards fetch until signed in (prevents 401 noise).

3. **If signed in**
   - Reveal `.shell`.
   - Mount `UserButton` in sidebar `side-tools` next to theme toggle (calm, not a second chrome system).
   - Patch `api()` for Bearer.
   - Call existing `refresh()`.

4. **Listener**
   - On session end (sign-out), flip back to login panel without hard navigation if possible.

5. **Appearance (optional)**
   - Pass Clerk `appearance` / localization in `load()` later to tone down default Clerk chrome toward warm neutrals — not blocking for first cut.

6. **Do not**
   - Rewrite to Next.js / React.
   - Add friends/multi-tenant UI this pass.
   - Expose secret key.
   - Rely on Google SDK separately from Clerk.

---

## Recommended integration sketch (not implemented)

### Files implementer would touch (future phase — not done here)

| Area | Touch |
| --- | --- |
| Env | `.env.example` names; Vercel env for `CLERK_*` |
| CORS | `lib/api.js` (+ `server.js` / migrate duplicates) |
| Auth helper | e.g. `lib/auth.js` — `requireUser` via `verifyToken` |
| Config route | `api/auth/config.js` — public publishable key only |
| Protect routes | cards, designs, stats, export, import (decide public: health, leetcode fetch?) |
| Dev wiring | `dev-server.js` register `/api/auth/config` |
| UI | `index.html` — login panel, Clerk scripts, Bearer `api()`, UserButton |

### Minimal backend helper shape

```js
// lib/auth.js (sketch only)
import { verifyToken } from '@clerk/backend';
import { sendJSON } from './api.js';

const parties = (process.env.CLERK_AUTHORIZED_PARTIES || 'http://localhost:3000')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

export async function requireUser(req, res) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) {
    sendJSON(res, 401, { ok: false, error: 'Unauthorized' });
    return null;
  }
  try {
    const claims = await verifyToken(token, {
      secretKey: process.env.CLERK_SECRET_KEY,
      jwtKey: process.env.CLERK_JWT_KEY, // optional
      authorizedParties: parties,
    });
    return { userId: claims.sub, sessionId: claims.sid, claims };
  } catch {
    sendJSON(res, 401, { ok: false, error: 'Unauthorized' });
    return null;
  }
}
```

Usage in a handler: after `handleOptions`, `const user = await requireUser(req, res); if (!user) return;` then scope DB by `user.userId` (owner column work is outside this auth-discovery doc; see Phase 0A API discovery).

### Config endpoint sketch

```js
// GET /api/auth/config — public
sendJSON(res, 200, {
  ok: true,
  publishableKey: process.env.CLERK_PUBLISHABLE_KEY || null,
  // never secretKey
});
```

### Frontend boot order sketch

1. Theme init (existing).
2. `api('/api/auth/config')` → key.
3. Inject/load Clerk scripts with key + FAPI host (from Dashboard Quick Copy or derive).
4. `Clerk.load`.
5. Branch signed-in / signed-out UI.
6. Only then `refresh()`.

---

## Risks / pitfalls

1. **CORS forgot `Authorization`** → browser blocks preflight; looks like “network error”.
2. **Hardcoding `pk_live_` in HTML** in git — prefer config endpoint.
3. **Missing `authorizedParties`** → weaker CSRF posture; prod `azp` mismatches cause false 401.
4. **`authenticateRequest` with raw Node `req`** without adapting to Web `Request` → runtime errors; prefer `verifyToken` + Bearer.
5. **Secret key in frontend** — catastrophic; only publishable key is public.
6. **Google prod still in Testing** → random users can’t sign in.
7. **Clerk production domain not added** → redirect / cookie / azp failures.
8. **Calling `refresh()` before Clerk ready** → 401 storms / empty error states.
9. **Stale Bearer cached forever** — always `getToken()` near request time.
10. **ESM + CJS confusion** — use `import { verifyToken, createClerkClient } from '@clerk/backend'` (package has proper `exports.import`).
11. **Duplicate CORS** in `server.js` / `migrate.js` if only `lib/api.js` is fixed.
12. **Dev Express must mount** new auth routes — easy to ship Vercel-only path.
13. **UI bundle required** — modern clerk-js@6 expects `@clerk/ui` + `Clerk.load({ ui: { ClerkUI: window.__internal_ClerkUICtor } })`; older single-script snippets are outdated.
14. **Owner scoping** — JWT verify alone does not multi-tenant the DB; cards still global until schema/API filter by `userId` (separate workstream).

---

## Open questions

1. Should `/api/health` and `/api/leetcode/fetch` remain public after auth lands?
2. Exact production origin(s) for `authorizedParties` (custom domain vs `*.vercel.app`)?
3. Networkless `CLERK_JWT_KEY` now vs secretKey JWKS fetch (cold start latency)?
4. Allowlist single-user mode (only Chirag’s `user_…`) vs any signed-in Clerk user this pass? (“No friends” suggests personal use — optional hard allowlist of one `userId`.)
5. Hosted Account Portal vs only embedded `mountSignIn`?
6. Does implementer keep dual `server.js` + `dev-server.js` CORS in sync or deprecate one?

---

## Verification checklist for implementer

- [ ] `@clerk/backend@1.34.0` import works: `import { verifyToken, createClerkClient } from '@clerk/backend'`
- [ ] Vercel + local env set: `CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY` (optional `CLERK_JWT_KEY`, `CLERK_AUTHORIZED_PARTIES`)
- [ ] Dashboard: Google SSO enabled (dev shared creds OK; prod custom OAuth)
- [ ] `/api/auth/config` returns publishable key only
- [ ] CORS allows `Authorization`
- [ ] Signed-out: calm login shell + Google via `mountSignIn`; no card API calls
- [ ] Signed-in: shell visible; `UserButton` in sidebar; `api()` sends Bearer
- [ ] Protected API without token → 401 `{ ok: false, error: '…' }`
- [ ] Protected API with valid token → 200 and `sub` available for future owner scope
- [ ] Sign-out returns to login shell; subsequent API calls 401
- [ ] Local `node dev-server.js` path exercises same auth as Vercel
- [ ] No secrets in client bundle / HTML / config JSON
- [ ] **Application files modified in Phase 0B: NONE** (discovery only)

---

## Sources used

- Installed package inspection: `node_modules/@clerk/backend` v1.34.0 exports + runtime exports (`createClerkClient`, `verifyToken`; `authenticateRequest` on client)
- Repo: `package.json`, `package-lock.json`, `lib/api.js`, `dev-server.js`, `index.html` `api()` helper, `.env.example`, `vercel.json`
- Clerk docs (extracted 2026-07-29): JS quickstart CDN + npm, making-requests, verifyToken, authenticateRequest, env vars, Google social connection, Clerk class reference

---

## Application files modified

**NONE**
