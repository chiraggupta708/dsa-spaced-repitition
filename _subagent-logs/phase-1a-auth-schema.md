# Phase 1A Auth Schema Build Log

## Paths
- Repository: `/Users/chirag/dsa-spaced-repetition`
- Application schema: `/Users/chirag/dsa-spaced-repetition/schema.sql`
- Build log: `/Users/chirag/dsa-spaced-repetition/_subagent-logs/phase-1a-auth-schema.md`
- Splitter inspected: `/Users/chirag/dsa-spaced-repetition/scripts/setup-db.mjs`

## Required ordering and source migration changes
- Created this log before inspecting or editing the schema.
- Re-read `schema.sql` before editing.
- Added `users` before `cards`, with `clerk_id TEXT PRIMARY KEY`, nullable `email` and `display_name`, and timestamp columns.
- Added nullable `owner_id TEXT REFERENCES users(clerk_id) ON DELETE RESTRICT` to fresh `cards` and `designs` definitions.
- Added idempotent `ALTER TABLE ... ADD COLUMN IF NOT EXISTS owner_id ... ON DELETE RESTRICT` statements for existing `cards` and `designs` tables.
- Added indexes for `cards(owner_id)`, `cards(owner_id, next_review)`, `designs(owner_id)`, and `designs(owner_id, kind)` while retaining all existing indexes and tag schema behavior.

## Safety choice
`owner_id` is nullable, has no default, and no backfill was added. Existing rows remain unowned until a later guarded claim step. No production or development database was accessed, and no import route was run.

## Splitter validation (no database connection)
Used the exact comment-strip/split logic from `scripts/setup-db.mjs` in a local Node command against `schema.sql`.

- Nonempty statement count: `33`
- First statement prefix: `CREATE TABLE IF NOT EXISTS users ( clerk_id TEXT PRIMARY KEY,`
- Last statement prefix: `CREATE INDEX IF NOT EXISTS idx_designs_tags_design ON designs_tags (de`
- Result: success (exit code 0); the command only read and split the local schema file.

## Verification
- Re-read `schema.sql` after writing and confirmed the required table, nullable/restricted ownership columns, idempotent alters, and four ownership indexes.
- File content verified: YES

Application files modified: schema.sql only
