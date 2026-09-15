#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { splitSchemaStatements } from '../lib/schema-statements.js';

const scriptDir = fileURLToPath(new URL('.', import.meta.url));
const schemaPath = join(scriptDir, '..', 'schema.sql');
const schema = readFileSync(schemaPath, 'utf8');

const FSRS_MARKER = '-- FSRS Phase 0 — additive scheduler records.';
const DSA_MARKER = '-- DSA Practice Phase 0 — additive owner-scoped practice attempts.';
const DSA_END_MARKER = '-- END DSA Practice Phase 0';

function includes(source, pattern, message) {
  assert.match(source, pattern, message);
}

function extractBoundedBlock(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.ok(start >= 0, `missing start marker: ${startMarker}`);
  assert.ok(end > start, `missing or misplaced end marker: ${endMarker}`);
  return source.slice(start, end);
}

function table(name, source) {
  const match = source.match(new RegExp(`CREATE TABLE IF NOT EXISTS ${name} \\(([\\s\\S]*?)\\n\\);`));
  assert.ok(match, `missing CREATE TABLE IF NOT EXISTS ${name}`);
  return match[1];
}

const fsrsMarkerIndex = schema.indexOf(FSRS_MARKER);
const dsaMarkerIndex = schema.indexOf(DSA_MARKER);
const dsaEndMarkerIndex = schema.indexOf(DSA_END_MARKER);
assert.ok(fsrsMarkerIndex >= 0, 'the existing FSRS marker must remain');
assert.ok(dsaMarkerIndex > fsrsMarkerIndex, 'the DSA block must follow the existing FSRS block');
assert.ok(dsaEndMarkerIndex > dsaMarkerIndex, 'the DSA block must have an explicit end marker');
assert.equal(schema.indexOf(DSA_MARKER, dsaMarkerIndex + DSA_MARKER.length), -1,
  'the bounded DSA start marker must appear once');
assert.equal(schema.slice(dsaEndMarkerIndex + DSA_END_MARKER.length).trim(), '',
  'the DSA block must be the final bounded schema block');

const dsaBlock = extractBoundedBlock(schema, DSA_MARKER, DSA_END_MARKER);
const attempts = table('dsa_practice_attempts', dsaBlock);
const captures = table('dsa_practice_captures', dsaBlock);
const learningNotes = table('dsa_practice_learning_notes', dsaBlock);

includes(attempts, /id\s+TEXT\s+PRIMARY KEY/, 'attempts need immutable text ids');
includes(attempts, /owner_id\s+TEXT\s+NOT NULL\s+REFERENCES users\(clerk_id\) ON DELETE RESTRICT/,
  'attempts must be owner scoped with restrictive owner deletion');
includes(attempts, /card_id\s+TEXT\s+NOT NULL\s+REFERENCES cards\(id\) ON DELETE RESTRICT/,
  'attempts must reference cards without cascade deletion');
includes(attempts, /occurred_at\s+TIMESTAMPTZ\s+NOT NULL/, 'attempts need a server-recorded occurrence time');
includes(attempts, /time_zone\s+TEXT(?!\s+NOT NULL)/, 'historical timezone must remain nullable');
includes(attempts, /outcome\s+TEXT\s+NOT NULL\s+CHECK\s+\(outcome IN \('independent', 'hinted', 'unfinished'\)\)/,
  'attempt outcomes must use the DSA allowlist');
includes(attempts, /next_practice_at\s+TIMESTAMPTZ\s+NOT NULL/, 'attempts need an explicit next practice time');
includes(attempts, /due_reason\s+TEXT\s+NOT NULL\s+CHECK\s+\(due_reason IN \('monthly_checkpoint', 'three_day_retry'\)\)/,
  'due reasons must use the DSA allowlist');

for (const [column, maxLength] of [
  ['blocker', 1000],
  ['reflection', 2000],
  ['challenge_approach', 2000],
  ['challenge_invariant', 1000],
  ['challenge_complexity', 500],
]) {
  includes(
    attempts,
    new RegExp(`${column}\\s+TEXT\\s+CHECK\\s*\\(\\s*${column}\\s+IS\\s+NULL\\s+OR\\s+char_length\\(${column}\\)\\s+<=\\s+${maxLength}\\s*\\)`),
    `${column} must be nullable and bounded`,
  );
}

includes(attempts, /source\s+TEXT\s+NOT NULL\s+CHECK\s+\(source IN \('practice', 'legacy_review'\)\)/,
  'attempt sources must use the practice/legacy_review allowlist');
includes(attempts, /source_event_id\s+TEXT(?!\s+NOT NULL)/,
  'legacy source event IDs must be nullable for normal practice');
includes(attempts, /idempotency_key\s+TEXT\s+NOT NULL/, 'attempts need an idempotency key');
includes(attempts, /request_fingerprint\s+TEXT\s+NOT NULL/, 'attempts need a normalized request fingerprint');
includes(attempts, /created_at\s+TIMESTAMPTZ\s+NOT NULL\s+DEFAULT NOW\(\)/,
  'attempts need a server creation timestamp');
includes(attempts, /UNIQUE \(owner_id, idempotency_key\)/,
  'idempotency must be unique per owner');
includes(attempts, /UNIQUE \(source_event_id\)/,
  'legacy source events must be unique when non-null');

includes(captures, /id\s+TEXT\s+PRIMARY KEY/, 'capture claims need immutable ids');
includes(captures, /owner_id\s+TEXT\s+NOT NULL\s+REFERENCES users\(clerk_id\) ON DELETE RESTRICT/,
  'capture claims must be owner scoped');
includes(captures, /card_id\s+TEXT(?!\s+NOT NULL)/,
  'capture card_id must remain nullable while the statement claims it');
includes(captures, /request_fingerprint\s+TEXT\s+NOT NULL/,
  'capture claims need a request fingerprint');
includes(captures, /status\s+TEXT\s+NOT NULL[\s\S]*pending[\s\S]*created[\s\S]*duplicate/,
  'capture claims need pending, created, and duplicate statuses');
includes(captures, /UNIQUE \(owner_id, idempotency_key\)/,
  'capture idempotency must be unique per owner');
includes(learningNotes, /owner_id\s+TEXT\s+NOT NULL/,
  'learning notes must be owner scoped');
includes(learningNotes, /card_id\s+TEXT\s+NOT NULL/,
  'learning notes must bind to a card');
includes(learningNotes, /key_insight/);
includes(learningNotes, /recurring_trap/);

for (const [column, definition] of [
  ['last_attempt_at', 'TIMESTAMPTZ'],
  ['last_outcome', "TEXT"],
  ['last_independent_solve_at', 'TIMESTAMPTZ'],
  ['due_reason', 'TEXT'],
  ['last_attempt_id', 'TEXT'],
  ['revision', 'INTEGER'],
]) {
  includes(
    dsaBlock,
    new RegExp(`ALTER TABLE\\s+fsrs_practice_states\\s+ADD COLUMN IF NOT EXISTS\\s+${column}\\s+${definition}`, 'i'),
    `fsrs_practice_states must add ${column} without replacing existing columns`,
  );
}
includes(dsaBlock, /last_outcome[^;]*CHECK[^;]*\('independent', 'hinted', 'unfinished'\)/s,
  'last_outcome must preserve the DSA outcome allowlist');
includes(dsaBlock, /due_reason[^;]*CHECK[^;]*\('monthly_checkpoint', 'three_day_retry'\)/s,
  'practice-state due_reason must preserve the DSA due-reason allowlist');
includes(dsaBlock, /ADD COLUMN IF NOT EXISTS\s+revision\s+INTEGER\s+NOT NULL\s+DEFAULT\s+0\s+CHECK\s+\(revision >= 0\)/,
  'practice-state revision must be monotonic and non-negative');

for (const index of [
  'idx_dsa_practice_attempts_owner_due',
  'idx_dsa_practice_attempts_owner_card_due',
  'idx_dsa_practice_attempts_owner_card_history',
  'idx_dsa_practice_attempts_owner_independent_history',
  'idx_fsrs_practice_states_owner_next_practice_card',
  'idx_fsrs_practice_states_owner_missing_independent',
]) {
  includes(dsaBlock, new RegExp(`CREATE INDEX IF NOT EXISTS ${index}\\s+`), `missing ${index}`);
}
includes(
  dsaBlock,
  /CREATE INDEX IF NOT EXISTS idx_fsrs_practice_states_owner_next_practice_card[\s\S]*?ON fsrs_practice_states\s*\(\s*owner_id\s*,\s*next_practice_at\s*,\s*card_id\s*\)/,
  'due queue projection index must match owner, next_practice_at, card_id ordering',
);
includes(
  dsaBlock,
  /CREATE INDEX IF NOT EXISTS idx_fsrs_practice_states_owner_missing_independent[\s\S]*?ON fsrs_practice_states\s*\(\s*owner_id\s*,\s*last_independent_solve_at\s*,\s*card_id\s*\)\s*WHERE\s+last_independent_solve_at\s+IS\s+NULL/,
  'first-check projection index must be owner scoped and partial on missing independent solves',
);
includes(dsaBlock, /CREATE UNIQUE INDEX IF NOT EXISTS idx_dsa_practice_attempts_source_event_unique[\s\S]*?ON dsa_practice_attempts \(source_event_id\)\s+WHERE source_event_id IS NOT NULL/,
  'legacy source events must be unique only when present');

includes(dsaBlock, /CREATE OR REPLACE FUNCTION prevent_dsa_practice_attempt_mutation\(\)[\s\S]*?RAISE EXCEPTION 'dsa_practice_attempts are immutable'/,
  'immutable attempt trigger function is required');
includes(dsaBlock, /CREATE TRIGGER trg_dsa_practice_attempts_immutable\s+BEFORE UPDATE OR DELETE ON dsa_practice_attempts[\s\S]*?EXECUTE FUNCTION prevent_dsa_practice_attempt_mutation\(\)/,
  'immutable attempt trigger is required');

const dsaStatements = splitSchemaStatements(dsaBlock);
assert.ok(dsaStatements.length > 0, 'the DSA block must contain executable statements');
const executableDsaStatements = dsaStatements.map((statement) =>
  statement.split('\n').filter((line) => !line.trimStart().startsWith('--')).join('\n').trimStart(),
);
assert.ok(executableDsaStatements.every(Boolean), 'the DSA block must not produce comment-only statements');
for (const statement of executableDsaStatements) {
  assert.match(
    statement,
    /^(?:CREATE TABLE IF NOT EXISTS (?:dsa_practice_attempts|dsa_practice_captures|dsa_practice_learning_notes)|ALTER TABLE fsrs_practice_states|CREATE (?:UNIQUE )?INDEX IF NOT EXISTS (?:idx_dsa_practice_(?:attempts_|captures_|learning_notes_)|idx_fsrs_practice_states_owner_(?:next_practice_card|missing_independent)\b)|CREATE OR REPLACE FUNCTION prevent_dsa_practice_attempt_mutation|DO \$\$)/,
    `unexpected DSA migration statement: ${statement.slice(0, 80)}`,
  );
}

assert.doesNotMatch(dsaBlock, /CREATE TABLE IF NOT EXISTS (?!dsa_practice_attempts\b|dsa_practice_captures\b|dsa_practice_learning_notes\b)/,
  'the DSA block must not create unrelated tables');
assert.doesNotMatch(dsaBlock, /ALTER TABLE\s+(?!fsrs_practice_states\b)/,
  'the DSA block must not alter unrelated tables');
assert.doesNotMatch(dsaBlock, /\b(?:INSERT\s+INTO|UPDATE\s+\w+\s+SET|DELETE\s+FROM)\b/i,
  'the additive schema must not backfill or delete user data');
assert.doesNotMatch(dsaBlock, /CREATE TABLE IF NOT EXISTS (?:users|cards|tags|designs|lld_)/,
  'the DSA block must preserve LLD/HLD and shared tables');

assert.match(schema, /CREATE TABLE IF NOT EXISTS lld_designs/,
  'existing LLD schema must remain in schema.sql');
assert.match(schema, /CREATE TABLE IF NOT EXISTS fsrs_review_events/,
  'existing FSRS schema must remain in schema.sql');

console.log('DSA practice source-only schema contract: PASS');
