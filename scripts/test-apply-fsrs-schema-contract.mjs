import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DSA_PRACTICE_MARKER,
  FSRS_PHASE0_MARKER,
  extractFsrsPhase0Schema,
} from './apply-fsrs-schema.mjs';
import { splitSchemaStatements } from '../lib/schema-statements.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const runnerPath = join(__dirname, 'apply-fsrs-schema.mjs');
const schemaPath = join(__dirname, '..', 'schema.sql');
const runnerSource = readFileSync(runnerPath, 'utf8');
const schema = readFileSync(schemaPath, 'utf8');

assert.equal(
  FSRS_PHASE0_MARKER,
  '-- FSRS Phase 0 — additive scheduler records.',
  'the runner must use the exact FSRS Phase 0 marker',
);
assert.equal(
  DSA_PRACTICE_MARKER,
  '-- DSA Practice Phase 0 — additive owner-scoped practice attempts.',
  'the FSRS runner must use the exact DSA end marker',
);
assert.ok(schema.indexOf(DSA_PRACTICE_MARKER) > schema.indexOf(FSRS_PHASE0_MARKER));
assert.match(runnerSource, /await import\(['"]@neondatabase\/serverless['"]\)/);
assert.match(runnerSource, /splitSchemaStatements/);
assert.match(runnerSource, /process\.env\.DATABASE_URL\s*\|\|\s*process\.env\.POSTGRES_URL/);
assert.match(runnerSource, /await\s+sql\.query\(statement\)/);
assert.match(runnerSource, /DSA_PRACTICE_MARKER/);
assert.doesNotMatch(runnerSource, /\.split\(['"];['"]\)/);

const block = extractFsrsPhase0Schema(schema);
assert.ok(block.startsWith(FSRS_PHASE0_MARKER));
assert.ok(!block.includes(DSA_PRACTICE_MARKER),
  'the FSRS extraction must stop before the DSA marker');
assert.match(block, /CREATE TABLE IF NOT EXISTS fsrs_scheduler_parameters/);
assert.match(block, /CREATE TABLE IF NOT EXISTS fsrs_review_events/);
assert.match(block, /CREATE OR REPLACE FUNCTION prevent_fsrs_review_event_mutation\(\)/);
assert.match(block, /DO \$\$/);
assert.doesNotMatch(block, /CREATE TABLE IF NOT EXISTS users/);
assert.doesNotMatch(block, /CREATE TABLE IF NOT EXISTS lld_designs/);
assert.doesNotMatch(block, /CREATE TABLE IF NOT EXISTS dsa_practice_attempts/);
assert.throws(
  () => extractFsrsPhase0Schema('CREATE TABLE IF NOT EXISTS fsrs_review_events (id TEXT);'),
  /FSRS Phase 0 marker not found/,
  'the runner must fail closed when the exact FSRS marker is absent',
);
assert.throws(
  () => extractFsrsPhase0Schema(`${FSRS_PHASE0_MARKER}\nCREATE TABLE fsrs_review_events (id TEXT);`),
  /DSA Practice Phase 0 marker not found/,
  'the runner must fail closed when the DSA boundary marker is absent',
);

const statements = splitSchemaStatements(block);
assert.ok(statements.length > 0, 'the FSRS block must contain executable statements');
assert.ok(statements.every((statement) => !statement.includes('CREATE TABLE IF NOT EXISTS users')));
assert.ok(statements.every((statement) => !statement.includes('CREATE TABLE IF NOT EXISTS lld_')));
assert.ok(statements.every((statement) => !statement.includes('CREATE TABLE IF NOT EXISTS dsa_')));
assert.ok(
  statements.some((statement) => statement.includes('CREATE OR REPLACE FUNCTION prevent_fsrs_review_event_mutation()')),
  'the function must remain in the extracted statements',
);
assert.ok(
  statements.some((statement) => statement.trimStart().startsWith('DO $$')),
  'the trigger DO block must remain in the extracted statements',
);

console.log('FSRS-only schema runner contract: PASS');
