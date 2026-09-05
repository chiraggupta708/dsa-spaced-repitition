#!/usr/bin/env node
/**
 * Database-free structural contract for recordReview's single-statement commit.
 * It verifies the pure CTE builder and that recordReview uses it, rather than
 * opening Neon or a database.
 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = await readFile(path.join(root, 'lib/db.js'), 'utf8');

function sourceBlock(signature, nextAnchor) {
  const start = source.indexOf(signature);
  const end = source.indexOf(nextAnchor, start);
  return start >= 0 && end > start ? source.slice(start, end) : '';
}

const mutationBuilder = sourceBlock('export function buildShadowReviewMutation(', '\n/**\n * Record a semantic review');
const recordReview = sourceBlock('export async function recordReview(', '\nconst DESIGN_COLS');
const failures = [];

if (!mutationBuilder) failures.push('buildShadowReviewMutation must exist');
if (!recordReview) failures.push('recordReview must exist');
if (!/buildShadowReviewMutation\s*\(/.test(recordReview)
  || !/eventId:\s*crypto\.randomUUID\(\)/.test(recordReview)
  || !/db\.query\(mutation\.text,\s*mutation\.params\)/.test(recordReview)) {
  failures.push('recordReview must invoke the CTE builder exactly through mutation.text/mutation.params with a generated event ID');
}
if (!/return\s*\{\s*text:\s*`\s*WITH\s+seeded_parameter\s+AS\s*\(/is.test(mutationBuilder)) {
  failures.push('the pure mutation builder must return a data-modifying CTE beginning with seeded_parameter');
}
if (!/seeded_parameter[\s\S]*?INSERT\s+INTO\s+fsrs_scheduler_parameters[\s\S]*?ON\s+CONFLICT\s*\(\s*version\s*\)\s*DO\s+NOTHING/is.test(mutationBuilder)) {
  failures.push('the CTE must idempotently seed the parameter version');
}
const eventAt = mutationBuilder.search(/event_claim\s+AS\s*\([\s\S]*?INSERT\s+INTO\s+fsrs_review_events/is);
const cardAt = mutationBuilder.search(/card_update\s+AS\s*\([\s\S]*?UPDATE\s+cards/is);
const scheduleAt = mutationBuilder.search(/schedule_write\s+AS\s*\([\s\S]*?INSERT\s+INTO\s+fsrs_card_schedules/is);
const practiceAt = mutationBuilder.search(/practice_write\s+AS\s*\([\s\S]*?INSERT\s+INTO\s+fsrs_practice_states/is);
if (!(eventAt >= 0 && cardAt > eventAt && scheduleAt > cardAt && practiceAt > scheduleAt)) {
  failures.push('CTE order must be event claim, card compare-and-swap, schedule, then practice');
}
if (!/INSERT\s+INTO\s+fsrs_review_events[\s\S]*?ON\s+CONFLICT\s*\(\s*owner_id\s*,\s*idempotency_key\s*\)\s*DO\s+NOTHING[\s\S]*?RETURNING/is.test(mutationBuilder)) {
  failures.push('event claim must use the owner/key idempotency conflict gate and return only a new event');
}
if (!/UPDATE\s+cards\s+c[\s\S]*?FROM\s+event_claim\s+e[\s\S]*?c\.updated_at\s*=\s*\$\d+[\s\S]*?e\.parameter_version\s*=\s*\$\d+/is.test(mutationBuilder)) {
  failures.push('card mutation must derive from event_claim and compare updated_at with the pre-read timestamp/version');
}
if (!/schedule_write[\s\S]*?SELECT[\s\S]*?FROM\s+card_update/is.test(mutationBuilder)
  || !/practice_write[\s\S]*?FROM\s+card_update[\s\S]*?\$\d+::boolean/is.test(mutationBuilder)) {
  failures.push('schedule and solved-only practice writes must derive from successful card_update');
}
if (!/claim_guard\s+AS\s*\([\s\S]*?1\s*\/\s*CASE[\s\S]*?event_claim[\s\S]*?card_update[\s\S]*?SELECT[\s\S]*?FROM\s+event_claim[\s\S]*?claim_guard/is.test(mutationBuilder)) {
  failures.push('a guard referenced by the result must error when a newly claimed event has no successful card compare-and-swap');
}
if (!/SELECT\s+e\.id[\s\S]*?FROM\s+event_claim\s+e[\s\S]*?claim_guard/is.test(mutationBuilder)) {
  failures.push('the atomic statement must return event data from the event claim');
}

assert.equal(failures.length, 0, `Atomic review persistence contract violations:\n${failures.map((failure) => `- ${failure}`).join('\n')}`);
console.log('Atomic review persistence contract: PASS');
