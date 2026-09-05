#!/usr/bin/env node
/**
 * Phase 3 source-only contract. It protects shadow persistence without opening a
 * database: full serializable FSRS state is written, while legacy SM-2 remains
 * the due-queue authority until explicit activation.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = process.cwd();
const schema = readFileSync(resolve(root, 'schema.sql'), 'utf8');
const db = readFileSync(resolve(root, 'lib/db.js'), 'utf8');
const adapter = readFileSync(resolve(root, 'lib/fsrs.js'), 'utf8');

function table(name) {
  const match = schema.match(new RegExp(`CREATE TABLE IF NOT EXISTS ${name} \\(([\\s\\S]*?)\\n\\);`));
  assert.ok(match, `missing CREATE TABLE IF NOT EXISTS ${name}`);
  return match[1];
}

function functionBody(source, signature, nextAnchor) {
  const start = source.indexOf(signature);
  const end = source.indexOf(nextAnchor, start);
  assert.ok(start >= 0 && end > start, `missing source block: ${signature}`);
  return source.slice(start, end);
}

const events = table('fsrs_review_events');
const schedules = table('fsrs_card_schedules');
for (const [pattern, label] of [
  [/\balgorithm\s+TEXT\s+NOT NULL\b/i, 'algorithm label'],
  [/\bstate_before\s+JSONB\b/i, 'event state_before snapshot'],
  [/\bstate_after\s+JSONB\b/i, 'event state_after snapshot'],
  [/\bactual_elapsed_days\s+INTEGER\b/i, 'actual elapsed days'],
  [/\boverdue_days\s+INTEGER\b/i, 'overdue days'],
  [/\bscheduled_interval_days\s+INTEGER\b/i, 'scheduled interval days'],
]) {
  assert.match(events, pattern, `review events must retain ${label}`);
}
assert.match(schedules, /\bcard_state\s+JSONB\b/i,
  'the current schedule must retain full replayable FSRS card state');
assert.match(schema,
  /ALTER TABLE\s+fsrs_review_events\s+ADD COLUMN IF NOT EXISTS\s+state_before\s+JSONB/i,
  'existing dev event tables must receive state_before additively');
assert.match(schema,
  /ALTER TABLE\s+fsrs_card_schedules\s+ADD COLUMN IF NOT EXISTS\s+card_state\s+JSONB/i,
  'existing dev schedule tables must receive card_state additively');

assert.match(adapter, /SCHEDULER_MODES[\s\S]*?SM2[\s\S]*?FSRS_SHADOW[\s\S]*?FSRS_ACTIVE/,
  'the adapter must declare explicit SM-2, shadow, and active modes');
assert.match(adapter, /ACTIVE_SCHEDULER_MODE\s*=\s*SCHEDULER_MODES\.FSRS_SHADOW/,
  'the default must remain FSRS shadow mode');
assert.match(adapter, /export function createFsrsTransition\([\s\S]*?actualElapsedDays[\s\S]*?overdueDays/,
  'the adapter transition must expose actual elapsed and overdue telemetry');
assert.match(adapter, /FSRS_PARAMETER_RECORD[\s\S]*?parameters/,
  'the adapter must export the complete pinned parameter record for persistence');

const mutationBuilder = functionBody(db, 'export function buildShadowReviewMutation(', '\n/**\n * Record a semantic review');
const recordReview = functionBody(db, 'export async function recordReview(', '\nconst DESIGN_COLS');
assert.match(recordReview, /createFsrsTransition\s*\(/,
  'review persistence must compute an FSRS transition in shadow mode');
assert.match(recordReview, /SELECT\s+card_state\s+FROM\s+fsrs_card_schedules/i,
  'review persistence must restore the owner/card schedule state before computing a transition');
assert.match(recordReview, /isSerializedFsrsCard\s*\(/,
  'stored schedule state must be validated instead of silently reset');
assert.match(recordReview, /FSRS_PARAMETER_RECORD/,
  'the parameter row must persist the complete pinned FSRS record');
assert.match(recordReview, /buildShadowReviewMutation\s*\([\s\S]*?db\.query\(mutation\.text,\s*mutation\.params\)/,
  'recordReview must execute the tested atomic shadow mutation builder');
assert.match(mutationBuilder,
  /INSERT\s+INTO\s+fsrs_review_events\s*\([\s\S]*?\balgorithm\b[\s\S]*?\bstate_before\b[\s\S]*?\bstate_after\b[\s\S]*?\bactual_elapsed_days\b[\s\S]*?\boverdue_days\b[\s\S]*?\bscheduled_interval_days\b/is,
  'the atomic event claim must persist all FSRS transition telemetry');
assert.match(mutationBuilder,
  /INSERT\s+INTO\s+fsrs_card_schedules\s*\([\s\S]*?\bcard_state\b/is,
  'the atomic schedule write must persist replayable card state');
assert.match(mutationBuilder, /JSON\.stringify\(transition\.stateBefore\)/,
  'event state_before must be persisted from the adapter result');
assert.match(mutationBuilder, /JSON\.stringify\(transition\.stateAfter\)/,
  'event state_after must be persisted from the adapter result');

const dueQueue = functionBody(db, 'export async function loadDueCards(', '\n\nexport async function upsertCard');
assert.match(dueQueue, /c\.next_review/i, 'shadow mode must retain legacy SM-2 due selection');
assert.doesNotMatch(dueQueue, /fsrs_card_schedules/i,
  'shadow mode must not read FSRS schedules into the user-visible due queue');

console.log('FSRS shadow persistence contract: PASS');
