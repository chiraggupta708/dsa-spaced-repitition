-- Schema for dsa-spaced-repetition (Neon Postgres)
-- Run via scripts/setup-db.mjs at build time. Idempotent.
-- Order matters: CREATE TABLE -> ALTER ADD COLUMN (patch existing tables)
-- -> CREATE INDEX (indexes reference columns that the ALTERs guarantee exist).

CREATE TABLE IF NOT EXISTS users (
  clerk_id     TEXT PRIMARY KEY,
  email        TEXT,
  display_name TEXT,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  updated_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS cards (
  id                  TEXT PRIMARY KEY,
  owner_id            TEXT REFERENCES users(clerk_id) ON DELETE RESTRICT,
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

-- Patch existing tables: add columns that predate this schema (idempotent).
-- MUST run before CREATE INDEX below, since idx_cards_due references next_review.
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
ALTER TABLE cards ADD COLUMN IF NOT EXISTS owner_id            TEXT REFERENCES users(clerk_id) ON DELETE RESTRICT;

-- Indexes last: every referenced column is guaranteed to exist by now.
CREATE INDEX IF NOT EXISTS idx_cards_due        ON cards (next_review);
CREATE INDEX IF NOT EXISTS idx_cards_owner      ON cards (owner_id);
CREATE INDEX IF NOT EXISTS idx_cards_owner_due  ON cards (owner_id, next_review);
CREATE INDEX IF NOT EXISTS idx_cards_tags_tag   ON cards_tags (tag_id);
CREATE INDEX IF NOT EXISTS idx_cards_tags_card  ON cards_tags (card_id);

-- =========================================================================
-- Designs (LLD + HLD) — one shared table, `kind` column distinguishes them.
-- Reuses the existing `tags` table via `designs_tags`.
-- =========================================================================
CREATE TABLE IF NOT EXISTS designs (
  id            TEXT PRIMARY KEY,
  owner_id      TEXT REFERENCES users(clerk_id) ON DELETE RESTRICT,
  kind          TEXT NOT NULL CHECK (kind IN ('lld', 'hld')),
  title         TEXT NOT NULL,
  requirements  TEXT DEFAULT '',
  my_approach   TEXT DEFAULT '',
  canonical_approach TEXT DEFAULT '',
  components    TEXT DEFAULT '',
  relationships TEXT DEFAULT '',
  patterns      TEXT DEFAULT '',
  api           TEXT DEFAULT '',
  estimations   TEXT DEFAULT '',
  tradeoffs     TEXT DEFAULT '',
  notes         TEXT DEFAULT '',
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE designs ADD COLUMN IF NOT EXISTS owner_id TEXT REFERENCES users(clerk_id) ON DELETE RESTRICT;

CREATE TABLE IF NOT EXISTS designs_tags (
  design_id TEXT NOT NULL REFERENCES designs(id) ON DELETE CASCADE,
  tag_id    TEXT NOT NULL REFERENCES tags(id)    ON DELETE CASCADE,
  PRIMARY KEY (design_id, tag_id)
);

CREATE INDEX IF NOT EXISTS idx_designs_kind  ON designs (kind);
CREATE INDEX IF NOT EXISTS idx_designs_owner ON designs (owner_id);
CREATE INDEX IF NOT EXISTS idx_designs_owner_kind ON designs (owner_id, kind);
CREATE INDEX IF NOT EXISTS idx_designs_tags_tag  ON designs_tags (tag_id);
CREATE INDEX IF NOT EXISTS idx_designs_tags_design ON designs_tags (design_id);

-- =========================================================================
-- First-class LLD (V1) — additive owner-scoped aggregate.
-- Generic `designs` rows above remain unchanged for legacy LLD/HLD notes.
-- =========================================================================
CREATE TABLE IF NOT EXISTS lld_designs (
  id                   TEXT PRIMARY KEY,
  owner_id             TEXT NOT NULL REFERENCES users(clerk_id) ON DELETE RESTRICT,
  title                TEXT NOT NULL,
  problem_statement_md TEXT NOT NULL DEFAULT '',
  lifecycle_state      TEXT NOT NULL DEFAULT 'draft'
    CHECK (lifecycle_state IN ('draft', 'practicing', 'needs_review', 'interview_ready', 'archived')),
  schema_version       INTEGER NOT NULL DEFAULT 1 CHECK (schema_version >= 1),
  created_at           TIMESTAMPTZ DEFAULT NOW(),
  updated_at           TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (id, owner_id)
);

CREATE TABLE IF NOT EXISTS lld_sections (
  id          TEXT PRIMARY KEY,
  design_id   TEXT NOT NULL,
  owner_id    TEXT NOT NULL,
  section_key TEXT NOT NULL
    CHECK (section_key IN ('functional_requirements', 'nfr', 'model', 'diagram', 'flow_tradeoffs', 'review', 'scope')),
  title       TEXT NOT NULL,
  prompt      TEXT NOT NULL DEFAULT '',
  position    INTEGER NOT NULL DEFAULT 0 CHECK (position >= 0),
  content_md  TEXT NOT NULL DEFAULT '',
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (design_id, section_key),
  FOREIGN KEY (design_id, owner_id) REFERENCES lld_designs(id, owner_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS lld_diagrams (
  id            TEXT PRIMARY KEY,
  design_id     TEXT NOT NULL,
  owner_id      TEXT NOT NULL,
  title         TEXT NOT NULL,
  diagram_type  TEXT NOT NULL CHECK (diagram_type IN ('class', 'sequence')),
  source        TEXT NOT NULL,
  description   TEXT NOT NULL DEFAULT '',
  position      INTEGER NOT NULL DEFAULT 0 CHECK (position >= 0),
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW(),
  FOREIGN KEY (design_id, owner_id) REFERENCES lld_designs(id, owner_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS lld_resources (
  id          TEXT PRIMARY KEY,
  design_id   TEXT NOT NULL,
  owner_id    TEXT NOT NULL,
  title       TEXT NOT NULL,
  url         TEXT NOT NULL,
  host        TEXT NOT NULL DEFAULT '',
  resource_type TEXT NOT NULL DEFAULT 'reference',
  placement   TEXT NOT NULL DEFAULT 'after_attempt'
    CHECK (placement IN ('before_attempt', 'after_attempt')),
  notes_md    TEXT NOT NULL DEFAULT '',
  position    INTEGER NOT NULL DEFAULT 0 CHECK (position >= 0),
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW(),
  FOREIGN KEY (design_id, owner_id) REFERENCES lld_designs(id, owner_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS lld_code_artifacts (
  id             TEXT PRIMARY KEY,
  design_id      TEXT NOT NULL,
  owner_id       TEXT NOT NULL,
  language       TEXT NOT NULL DEFAULT 'java' CHECK (language = 'java'),
  filename       TEXT NOT NULL DEFAULT 'Main.java',
  background_md  TEXT NOT NULL DEFAULT '',
  skeleton_md    TEXT NOT NULL DEFAULT '',
  method_signatures_md TEXT NOT NULL DEFAULT '',
  source         TEXT NOT NULL DEFAULT '',
  compile_status TEXT NOT NULL DEFAULT 'not_run'
    CHECK (compile_status IN ('not_run', 'passed', 'failed')),
  compile_output TEXT NOT NULL DEFAULT '',
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  updated_at     TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (design_id, owner_id),
  FOREIGN KEY (design_id, owner_id) REFERENCES lld_designs(id, owner_id) ON DELETE CASCADE
);

ALTER TABLE lld_code_artifacts ADD COLUMN IF NOT EXISTS skeleton_md TEXT NOT NULL DEFAULT '';
ALTER TABLE lld_code_artifacts ADD COLUMN IF NOT EXISTS method_signatures_md TEXT NOT NULL DEFAULT '';
ALTER TABLE lld_sections DROP CONSTRAINT IF EXISTS lld_sections_section_key_check;
ALTER TABLE lld_sections ADD CONSTRAINT lld_sections_section_key_check
  CHECK (section_key IN ('functional_requirements', 'nfr', 'model', 'diagram', 'flow_tradeoffs', 'review', 'scope'));

CREATE TABLE IF NOT EXISTS lld_code_artifact_versions (
  id                    TEXT PRIMARY KEY,
  design_id             TEXT NOT NULL,
  owner_id              TEXT NOT NULL,
  version_no            INTEGER NOT NULL CHECK (version_no > 0),
  language              TEXT NOT NULL DEFAULT 'java' CHECK (language = 'java'),
  filename              TEXT NOT NULL DEFAULT 'Main.java',
  background_md         TEXT NOT NULL DEFAULT '',
  skeleton_md           TEXT NOT NULL DEFAULT '',
  method_signatures_md  TEXT NOT NULL DEFAULT '',
  source                TEXT NOT NULL DEFAULT '',
  change_note           TEXT NOT NULL DEFAULT '',
  created_at            TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (design_id, owner_id, version_no),
  FOREIGN KEY (design_id, owner_id) REFERENCES lld_designs(id, owner_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS lld_attempts (
  id             TEXT PRIMARY KEY,
  design_id      TEXT NOT NULL,
  owner_id       TEXT NOT NULL,
  mode           TEXT NOT NULL CHECK (mode IN ('practice', 'timed')),
  status         TEXT NOT NULL DEFAULT 'started'
    CHECK (status IN ('started', 'completed', 'abandoned')),
  prompt_version INTEGER NOT NULL DEFAULT 1 CHECK (prompt_version >= 1),
  started_at     TIMESTAMPTZ DEFAULT NOW(),
  completed_at   TIMESTAMPTZ,
  updated_at     TIMESTAMPTZ DEFAULT NOW(),
  FOREIGN KEY (design_id, owner_id) REFERENCES lld_designs(id, owner_id) ON DELETE CASCADE
);

-- The answer table references the attempt plus owner, so the parent needs a
-- matching unique key. A named unique index is idempotent across deploys and
-- also repairs databases where lld_attempts was created before this key.
CREATE UNIQUE INDEX IF NOT EXISTS idx_lld_attempts_id_owner ON lld_attempts (id, owner_id);

CREATE TABLE IF NOT EXISTS lld_attempt_answers (
  id           TEXT PRIMARY KEY,
  attempt_id   TEXT NOT NULL,
  owner_id     TEXT NOT NULL,
  phase_key    TEXT NOT NULL,
  answer_md    TEXT NOT NULL DEFAULT '',
  revealed_at  TIMESTAMPTZ,
  submitted_at TIMESTAMPTZ,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  updated_at   TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (attempt_id, phase_key),
  FOREIGN KEY (attempt_id, owner_id) REFERENCES lld_attempts(id, owner_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS lld_ai_turns (
  id                TEXT PRIMARY KEY,
  attempt_id        TEXT NOT NULL,
  design_id         TEXT NOT NULL,
  owner_id          TEXT NOT NULL,
  phase_key         TEXT,
  mode              TEXT NOT NULL CHECK (mode IN ('tutor', 'interviewer')),
  request_type      TEXT NOT NULL CHECK (request_type IN ('evaluate', 'hint', 'follow_up', 'debrief')),
  answer_md         TEXT NOT NULL DEFAULT '',
  feedback_md       TEXT NOT NULL DEFAULT '',
  missing_points    JSONB NOT NULL DEFAULT '[]'::jsonb,
  top_improvements  JSONB NOT NULL DEFAULT '[]'::jsonb,
  next_drill        TEXT NOT NULL DEFAULT '',
  follow_up_question TEXT NOT NULL DEFAULT '',
  hint_md           TEXT NOT NULL DEFAULT '',
  assessment        TEXT NOT NULL DEFAULT 'partial' CHECK (assessment IN ('missed', 'partial', 'clear')),
  provider          TEXT NOT NULL DEFAULT 'fallback',
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  CHECK (phase_key IS NULL OR phase_key IN ('functional_requirements', 'nfr', 'model', 'code', 'diagram', 'flow_tradeoffs', 'review', 'scope')),
  FOREIGN KEY (attempt_id, owner_id) REFERENCES lld_attempts(id, owner_id) ON DELETE CASCADE,
  FOREIGN KEY (design_id, owner_id) REFERENCES lld_designs(id, owner_id) ON DELETE CASCADE
);

ALTER TABLE lld_ai_turns ADD COLUMN IF NOT EXISTS top_improvements JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE lld_ai_turns ADD COLUMN IF NOT EXISTS next_drill TEXT NOT NULL DEFAULT '';
ALTER TABLE lld_ai_turns DROP CONSTRAINT IF EXISTS lld_ai_turns_phase_key_check;
ALTER TABLE lld_ai_turns ADD CONSTRAINT lld_ai_turns_phase_key_check
  CHECK (phase_key IS NULL OR phase_key IN ('functional_requirements', 'nfr', 'model', 'code', 'diagram', 'flow_tradeoffs', 'review', 'scope'));

CREATE TABLE IF NOT EXISTS lld_review_dimensions (
  id          TEXT PRIMARY KEY,
  design_id   TEXT NOT NULL,
  owner_id    TEXT NOT NULL,
  dimension_key TEXT NOT NULL
    CHECK (dimension_key IN ('scope', 'ownership', 'flow', 'pattern_edge_case')),
  level       TEXT NOT NULL CHECK (level IN ('missed', 'partial', 'clear')),
  notes_md    TEXT NOT NULL DEFAULT '',
  reviewed_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (design_id, dimension_key),
  FOREIGN KEY (design_id, owner_id) REFERENCES lld_designs(id, owner_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS lld_readiness (
  design_id       TEXT PRIMARY KEY,
  owner_id        TEXT NOT NULL,
  readiness_state  TEXT NOT NULL DEFAULT 'draft'
    CHECK (readiness_state IN ('draft', 'practicing', 'needs_review', 'interview_ready', 'archived')),
  next_action     TEXT NOT NULL DEFAULT '',
  next_review_at  TIMESTAMPTZ,
  algorithm_version INTEGER NOT NULL DEFAULT 1 CHECK (algorithm_version >= 1),
  evaluated_at    TIMESTAMPTZ,
  updated_at      TIMESTAMPTZ DEFAULT NOW(),
  FOREIGN KEY (design_id, owner_id) REFERENCES lld_designs(id, owner_id) ON DELETE CASCADE
);

ALTER TABLE lld_readiness ADD COLUMN IF NOT EXISTS next_review_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_lld_designs_owner ON lld_designs (owner_id);
CREATE INDEX IF NOT EXISTS idx_lld_designs_owner_state ON lld_designs (owner_id, lifecycle_state);
CREATE INDEX IF NOT EXISTS idx_lld_sections_owner_design ON lld_sections (owner_id, design_id, position);
CREATE INDEX IF NOT EXISTS idx_lld_diagrams_owner_design ON lld_diagrams (owner_id, design_id, position);
CREATE INDEX IF NOT EXISTS idx_lld_resources_owner_design ON lld_resources (owner_id, design_id, position);
CREATE INDEX IF NOT EXISTS idx_lld_code_owner_design ON lld_code_artifacts (owner_id, design_id);
CREATE INDEX IF NOT EXISTS idx_lld_code_versions_owner_design ON lld_code_artifact_versions (owner_id, design_id, version_no DESC);
CREATE INDEX IF NOT EXISTS idx_lld_attempts_owner_design ON lld_attempts (owner_id, design_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_lld_attempt_answers_owner_attempt ON lld_attempt_answers (owner_id, attempt_id);
CREATE INDEX IF NOT EXISTS idx_lld_ai_owner_attempt ON lld_ai_turns (owner_id, attempt_id, created_at);
CREATE INDEX IF NOT EXISTS idx_lld_review_owner_design ON lld_review_dimensions (owner_id, design_id);
CREATE INDEX IF NOT EXISTS idx_lld_readiness_owner_state ON lld_readiness (owner_id, readiness_state);
CREATE INDEX IF NOT EXISTS idx_lld_readiness_owner_review ON lld_readiness (owner_id, next_review_at);

-- =========================================================================
-- FSRS Phase 0 — additive scheduler records. Legacy SM-2 cards remain intact.
-- =========================================================================
CREATE TABLE IF NOT EXISTS fsrs_scheduler_parameters (
  version     INTEGER PRIMARY KEY CHECK (version > 0),
  data        JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS fsrs_review_events (
  id                TEXT PRIMARY KEY,
  owner_id          TEXT NOT NULL REFERENCES users(clerk_id) ON DELETE RESTRICT,
  card_id           TEXT NOT NULL REFERENCES cards(id) ON DELETE RESTRICT,
  rating            TEXT NOT NULL CHECK (rating IN ('again', 'hard', 'good', 'easy')),
  solved            BOOLEAN NOT NULL,
  occurred_at       TIMESTAMPTZ NOT NULL,
  scheduled_at      TIMESTAMPTZ,
  -- Pre-Phase 3 rows are immutable SM-2 compatibility projections.
  algorithm         TEXT NOT NULL DEFAULT 'sm2',
  state_before      JSONB,
  state_after       JSONB,
  actual_elapsed_days INTEGER,
  overdue_days      INTEGER,
  scheduled_interval_days INTEGER,
  algorithm_version INTEGER NOT NULL CHECK (algorithm_version > 0),
  parameter_version INTEGER NOT NULL REFERENCES fsrs_scheduler_parameters(version) ON DELETE RESTRICT,
  idempotency_key   TEXT NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (owner_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS fsrs_card_schedules (
  owner_id          TEXT NOT NULL REFERENCES users(clerk_id) ON DELETE RESTRICT,
  card_id           TEXT NOT NULL REFERENCES cards(id) ON DELETE RESTRICT,
  due_at            TIMESTAMPTZ NOT NULL,
  stability         REAL NOT NULL CHECK (stability >= 0),
  difficulty        REAL NOT NULL CHECK (difficulty >= 0 AND difficulty <= 10),
  state             TEXT NOT NULL CHECK (state IN ('new', 'learning', 'review', 'relearning')),
  card_state        JSONB,
  schedule_version  INTEGER NOT NULL CHECK (schedule_version > 0),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (owner_id, card_id)
);

-- Phase 3 shadow persistence: additive only, so existing development data is
-- retained. The algorithm default labels immutable pre-Phase 3 SM-2 rows.
ALTER TABLE fsrs_review_events
  ADD COLUMN IF NOT EXISTS algorithm TEXT NOT NULL DEFAULT 'sm2';
ALTER TABLE fsrs_review_events
  ADD COLUMN IF NOT EXISTS state_before JSONB;
ALTER TABLE fsrs_review_events
  ADD COLUMN IF NOT EXISTS state_after JSONB;
ALTER TABLE fsrs_review_events
  ADD COLUMN IF NOT EXISTS actual_elapsed_days INTEGER;
ALTER TABLE fsrs_review_events
  ADD COLUMN IF NOT EXISTS overdue_days INTEGER;
ALTER TABLE fsrs_review_events
  ADD COLUMN IF NOT EXISTS scheduled_interval_days INTEGER;
ALTER TABLE fsrs_card_schedules
  ADD COLUMN IF NOT EXISTS card_state JSONB;

CREATE TABLE IF NOT EXISTS fsrs_practice_states (
  owner_id         TEXT NOT NULL REFERENCES users(clerk_id) ON DELETE RESTRICT,
  card_id          TEXT NOT NULL REFERENCES cards(id) ON DELETE RESTRICT,
  practice_state   TEXT NOT NULL DEFAULT 'active'
    CHECK (practice_state IN ('active', 'paused', 'suspended', 'retired')),
  last_practiced_at TIMESTAMPTZ,
  next_practice_at TIMESTAMPTZ,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (owner_id, card_id)
);

ALTER TABLE fsrs_practice_states
  ADD COLUMN IF NOT EXISTS next_practice_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS learner_preferences (
  owner_id   TEXT PRIMARY KEY REFERENCES users(clerk_id) ON DELETE RESTRICT,
  timezone   TEXT NOT NULL DEFAULT 'UTC' CHECK (timezone <> ''),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_fsrs_review_events_owner_card_occurred
  ON fsrs_review_events (owner_id, card_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_fsrs_card_schedules_owner_due
  ON fsrs_card_schedules (owner_id, due_at);
CREATE INDEX IF NOT EXISTS idx_fsrs_practice_states_owner_card
  ON fsrs_practice_states (owner_id, card_id);

CREATE OR REPLACE FUNCTION prevent_fsrs_review_event_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'fsrs_review_events are immutable';
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgname = 'trg_fsrs_review_events_immutable'
      AND tgrelid = 'fsrs_review_events'::regclass
  ) THEN
    CREATE TRIGGER trg_fsrs_review_events_immutable
      BEFORE UPDATE OR DELETE ON fsrs_review_events
      FOR EACH ROW EXECUTE FUNCTION prevent_fsrs_review_event_mutation();
  END IF;
END;
$$;

-- DSA Practice Phase 0 — additive owner-scoped practice attempts.
-- This bounded block is applied only by scripts/apply-dsa-practice-schema.mjs.
-- =========================================================================
CREATE TABLE IF NOT EXISTS dsa_practice_attempts (
  id                   TEXT PRIMARY KEY,
  owner_id             TEXT NOT NULL REFERENCES users(clerk_id) ON DELETE RESTRICT,
  card_id              TEXT NOT NULL REFERENCES cards(id) ON DELETE RESTRICT,
  occurred_at          TIMESTAMPTZ NOT NULL,
  time_zone            TEXT,
  outcome              TEXT NOT NULL
    CHECK (outcome IN ('independent', 'hinted', 'unfinished')),
  next_practice_at     TIMESTAMPTZ NOT NULL,
  due_reason           TEXT NOT NULL
    CHECK (due_reason IN ('monthly_checkpoint', 'three_day_retry')),
  blocker              TEXT CHECK (blocker IS NULL OR char_length(blocker) <= 1000),
  reflection           TEXT CHECK (reflection IS NULL OR char_length(reflection) <= 2000),
  challenge_approach   TEXT CHECK (challenge_approach IS NULL OR char_length(challenge_approach) <= 2000),
  challenge_invariant  TEXT CHECK (challenge_invariant IS NULL OR char_length(challenge_invariant) <= 1000),
  challenge_complexity TEXT CHECK (challenge_complexity IS NULL OR char_length(challenge_complexity) <= 500),
  source               TEXT NOT NULL
    CHECK (source IN ('practice', 'legacy_review')),
  source_event_id     TEXT,
  idempotency_key     TEXT NOT NULL
    CHECK (char_length(idempotency_key) BETWEEN 1 AND 200),
  request_fingerprint TEXT NOT NULL
    CHECK (char_length(request_fingerprint) BETWEEN 1 AND 128),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (owner_id, idempotency_key),
  UNIQUE (source_event_id)
);

-- Capture claims are owner-scoped and remain additive to the card model. A
-- claim may be pending only inside the atomic capture statement; committed
-- rows are created or duplicate and retain the request fingerprint.
CREATE TABLE IF NOT EXISTS dsa_practice_captures (
  id                   TEXT PRIMARY KEY,
  owner_id             TEXT NOT NULL REFERENCES users(clerk_id) ON DELETE RESTRICT,
  card_id              TEXT REFERENCES cards(id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  idempotency_key      TEXT NOT NULL
    CHECK (char_length(idempotency_key) BETWEEN 1 AND 200),
  request_fingerprint  TEXT NOT NULL
    CHECK (char_length(request_fingerprint) BETWEEN 1 AND 128),
  status               TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'created', 'duplicate')),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (owner_id, idempotency_key)
);

-- One owner/card row keeps capture insights separate from solution bodies and
-- gives reveal an explicit, owner-bound learning-notes source.
CREATE TABLE IF NOT EXISTS dsa_practice_learning_notes (
  owner_id       TEXT NOT NULL REFERENCES users(clerk_id) ON DELETE RESTRICT,
  card_id        TEXT NOT NULL REFERENCES cards(id) ON DELETE RESTRICT,
  key_insight    TEXT CHECK (key_insight IS NULL OR char_length(key_insight) <= 1000),
  recurring_trap TEXT CHECK (recurring_trap IS NULL OR char_length(recurring_trap) <= 1000),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (owner_id, card_id)
);

-- Existing FSRS state rows remain intact; these columns are additive and
-- nullable except for the monotonic projection revision.
ALTER TABLE fsrs_practice_states
  ADD COLUMN IF NOT EXISTS last_attempt_at TIMESTAMPTZ;
ALTER TABLE fsrs_practice_states
  ADD COLUMN IF NOT EXISTS last_outcome TEXT
    CHECK (last_outcome IS NULL OR last_outcome IN ('independent', 'hinted', 'unfinished'));
ALTER TABLE fsrs_practice_states
  ADD COLUMN IF NOT EXISTS last_independent_solve_at TIMESTAMPTZ;
ALTER TABLE fsrs_practice_states
  ADD COLUMN IF NOT EXISTS due_reason TEXT
    CHECK (due_reason IS NULL OR due_reason IN ('monthly_checkpoint', 'three_day_retry'));
ALTER TABLE fsrs_practice_states
  ADD COLUMN IF NOT EXISTS last_attempt_id TEXT;
ALTER TABLE fsrs_practice_states
  ADD COLUMN IF NOT EXISTS revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0);

CREATE UNIQUE INDEX IF NOT EXISTS idx_dsa_practice_attempts_source_event_unique
  ON dsa_practice_attempts (source_event_id)
  WHERE source_event_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_dsa_practice_captures_owner_idempotency
  ON dsa_practice_captures (owner_id, idempotency_key);
CREATE INDEX IF NOT EXISTS idx_dsa_practice_captures_owner_card
  ON dsa_practice_captures (owner_id, card_id);
CREATE INDEX IF NOT EXISTS idx_dsa_practice_learning_notes_owner_card
  ON dsa_practice_learning_notes (owner_id, card_id);
CREATE INDEX IF NOT EXISTS idx_dsa_practice_attempts_owner_due
  ON dsa_practice_attempts (owner_id, next_practice_at, card_id, id);
CREATE INDEX IF NOT EXISTS idx_dsa_practice_attempts_owner_card_due
  ON dsa_practice_attempts (owner_id, card_id, next_practice_at, id);
CREATE INDEX IF NOT EXISTS idx_dsa_practice_attempts_owner_card_history
  ON dsa_practice_attempts (owner_id, card_id, occurred_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_dsa_practice_attempts_owner_independent_history
  ON dsa_practice_attempts (owner_id, card_id, occurred_at DESC, id DESC)
  WHERE outcome = 'independent';
CREATE INDEX IF NOT EXISTS idx_fsrs_practice_states_owner_next_practice_card
  ON fsrs_practice_states (owner_id, next_practice_at, card_id);
CREATE INDEX IF NOT EXISTS idx_fsrs_practice_states_owner_missing_independent
  ON fsrs_practice_states (owner_id, last_independent_solve_at, card_id)
  WHERE last_independent_solve_at IS NULL;

CREATE OR REPLACE FUNCTION prevent_dsa_practice_attempt_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'dsa_practice_attempts are immutable';
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgname = 'trg_dsa_practice_attempts_immutable'
      AND tgrelid = 'dsa_practice_attempts'::regclass
  ) THEN
    CREATE TRIGGER trg_dsa_practice_attempts_immutable
      BEFORE UPDATE OR DELETE ON dsa_practice_attempts
      FOR EACH ROW EXECUTE FUNCTION prevent_dsa_practice_attempt_mutation();
  END IF;
END;
$$;

-- END DSA Practice Phase 0
