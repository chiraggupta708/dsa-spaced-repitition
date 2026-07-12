-- Schema for dsa-spaced-repetition (Neon Postgres)
-- Run via scripts/setup-db.mjs at build time. Idempotent.

CREATE TABLE IF NOT EXISTS cards (
  id                  TEXT PRIMARY KEY,
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW(),
  question            TEXT NOT NULL,
  answer              TEXT NOT NULL,
  link                TEXT DEFAULT '',
  difficulty          TEXT DEFAULT 'medium',
  actual_code         TEXT DEFAULT '',
  my_thinking         TEXT DEFAULT '',
  right_thinking      TEXT DEFAULT '',
  notes               TEXT DEFAULT '',
  question_description TEXT DEFAULT '',
  easiness_factor     REAL DEFAULT 2.5,
  interval            INTEGER DEFAULT 0,
  repetitions         INTEGER DEFAULT 0,
  next_review         TIMESTAMPTZ,
  last_review         TIMESTAMPTZ,
  last_quality        INTEGER
);

CREATE TABLE IF NOT EXISTS tags (
  id   TEXT PRIMARY KEY,
  name TEXT UNIQUE NOT NULL
);

CREATE TABLE IF NOT EXISTS cards_tags (
  card_id TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  tag_id  TEXT NOT NULL REFERENCES tags(id)  ON DELETE CASCADE,
  PRIMARY KEY (card_id, tag_id)
);

CREATE INDEX IF NOT EXISTS idx_cards_due   ON cards (next_review);
CREATE INDEX IF NOT EXISTS idx_cards_tags_tag  ON cards_tags (tag_id);
CREATE INDEX IF NOT EXISTS idx_cards_tags_card ON cards_tags (card_id);

-- Patch existing tables: add columns that predate this schema (idempotent).
ALTER TABLE cards ADD COLUMN IF NOT EXISTS updated_at          TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE cards ADD COLUMN IF NOT EXISTS answer              TEXT DEFAULT '';
ALTER TABLE cards ADD COLUMN IF NOT EXISTS link                TEXT DEFAULT '';
ALTER TABLE cards ADD COLUMN IF NOT EXISTS difficulty          TEXT DEFAULT 'medium';
ALTER TABLE cards ADD COLUMN IF NOT EXISTS actual_code         TEXT DEFAULT '';
ALTER TABLE cards ADD COLUMN IF NOT EXISTS my_thinking         TEXT DEFAULT '';
ALTER TABLE cards ADD COLUMN IF NOT EXISTS right_thinking      TEXT DEFAULT '';
ALTER TABLE cards ADD COLUMN IF NOT EXISTS notes               TEXT DEFAULT '';
ALTER TABLE cards ADD COLUMN IF NOT EXISTS question_description TEXT DEFAULT '';
ALTER TABLE cards ADD COLUMN IF NOT EXISTS easiness_factor     REAL DEFAULT 2.5;
ALTER TABLE cards ADD COLUMN IF NOT EXISTS interval            INTEGER DEFAULT 0;
ALTER TABLE cards ADD COLUMN IF NOT EXISTS repetitions         INTEGER DEFAULT 0;
ALTER TABLE cards ADD COLUMN IF NOT EXISTS next_review         TIMESTAMPTZ;
ALTER TABLE cards ADD COLUMN IF NOT EXISTS last_review         TIMESTAMPTZ;
ALTER TABLE cards ADD COLUMN IF NOT EXISTS last_quality        INTEGER;
