# Phase 1B — Owner-safe database layer build log

- Scope enforced: only `lib/db.js` and this log were written.
- Guardrails observed: no schema edits, no database connection/deployment, and no HTTP calls.
- Log created before reading/editing `lib/db.js`: YES
- `lib/db.js` read before edit: YES
- `schema.sql` read-only inspection: YES (confirmed nullable `owner_id` on cards/designs and users columns).
- `lib/db.js` written and re-read from disk: YES
- File content verified: YES

## Exported owner-safe functions

| Export | Ownership behavior |
| --- | --- |
| `upsertUser({ clerkId, email?, displayName? })` | Validates Clerk ID; parameterized upsert by `clerk_id`. |
| `load(ownerId)` | Rejects missing/blank owner; selects cards with `c.owner_id = $1`. |
| `upsertCard(card, ownerId)` | Validates owner/card ID; insert includes `owner_id`; conflict update is constrained by `WHERE cards.owner_id = EXCLUDED.owner_id`; scoped tag mapping. |
| `deleteCard(id, ownerId)` | Parameterized delete requires both `id` and `owner_id`; returns `{ ok, deleted }`. |
| `replaceCardsForOwner(cards, ownerId)` | Validates every card; owner-scoped upserts; only deletes this owner's omitted IDs; empty input does not delete. |
| `claimLegacyContent(user)` | Upserts supplied user first, then ordered parameterized updates claim only `owner_id IS NULL` cards and designs; returns counts. |
| `loadDesigns(opts, ownerId)` | Requires owner and includes `d.owner_id = $1`; preserves kind/tag filtering. |
| `saveDesign(design, ownerId)` | Insert includes `owner_id`; conflict update constrained to matching design owner; scoped tag mapping. |
| `deleteDesign(id, ownerId)` | Parameterized delete requires both `id` and `owner_id`; returns `{ ok, deleted }`. |
| `getDesign(id, ownerId)` | Requires owner; selects with ID and owner filter. |
| `countStreak(ownerId, cards?)` | Requires owner; database query filters `owner_id = $1`; optional cards input is expected to be pre-scoped. |

## Intentional Phase 1D compatibility breaks

- The unsafe `save(data)` export was removed. Routes must use `upsertCard(card, ownerId)` or `replaceCardsForOwner(cards, ownerId)`.
- `load`, `countStreak`, and every design function now require an owner ID.
- Card deletion is now `deleteCard(id, ownerId)` (new export); design mutation return values include `deleted`.

## Safety verification

```text
$ node --check lib/db.js
(exit 0; no output)

$ env -u DATABASE_URL -u POSTGRES_URL -u POSTGRES_PRISMA_URL node …
import: OK
load() missing owner: rejected
load('owner-test') no DB: empty cards

$ static DELETE scan
exact unsafe DELETE FROM cards WHERE id <> ALL: NOT FOUND
DELETE statements:
L91: DELETE FROM cards_tags … c.owner_id = $2
L192: DELETE FROM cards WHERE id = $1 AND owner_id = $2 RETURNING id
L207: DELETE FROM cards WHERE owner_id = $1 AND id <> ALL($2)
L278: DELETE FROM designs_tags … d.owner_id = $2
L337: DELETE FROM designs WHERE id = $1 AND owner_id = $2 RETURNING id
all DELETE statements include owner_id: YES

$ git diff --check -- lib/db.js
(exit 0; no output)
```

No credentials were printed. The no-`DATABASE_URL` smoke test used an unset environment and did not establish a database connection.

Application files modified: lib/db.js only
