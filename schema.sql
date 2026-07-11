-- ============================================================================
-- Coding Journal — Neon Postgres schema
-- Reconstructed from lib/db.js SQL (load/save/countStreak).
-- Types chosen to match exactly what the queries read/write:
--   - card.id / tag.id are TEXT (generated via Date.now().toString(36)+random,
--     and crypto.randomUUID() respectively — both stored as strings, not UUID).
--   - ON CONFLICT (name) on tags requires a UNIQUE constraint on tags.name.
--   - cards_tags is the junction; PK (card_id, tag_id) enforces one link each.
-- ============================================================================

-- Cards ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cards (
  id                 TEXT PRIMARY KEY,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  question           TEXT NOT NULL DEFAULT '',
  link               TEXT NOT NULL DEFAULT '',
  difficulty         TEXT NOT NULL DEFAULT 'medium',
  actual_code        TEXT NOT NULL DEFAULT '',
  my_thinking        TEXT NOT NULL DEFAULT '',
  right_thinking     TEXT NOT NULL DEFAULT '',
  notes              TEXT NOT NULL DEFAULT '',
  question_description TEXT NOT NULL DEFAULT '',
  easiness_factor    DOUBLE PRECISION NOT NULL DEFAULT 2.5,
  interval           INTEGER NOT NULL DEFAULT 0,
  repetitions        INTEGER NOT NULL DEFAULT 0,
  next_review        TIMESTAMPTZ,
  last_review        TIMESTAMPTZ,
  last_quality       INTEGER
);

-- Tags ----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tags (
  id   TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE
);

-- Junction (card <-> tag, many-to-many) -------------------------------------
CREATE TABLE IF NOT EXISTS cards_tags (
  card_id TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  tag_id  TEXT NOT NULL REFERENCES tags(id)  ON DELETE CASCADE,
  PRIMARY KEY (card_id, tag_id)
);

-- Indexes the GROUP BY / JOINs in load() benefit from ----------------------
CREATE INDEX IF NOT EXISTS idx_cards_created_at ON cards (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_cards_tags_card_id ON cards_tags (card_id);
CREATE INDEX IF NOT EXISTS idx_cards_tags_tag_id  ON cards_tags (tag_id);
