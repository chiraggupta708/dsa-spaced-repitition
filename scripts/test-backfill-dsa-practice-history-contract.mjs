#!/usr/bin/env node
/**
 * Database-free source contract for the explicit DSA history backfill.
 * It reads source and starts the script only without database credentials; it
 * never imports Neon, opens a database, runs a migration, or starts a server.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const scriptPath = join(root, 'scripts', 'backfill-dsa-practice-history.mjs');
const schemaPath = join(root, 'schema.sql');
const packagePath = join(root, 'package.json');
const buildPath = join(root, 'scripts', 'verify-build.mjs');
const source = readFileSync(scriptPath, 'utf8');
const schema = readFileSync(schemaPath, 'utf8');
const packageJson = JSON.parse(readFileSync(packagePath, 'utf8'));
const buildSource = readFileSync(buildPath, 'utf8');

function sourceBlock(marker, nextMarker) {
  const start = source.indexOf(marker);
  assert.ok(start >= 0, `missing source marker: ${marker}`);
  const end = nextMarker ? source.indexOf(nextMarker, start + marker.length) : source.length;
  return source.slice(start, end < 0 ? source.length : end);
}

const selection = sourceBlock('export function buildHistoricalReviewBatchQuery(', 'export function buildLegacyPracticeMutation');
const mutation = sourceBlock('export function buildLegacyPracticeMutation(', 'export async function backfillDsaPracticeHistory');
const backfill = sourceBlock('export async function backfillDsaPracticeHistory(', 'const isDirectInvocation');
const identity = sourceBlock('export function buildLegacyPracticeIdentity(', 'export function buildHistoricalReviewBatchQuery');
const {
  buildHistoricalReviewBatchQuery,
  buildLegacyPracticeIdentity,
  buildLegacyPracticeMutation,
  prepareLegacyPracticeRow,
} = await import(pathToFileURL(scriptPath).href);

assert.match(source, /process\.env\.DATABASE_URL\s*\|\|\s*process\.env\.POSTGRES_URL/,
  'the backfill must read only the supported database URL variables');
assert.match(source, /if\s*\(!connectionString\)[\s\S]*?DATABASE_URL \(or POSTGRES_URL\) is required/,
  'the backfill must fail closed before attempting a connection');
assert.match(selection, /re\.solved\s*=\s*TRUE/i, 'selection must require verified solved review events');
assert.match(selection, /JOIN\s+cards\s+c\s+ON\s+c\.id\s*=\s*re\.card_id\s+AND\s+c\.owner_id\s*=\s*re\.owner_id/i,
  'selection must re-check the owner/card relationship');
assert.match(selection, /JOIN\s+learner_preferences\s+lp\s+ON\s+lp\.owner_id\s*=\s*re\.owner_id/i,
  'selection must require a persisted learner preference row');
assert.match(selection, /NULLIF\(\s*BTRIM\(lp\.timezone\)\s*,\s*''\s*\)\s+IS\s+NOT\s+NULL/i,
  'selection must reject missing or blank persisted time zones');
assert.match(selection, /NOT\s+EXISTS\s*\([\s\S]*?dsa_practice_attempts[\s\S]*?source_event_id\s*=\s*re\.id/is,
  'selection must be idempotent on the historical source event ID');
assert.match(selection, /\(re\.occurred_at\s*,\s*re\.id\)\s*>\s*\(\$1::timestamptz\s*,\s*\$2::text\)/i,
  'selection must use ascending occurred_at/id keyset pagination');
assert.match(selection, /ORDER\s+BY\s+re\.occurred_at\s+ASC\s*,\s*re\.id\s+ASC/i,
  'selection ordering must match its keyset');
assert.match(selection, /LIMIT\s+\$3/i, 'selection must apply a database-side batch limit');
assert.doesNotMatch(source, /\bOFFSET\b/i, 'the backfill must never use OFFSET pagination');

assert.match(source, /normalizePracticeTimeZone\(/, 'persisted time zones must use the existing domain validator');
assert.match(source, /schedulePracticeOutcome\(\s*\{[\s\S]*?outcome:\s*'independent'[\s\S]*?timeZone[\s\S]*?now:\s*occurredAt/is,
  'historical solves must use the local-calendar practice scheduler');
assert.doesNotMatch(source, /['"]UTC['"]/, 'the backfill must not invent UTC for missing or invalid preferences');
assert.match(source, /catch(?:\s*\([^)]*\))?\s*\{[\s\S]*?skipped/i, 'invalid historical rows must be skipped rather than assigned a fallback');

assert.match(source, /DEFAULT_BATCH_SIZE\s*=\s*100/,
  'the default backfill batch must be bounded at 100 or less');
assert.match(source, /MAX_BATCH_SIZE\s*=\s*100/,
  'the backfill must enforce a maximum batch size of 100');
assert.match(source, /Math\.min\([^\n]*MAX_BATCH_SIZE|Math\.min\([^\n]*100/,
  'caller-provided batch sizes must remain bounded');
assert.match(backfill, /while\s*\(true\)/, 'backfill must fetch successive bounded batches');
assert.match(backfill, /cursor\s*=|occurred_at|source_event_id/, 'backfill must advance a stable cursor after each batch');

assert.match(identity, /legacy-review:/, 'legacy attempt identity must be deterministic');
assert.match(source, /createHash\(['"]sha256['"]\)/, 'legacy fingerprint must be deterministic');
assert.match(identity, /sourceEventId/, 'legacy identity must include the source event ID');
assert.match(mutation, /INSERT\s+INTO\s+dsa_practice_attempts/i);
assert.match(mutation, /'legacy_review'/, 'backfill attempts must carry the legacy_review source');
assert.match(mutation, /source_event_id/);
assert.match(mutation, /JOIN\s+fsrs_review_events\s+re[\s\S]*?re\.owner_id\s*=\s*batch\.owner_id[\s\S]*?re\.solved\s*=\s*TRUE/is,
  'the atomic batch must revalidate solved source ownership');
assert.match(mutation, /lp\.timezone\s+IS\s+NOT\s+NULL/i,
  'the atomic batch must revalidate the persisted timezone row');
assert.match(mutation, /ON\s+CONFLICT\s*\(\s*source_event_id\s*\)\s+DO\s+NOTHING/i,
  're-runs must be idempotent on source_event_id');
assert.match(mutation, /WITH\s+verified_candidates\s+AS[\s\S]*?inserted\s+AS[\s\S]*?latest_per_card\s+AS[\s\S]*?projection\s+AS/is,
  'one mutation must chain insert and projection CTEs atomically');
assert.match(mutation, /DISTINCT\s+ON\s*\(\s*owner_id\s*,\s*card_id\s*\)/i,
  'projection must select one latest inserted event per card');
assert.match(mutation, /ORDER\s+BY\s+owner_id\s*,\s*card_id\s*,\s*occurred_at\s+DESC\s*,\s*source_event_id\s+DESC/i,
  'latest-per-card projection must have a deterministic event order');
assert.match(mutation, /INSERT\s+INTO\s+fsrs_practice_states/i);
assert.match(mutation, /ON\s+CONFLICT\s*\(\s*owner_id\s*,\s*card_id\s*\)\s+DO\s+UPDATE/i);
assert.match(mutation, /EXCLUDED\.last_attempt_at\s*>\s*COALESCE\(/i,
  'projection must compare incoming and persisted attempt times monotonically');
assert.match(mutation, /EXCLUDED\.last_independent_solve_at[\s\S]*?fsrs_practice_states\.last_independent_solve_at/is,
  'independent solve projection must retain the newest historical solve');
assert.match(mutation, /revision\s*=\s*fsrs_practice_states\.revision\s*\+\s*1/i,
  'projection revisions must increase rather than reset');
assert.match(backfill, /await\s+db\.query\(\s*mutation\.text\s*,\s*mutation\.params\s*\)/,
  'each prepared batch must use the atomic data-modifying statement');

const firstPage = buildHistoricalReviewBatchQuery({ limit: 1000 });
assert.equal(firstPage.params[0], null, 'the first keyset page must start without a fabricated lower-bound instant');
assert.equal(firstPage.params[1], null, 'the first keyset page must start without a fabricated lower-bound ID');
assert.equal(firstPage.params[2], 100, 'the helper must cap a requested batch at 100');
const nextPage = buildHistoricalReviewBatchQuery({
  cursor: { occurredAt: '2024-01-01T00:00:00.000Z', id: 'event-1' },
  limit: 2,
});
assert.deepEqual(nextPage.params, ['2024-01-01T00:00:00.000Z', 'event-1', 2]);

const historicalRow = {
  id: 'event-1',
  owner_id: 'owner-1',
  card_id: 'card-1',
  occurred_at: '2024-03-09T17:00:00.000Z',
  time_zone: 'America/New_York',
};
const prepared = prepareLegacyPracticeRow(historicalRow);
assert.equal(prepared.skipped, false);
assert.equal(prepared.dueReason, 'monthly_checkpoint');
assert.equal(
  new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(new Date(prepared.nextPracticeAt)),
  '2024-04-08',
  'the helper must schedule 30 local calendar days later',
);
assert.equal(prepareLegacyPracticeRow({ ...historicalRow, time_zone: 'Not/AZone' }).skipped, true);
assert.equal(prepareLegacyPracticeRow({ ...historicalRow, time_zone: null }).skipped, true);
assert.deepEqual(
  buildLegacyPracticeIdentity({ sourceEventId: 'event-1', cardId: 'card-1' }),
  buildLegacyPracticeIdentity({ sourceEventId: 'event-1', cardId: 'card-1' }),
  'legacy identity must be stable across retries',
);
const builtMutation = buildLegacyPracticeMutation([prepared]);
const mutationPayload = JSON.parse(builtMutation.params[0]);
assert.equal(mutationPayload[0].source_event_id, 'event-1');
assert.equal(mutationPayload[0].idempotency_key, 'legacy-review:event-1');

assert.match(source, /const isDirectInvocation\s*=/, 'the backfill must have an explicit direct-invocation boundary');
assert.match(source, /if\s*\(isDirectInvocation\)/, 'the backfill must not run when imported');
assert.equal(packageJson.scripts.build, 'node scripts/verify-build.mjs',
  'the npm build must remain the database-free verifier');
assert.doesNotMatch(packageJson.scripts.build, /backfill-dsa-practice-history/,
  'npm build must not import or invoke the backfill');
assert.doesNotMatch(buildSource, /backfill-dsa-practice-history|@neondatabase\/serverless|sql\.query\(/,
  'the build verifier must not invoke database backfill code');
assert.doesNotMatch(schema, /backfill-dsa-practice-history|node\s+scripts\/backfill/i,
  'schema application must not automatically invoke the backfill');

const env = { ...process.env };
delete env.DATABASE_URL;
delete env.POSTGRES_URL;
const result = spawnSync(process.execPath, [scriptPath], {
  cwd: root,
  env,
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'pipe'],
  timeout: 5_000,
});
assert.equal(result.error, undefined, `backfill must fail closed without hanging: ${result.error?.message ?? ''}`);
assert.equal(result.status, 1, 'missing database configuration must exit with status 1');
assert.match(`${result.stdout ?? ''}${result.stderr ?? ''}`, /DATABASE_URL \(or POSTGRES_URL\) is required\./,
  'missing database configuration must be reported before a connection attempt');

console.log('DSA practice history backfill contract: PASS');
