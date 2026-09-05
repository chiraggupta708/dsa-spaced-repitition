#!/usr/bin/env node
/**
 * Source-only RED contract for the independent 30-local-day practice cadence.
 * It intentionally reads source text and never imports the DB layer or opens a DB connection.
 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [schema, db] = await Promise.all([
  readFile(path.join(root, 'schema.sql'), 'utf8'),
  readFile(path.join(root, 'lib/db.js'), 'utf8'),
]);

function tableBody(source, tableName) {
  const marker = `CREATE TABLE IF NOT EXISTS ${tableName} (`;
  const start = source.indexOf(marker);
  if (start < 0) return '';
  const end = source.indexOf('\n);', start);
  return end < 0 ? '' : source.slice(start, end + 3);
}

function braceBlock(source, openingBrace) {
  let depth = 0;
  for (let index = openingBrace; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    if (source[index] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(openingBrace, index + 1);
    }
  }
  return '';
}

const failures = [];
const practiceTable = tableBody(schema, 'fsrs_practice_states');
if (!/\bnext_practice_at\s+TIMESTAMPTZ\b/i.test(practiceTable)) {
  failures.push('schema.sql must define fsrs_practice_states.next_practice_at TIMESTAMPTZ');
}

const recordReviewStart = db.indexOf('export async function recordReview(');
const recordReviewEnd = db.indexOf('\nconst DESIGN_COLS', recordReviewStart);
const recordReview = recordReviewStart < 0 ? '' : db.slice(recordReviewStart, recordReviewEnd);
if (!recordReview) failures.push('lib/db.js must contain recordReview');

const solvedGuardMatch = /if\s*\(\s*solvedFromScratch\s*\)\s*\{/.exec(recordReview);
const solvedGuard = solvedGuardMatch
  ? braceBlock(recordReview, solvedGuardMatch.index + solvedGuardMatch[0].lastIndexOf('{'))
  : '';
if (!solvedGuard) {
  failures.push('recordReview must compute practice cadence only behind solvedFromScratch');
} else if (!/scheduleNextDue\s*\(\s*\{[\s\S]*?mode\s*:\s*['"]practice['"][\s\S]*?\}\s*\)/.test(solvedGuard)) {
  failures.push("recordReview must compute the practice due date with scheduleNextDue({ mode: 'practice', ... }) inside the solvedFromScratch guard");
}

const mutationStart = db.indexOf('export function buildShadowReviewMutation(');
const mutationEnd = db.indexOf('\n/**\n * Record a semantic review', mutationStart);
const mutationBuilder = mutationStart < 0 ? '' : db.slice(mutationStart, mutationEnd);
const atomicPracticeWrite = /practice_write\s+AS\s*\([\s\S]*?INSERT\s+INTO\s+fsrs_practice_states\s*\([\s\S]*?\bnext_practice_at\b[\s\S]*?FROM\s+card_update\s+c\s*WHERE\s+\$\d+::boolean[\s\S]*?ON\s+CONFLICT[\s\S]*?\bnext_practice_at\s*=\s*EXCLUDED\.next_practice_at\b/is.test(mutationBuilder);
if (!atomicPracticeWrite) {
  failures.push('the atomic review CTE must gate practice-state upsert from card_update with solvedFromScratch');
}
if (!/practiceDueAt\s*\?\?\s*null\s*,\s*solvedFromScratch/.test(mutationBuilder)) {
  failures.push('the atomic practice write must receive the solvedFromScratch boolean and no due date when overview-only');
}

assert.equal(failures.length, 0, `Practice cadence source contract violations:\n${failures.map((failure) => `- ${failure}`).join('\n')}`);
console.log('Practice cadence source contract: PASS');
