#!/usr/bin/env node
/**
 * Database-free structural contract for recordReview's single-statement commit.
 * It verifies SQL CTE dependencies rather than opening Neon or a database.
 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = await readFile(path.join(root, 'lib/db.js'), 'utf8');
const start = source.indexOf('export async function recordReview(');
const end = source.indexOf('\nconst DESIGN_COLS', start);
const recordReview = start >= 0 && end > start ? source.slice(start, end) : '';

function dbQueryCalls(body) {
  const calls = [];
  const needle = 'db.query(';
  let cursor = 0;
  while (cursor < body.length) {
    const startAt = body.indexOf(needle, cursor);
    if (startAt < 0) break;
    let depth = 0;
    let quote = null;
    let escaped = false;
    for (let index = startAt + needle.length; index < body.length; index += 1) {
      const char = body[index];
      if (quote) {
        if (!escaped && char === quote) quote = null;
        escaped = !escaped && char === '\\';
        continue;
      }
      if (char === '`' || char === '"' || char === "'") {
        quote = char;
      } else if (char === '(') {
        depth += 1;
      } else if (char === ')') {
        if (depth === 0) {
          calls.push(body.slice(startAt, index + 1));
          cursor = index + 1;
          break;
        }
        depth -= 1;
      }
    }
  }
  return calls;
}

const failures = [];
if (!recordReview) failures.push('recordReview must exist');
const calls = dbQueryCalls(recordReview);
const mutationCalls = calls.filter((call) => /\b(?:INSERT\s+INTO\s+(?:fsrs_scheduler_parameters|fsrs_review_events|fsrs_card_schedules|fsrs_practice_states)|UPDATE\s+cards)\b/i.test(call));
if (mutationCalls.length !== 1) {
  failures.push(`all review mutations must occur in exactly one db.query call (found ${mutationCalls.length})`);
}

const atomic = mutationCalls[0] || '';
if (!/^db\.query\(\s*`\s*WITH\s+seeded_parameter\s+AS\s*\(/is.test(atomic)) {
  failures.push('the sole mutation query must be a data-modifying CTE beginning with seeded_parameter');
}
if (!/seeded_parameter[\s\S]*?INSERT\s+INTO\s+fsrs_scheduler_parameters[\s\S]*?ON\s+CONFLICT\s*\(\s*version\s*\)\s*DO\s+NOTHING/is.test(atomic)) {
  failures.push('the CTE must idempotently seed the parameter version');
}
const eventAt = atomic.search(/event_claim\s+AS\s*\([\s\S]*?INSERT\s+INTO\s+fsrs_review_events/is);
const cardAt = atomic.search(/card_update\s+AS\s*\([\s\S]*?UPDATE\s+cards/is);
const scheduleAt = atomic.search(/schedule_write\s+AS\s*\([\s\S]*?INSERT\s+INTO\s+fsrs_card_schedules/is);
const practiceAt = atomic.search(/practice_write\s+AS\s*\([\s\S]*?INSERT\s+INTO\s+fsrs_practice_states/is);
if (!(eventAt >= 0 && cardAt > eventAt && scheduleAt > cardAt && practiceAt > scheduleAt)) {
  failures.push('CTE order must be event claim, card compare-and-swap, schedule, then practice');
}
if (!/INSERT\s+INTO\s+fsrs_review_events[\s\S]*?ON\s+CONFLICT\s*\(\s*owner_id\s*,\s*idempotency_key\s*\)\s*DO\s+NOTHING[\s\S]*?RETURNING/is.test(atomic)
  || !/crypto\.randomUUID\(\)[\s\S]*?owner[\s\S]*?id[\s\S]*?normalizedRating/.test(atomic)) {
  failures.push('event claim must use a generated random ID, owner/key idempotency conflict gate, and return only a new event');
}
if (!/UPDATE\s+cards\s+c[\s\S]*?FROM\s+event_claim\s+e[\s\S]*?c\.updated_at\s*=\s*\$\d+[\s\S]*?e\.parameter_version\s*=\s*\$\d+/is.test(atomic)) {
  failures.push('card mutation must derive from event_claim and compare updated_at with the pre-read timestamp/version');
}
if (!/schedule_write[\s\S]*?SELECT[\s\S]*?FROM\s+card_update/is.test(atomic)
  || !/practice_write[\s\S]*?FROM\s+card_update[\s\S]*?\$\d+::boolean/is.test(atomic)) {
  failures.push('schedule and solved-only practice writes must derive from successful card_update');
}
if (!/claim_guard\s+AS\s*\([\s\S]*?1\s*\/\s*CASE[\s\S]*?event_claim[\s\S]*?card_update[\s\S]*?SELECT[\s\S]*?FROM\s+event_claim[\s\S]*?claim_guard/is.test(atomic)) {
  failures.push('a guard referenced by the result must error when a newly claimed event has no successful card compare-and-swap');
}
if (!/SELECT\s+e\.id[\s\S]*?FROM\s+event_claim\s+e[\s\S]*?claim_guard/is.test(atomic)) {
  failures.push('the atomic statement must return event data from the event claim');
}

assert.equal(failures.length, 0, `Atomic review persistence contract violations:\n${failures.map((failure) => `- ${failure}`).join('\n')}`);
console.log('Atomic review persistence contract: PASS');
