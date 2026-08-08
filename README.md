# Coding Journal — Quiet Study Desk

A private spaced-repetition coding journal for DSA problems, LLD/HLD designs, Markdown notes, and review scheduling.

The application is a vanilla HTML/CSS/JavaScript frontend with Vercel serverless API routes and Neon Postgres storage. Authentication is provided by Clerk, with Google sign-in enabled for the deployed app.

## Live deployments

- Production: <https://dsa-spaced-repitition.vercel.app>
- Isolated development project: <https://dsa-spaced-repititiondev.vercel.app>

The isolated development project has a separate database and is the place for disposable write testing. Do not run write tests against production.

## Features

- Clerk Google sign-in and signed-in session gate
- Per-user ownership of cards, designs, review state, statistics, imports, and exports
- DSA cards with:
  - question, approach, reference answer/code, notes, tags, difficulty, and LeetCode URL
  - Markdown source with safe preview rendering
  - SM-2-style spaced review scheduling
  - integer ratings from 1 to 5
- LLD and HLD design notes
- Recall → Reveal → Rate → Continue review flow
- Owner-scoped JSON export and confirmed import
- Responsive layout and dark mode

## Architecture

```text
index.html
  └─ fetches authenticated API routes

api/*.js
  └─ Vercel serverless handlers

lib/auth.js
  └─ verifies Clerk Bearer JWT and derives the owner from JWT sub

lib/db.js
  └─ Neon Postgres queries with owner-scoped access

schema.sql
  └─ additive Postgres schema and ownership indexes
```

The production path is the Vercel serverless API plus Neon Postgres. The local `dev-server.js` mounts the same API handlers through Express for local production-parity checks.

## Ownership and security

- The server derives ownership only from the verified Clerk JWT `sub` / Clerk `userId`.
- Owner IDs, emails, and identity fields are never accepted from request bodies.
- Unauthenticated journal endpoints return `401`.
- A user can read or modify only their own cards and designs.
- Normal create, edit, review, and delete operations cannot take another user's row or an unowned legacy row.
- Clerk secret values, JWT public-key material, and session tokens must never be committed.

The old manual legacy-claim feature is intentionally removed. For the current single-user migration path:

```text
fresh backup → sign in → import the verified backup
```

During an authenticated import only, a card with an exact matching ID may adopt an existing row whose `owner_id` is `NULL`. A row owned by another non-null owner is never overwritten.

## Import and export

Export is available after sign-in and contains the current user's cards:

```json
{
  "cards": []
}
```

Import accepts the same `{ "cards": [...] }` shape. A non-empty import replaces only the signed-in user's card collection. An empty import is a no-op. Import is protected by the UI confirmation dialog and by the authenticated API route.

Design records are not included in the current card backup format; use the Designs UI separately.

## Repository layout

| Path | Purpose |
|---|---|
| `index.html` | Shipped frontend and inline application logic |
| `api/` | Vercel serverless API entrypoints |
| `lib/auth.js` | Clerk JWT verification and auth errors |
| `lib/api.js` | CORS, request-body, and response helpers |
| `lib/db.js` | Owner-scoped Neon Postgres data layer |
| `lib/sm2.js` | Review scheduling calculations |
| `lib/leetcode.js` | LeetCode URL/data helper |
| `schema.sql` | Idempotent database schema and ownership columns/indexes |
| `scripts/apply-schema.mjs` | Explicit schema application script |
| `scripts/setup-db.mjs` | Build-time schema script; currently skipped by Vercel config |
| `dev-server.js` | Local Express server mounting the API handlers |
| `vercel.json` | Vercel rewrites and deployment configuration |

Old UI prototypes, the old modular `src/` frontend, and internal agent logs are kept only on the developer's machine and are ignored by Git. They are not part of the deployed application.

## Environment variables

Set these in Vercel or in the shell used to run local production-parity checks. Never commit real values.

| Variable | Used for |
|---|---|
| `DATABASE_URL` or `POSTGRES_URL` | Neon Postgres connection |
| `CLERK_PUBLISHABLE_KEY` | Public Clerk frontend configuration |
| `CLERK_SECRET_KEY` | Server-side Clerk verification configuration |
| `CLERK_JWT_KEY` | PEM public key for offline JWT verification |

The Clerk JWT public key must include the complete PEM header and footer. Do not paste credentials into issues, chat, GBrain, or committed files.

## Local development

Install dependencies:

```bash
npm install
```

For the same API path used by Vercel, provide the database and Clerk variables in your shell, then run:

```bash
node dev-server.js 3000
```

Open <http://localhost:3000>.

Without `DATABASE_URL` or `POSTGRES_URL`, the Neon data layer intentionally returns empty reads and cannot persist writes. The local server does not silently use the old JSON-file backend.

`npm start` still points to the historical `server.js` JSON-file server and is not the production path. Prefer `node dev-server.js` for current development.

## Database schema

The schema is additive and idempotent:

- `users` stores Clerk IDs.
- `cards.owner_id` and `designs.owner_id` reference `users.clerk_id` and remain nullable for existing legacy rows.
- Owner indexes support card, due-queue, and design queries.
- Existing rows are not automatically backfilled or deleted.

Because `vercel.json` sets the Vercel build command to `null`, production schema changes must be applied deliberately from a secure environment:

```bash
DATABASE_URL='[REDACTED]' node scripts/apply-schema.mjs
```

Verify the target database and take a fresh backup before applying any schema or data migration.

## Verification

Source-only import ownership contract:

```bash
node scripts/test-legacy-import-contract.mjs
```

Build check without a database connection:

```bash
env -u DATABASE_URL -u POSTGRES_URL -u POSTGRES_PRISMA_URL npm run build
```

The build command skips schema setup when no database variable is present. Do not use the old local API integration test against production: it contains create, update, review, delete, and import writes and is intentionally kept local/ignored.

## Deployment

- Pushes to `dev` deploy to the isolated development project.
- Pushes to `main` deploy to production.
- Vercel Hobby permits at most 12 serverless functions. Auth and system routes use catch-all handlers so the project stays within that limit.
- Take and verify a fresh production export before a data-model or ownership change.
- Never test `/api/import` casually against production.

PWA installability and friends/sharing are future milestones and are not currently implemented.
