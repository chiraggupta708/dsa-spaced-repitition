#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = fileURLToPath(new URL('.', import.meta.url));
const schemaPath = resolve(scriptDir, '../schema.sql');
const schema = readFileSync(schemaPath, 'utf8');

function table(name) {
  const match = schema.match(new RegExp(`CREATE TABLE IF NOT EXISTS ${name} \\(([\\s\\S]*?)\\n\\);`));
  assert.ok(match, `missing CREATE TABLE IF NOT EXISTS ${name}`);
  return match[1];
}

function includes(source, pattern, message) {
  assert.match(source, pattern, message);
}

const cards = table('cards');
for (const legacyColumn of [
  'easiness_factor', 'interval', 'repetitions', 'next_review', 'last_review', 'last_quality',
]) {
  includes(cards, new RegExp(`\\b${legacyColumn}\\b`), `legacy SM-2 cards.${legacyColumn} must remain`);
}
assert.doesNotMatch(schema, /ALTER TABLE\s+cards\s+(?:DROP COLUMN|ALTER COLUMN)/i,
  'Phase 0 must not drop or alter legacy cards columns');

const events = table('fsrs_review_events');
includes(events, /id\s+TEXT\s+PRIMARY KEY/, 'review event needs immutable text id');
includes(events, /owner_id\s+TEXT\s+NOT NULL\s+REFERENCES users\(clerk_id\) ON DELETE RESTRICT/,
  'review event must be owner-scoped');
includes(events, /card_id\s+TEXT\s+NOT NULL\s+REFERENCES cards\(id\) ON DELETE RESTRICT/,
  'review event must reference a card without cascade deletion');
includes(events, /rating\s+TEXT\s+NOT NULL\s+CHECK \(rating IN \('again', 'hard', 'good', 'easy'\)\)/,
  'review event requires semantic FSRS rating check');
includes(events, /solved\s+BOOLEAN\s+NOT NULL/, 'review event requires solved flag');
includes(events, /occurred_at\s+TIMESTAMPTZ\s+NOT NULL/, 'review event requires occurred time');
includes(events, /scheduled_at\s+TIMESTAMPTZ/, 'review event requires scheduled time');
includes(events, /algorithm_version\s+INTEGER\s+NOT NULL/, 'review event requires algorithm version');
includes(events, /parameter_version\s+INTEGER\s+NOT NULL/, 'review event requires parameter version');
includes(events, /idempotency_key\s+TEXT\s+NOT NULL/, 'review event requires idempotency key');
includes(events, /UNIQUE \(owner_id, idempotency_key\)/, 'review event idempotency must be owner scoped');

const schedules = table('fsrs_card_schedules');
includes(schedules, /owner_id\s+TEXT\s+NOT NULL\s+REFERENCES users\(clerk_id\) ON DELETE RESTRICT/,
  'schedule must be owner-scoped');
includes(schedules, /card_id\s+TEXT\s+NOT NULL\s+REFERENCES cards\(id\) ON DELETE RESTRICT/,
  'schedule must reference a card');
includes(schedules, /due_at\s+TIMESTAMPTZ\s+NOT NULL/, 'schedule requires due time');
includes(schedules, /stability\s+REAL\s+NOT NULL/, 'schedule requires stability');
includes(schedules, /difficulty\s+REAL\s+NOT NULL/, 'schedule requires difficulty');
includes(schedules, /state\s+TEXT\s+NOT NULL\s+CHECK \(state IN \('new', 'learning', 'review', 'relearning'\)\)/,
  'schedule requires semantic FSRS state');
includes(schedules, /schedule_version\s+INTEGER\s+NOT NULL/, 'schedule requires version');
includes(schedules, /PRIMARY KEY \(owner_id, card_id\)/, 'schedule must have one current row per owner/card');

const practiceStates = table('fsrs_practice_states');
includes(practiceStates, /owner_id\s+TEXT\s+NOT NULL\s+REFERENCES users\(clerk_id\) ON DELETE RESTRICT/,
  'practice state must be owner-scoped');
includes(practiceStates, /card_id\s+TEXT\s+NOT NULL\s+REFERENCES cards\(id\) ON DELETE RESTRICT/,
  'practice state must reference a card');
includes(practiceStates, /PRIMARY KEY \(owner_id, card_id\)/, 'practice state must be separate and current per owner/card');

const preferences = table('learner_preferences');
includes(preferences, /owner_id\s+TEXT\s+PRIMARY KEY\s+REFERENCES users\(clerk_id\) ON DELETE RESTRICT/,
  'learner preferences must use owner as primary key');
includes(preferences, /timezone\s+TEXT\s+NOT NULL\s+DEFAULT 'UTC'/,
  'learner preferences must default to IANA UTC');

const parameters = table('fsrs_scheduler_parameters');
includes(parameters, /version\s+INTEGER\s+PRIMARY KEY\s+CHECK \(version > 0\)/,
  'scheduler parameters require a positive version primary key');
includes(parameters, /data\s+JSONB\s+NOT NULL/, 'scheduler parameters require versioned JSONB data');

includes(schema, /CREATE OR REPLACE FUNCTION prevent_fsrs_review_event_mutation\(\)[\s\S]*?RAISE EXCEPTION 'fsrs_review_events are immutable'/,
  'immutable-event trigger function is required');
includes(schema, /CREATE TRIGGER trg_fsrs_review_events_immutable\s+BEFORE UPDATE OR DELETE ON fsrs_review_events[\s\S]*?EXECUTE FUNCTION prevent_fsrs_review_event_mutation\(\)/,
  'immutable-event trigger is required');

for (const index of [
  'idx_fsrs_review_events_owner_card_occurred',
  'idx_fsrs_card_schedules_owner_due',
  'idx_fsrs_practice_states_owner_card',
]) {
  includes(schema, new RegExp(`CREATE INDEX IF NOT EXISTS ${index}\\s+`), `missing ${index}`);
}

console.log('FSRS Phase 0 source-only schema contract: PASS');
