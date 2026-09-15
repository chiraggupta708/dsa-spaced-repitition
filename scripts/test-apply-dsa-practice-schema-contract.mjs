#!/usr/bin/env node
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DSA_PRACTICE_END_MARKER,
  DSA_PRACTICE_MARKER,
  extractDsaPracticeSchema,
} from './apply-dsa-practice-schema.mjs';
import { splitSchemaStatements } from '../lib/schema-statements.js';

const scriptDir = fileURLToPath(new URL('.', import.meta.url));
const runnerPath = join(scriptDir, 'apply-dsa-practice-schema.mjs');
const schemaPath = join(scriptDir, '..', 'schema.sql');
const packagePath = join(scriptDir, '..', 'package.json');
const runnerSource = readFileSync(runnerPath, 'utf8');
const schema = readFileSync(schemaPath, 'utf8');
const packageJson = JSON.parse(readFileSync(packagePath, 'utf8'));

assert.equal(
  DSA_PRACTICE_MARKER,
  '-- DSA Practice Phase 0 — additive owner-scoped practice attempts.',
  'the runner must use the exact DSA practice start marker',
);
assert.equal(
  DSA_PRACTICE_END_MARKER,
  '-- END DSA Practice Phase 0',
  'the runner must use the exact DSA practice end marker',
);
assert.match(runnerSource, /splitSchemaStatements/);
assert.match(runnerSource, /process\.env\.DATABASE_URL\s*\|\|\s*process\.env\.POSTGRES_URL/);
assert.match(runnerSource, /await\s+sql\.query\(statement\)/);
assert.match(runnerSource, /await import\(['"]@neondatabase\/serverless['"]\)/);
assert.doesNotMatch(runnerSource, /\.split\(['"];['"]\)/,
  'the runner must use the PostgreSQL-aware tested splitter');
assert.doesNotMatch(runnerSource, /CREATE TABLE IF NOT EXISTS users/,
  'the runner must not replay the base schema');

const block = extractDsaPracticeSchema(schema);
assert.ok(block.startsWith(DSA_PRACTICE_MARKER));
assert.ok(!block.includes(DSA_PRACTICE_END_MARKER));
assert.match(block, /CREATE TABLE IF NOT EXISTS dsa_practice_attempts/);
assert.match(block, /ALTER TABLE fsrs_practice_states/);
assert.match(block, /CREATE OR REPLACE FUNCTION prevent_dsa_practice_attempt_mutation\(\)/);
assert.match(block, /DO \$\$/);
assert.doesNotMatch(block, /CREATE TABLE IF NOT EXISTS users/);
assert.doesNotMatch(block, /CREATE TABLE IF NOT EXISTS lld_/);
assert.throws(
  () => extractDsaPracticeSchema('CREATE TABLE IF NOT EXISTS dsa_practice_attempts (id TEXT);'),
  /DSA Practice Phase 0 marker not found/,
  'the DSA runner must fail closed when the start marker is absent',
);
assert.throws(
  () => extractDsaPracticeSchema(`${DSA_PRACTICE_MARKER}\nCREATE TABLE dsa_practice_attempts (id TEXT);`),
  /DSA Practice Phase 0 end marker not found/,
  'the DSA runner must fail closed when the end marker is absent',
);

const statements = splitSchemaStatements(block);
assert.ok(statements.length > 0, 'the DSA block must contain executable statements');
assert.ok(statements.some((statement) => statement.includes('CREATE TABLE IF NOT EXISTS dsa_practice_attempts')));
assert.ok(
  statements.some((statement) => statement.includes('CREATE OR REPLACE FUNCTION prevent_dsa_practice_attempt_mutation()')),
  'the immutable-attempt function must remain one statement',
);
assert.ok(
  statements.some((statement) => statement.trimStart().startsWith('DO $$')),
  'the immutable-attempt trigger DO block must remain one statement',
);
assert.ok(statements.every((statement) => !statement.includes('CREATE TABLE IF NOT EXISTS users')));
assert.ok(statements.every((statement) => !statement.includes('CREATE TABLE IF NOT EXISTS lld_')));

assert.equal(packageJson.scripts.build, 'node scripts/verify-build.mjs');
assert.doesNotMatch(packageJson.scripts.build, /apply-(?:dsa-practice|fsrs)-schema/,
  'database migration runners must remain outside the package build');

const env = { ...process.env };
delete env.DATABASE_URL;
delete env.POSTGRES_URL;
let failure;
try {
  execFileSync(process.execPath, [runnerPath], {
    cwd: join(scriptDir, '..'),
    env,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
} catch (error) {
  failure = error;
}
assert.ok(failure, 'the direct DSA migration runner must fail without a database URL');
assert.equal(failure.status, 1, 'missing database configuration must exit with status 1');
assert.match(`${failure.stdout ?? ''}${failure.stderr ?? ''}`, /DATABASE_URL \(or POSTGRES_URL\) is required\./,
  'missing database configuration must be reported without attempting a connection');

console.log('DSA practice schema runner contract: PASS');
