#!/usr/bin/env node
/**
 * Database-free source/runtime contract for the DSA transfer-boundary backend.
 * It never imports lib/db.js, opens a database, starts a server, or runs a
 * migration. Runtime checks exercise only the pure cursor codec.
 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [domainSource, dbSource, cardsSource, dueSource] = await Promise.all([
  readFile(path.join(root, 'lib', 'dsa-practice.js'), 'utf8'),
  readFile(path.join(root, 'lib', 'db.js'), 'utf8'),
  readFile(path.join(root, 'api', 'cards.js'), 'utf8'),
  readFile(path.join(root, 'api', 'cards', 'due.js'), 'utf8'),
]);
const domain = await import(pathToFileURL(path.join(root, 'lib', 'dsa-practice.js')).href);

function block(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.ok(start >= 0, `missing source marker: ${startMarker}`);
  const end = endMarker ? source.indexOf(endMarker, start) : source.length;
  assert.ok(!endMarker || end > start, `missing source end marker: ${endMarker}`);
  return source.slice(start, end < 0 ? source.length : end);
}

const summary = block(dbSource, 'export async function loadCardSummaries(', 'export async function loadDueCards(');
const dueSummary = block(dbSource, 'export async function loadDueCardSummaries(', 'export async function upsertCard(');
const capture = block(dbSource, 'export async function recordPracticeCapture(', null);
const cardsGet = block(cardsSource, "if (req.method === 'GET')", "if (req.method === 'POST')");
const cardsSummary = block(cardsGet, 'if (summary)', '} else {');
const dueSummaryBranch = block(dueSource, 'if (useSummary)', 'if (!useSummary && limitValue)');
const cardsAfterKey = block(domainSource, 'function normalizeCursorKey', 'export function encodePracticeCursor');
const queueAfterKey = block(domainSource, "if (view === 'history')", 'export function encodePracticeCursor');
const cardAfterKey = block(dbSource, 'function addCardAfterKeySql(', 'function addDueAfterKeySql(');
const dueAfterKey = block(dbSource, 'function addDueAfterKeySql(', 'function addHistoryAfterKeySql(');

// Cursor metadata and runtime behavior: existing practice queue/history remain
// supported while cards and due receive their own strict ordering contracts.
assert.match(domainSource, /PRACTICE_CURSOR_VERSION\s*=\s*1/);
assert.match(domainSource, /PRACTICE_CURSOR_MAX_AGE_MS/);
assert.match(domainSource, /base64url/);
assert.match(domainSource, /cards:\s*['"]created_at_desc_id_desc['"]/);
assert.match(domainSource, /due:\s*['"]next_review_asc_nulls_first_easiness_factor_asc_id_asc['"]/);
assert.match(domainSource, /view === 'queue'/);
assert.match(domainSource, /view === 'history'/);
assert.match(domainSource, /snapshotAt/);
assert.match(domainSource, /age\s*<\s*0/);
assert.match(cardsAfterKey, /createdAt/);
assert.match(cardsAfterKey, /key\.id/);
assert.match(queueAfterKey, /nextPracticeAt/);

const cardCursorContext = {
  ownerId: 'user-a',
  view: 'cards',
  filter: { q: 'heap', difficulty: 'medium' },
  sort: 'created_at_desc_id_desc',
  snapshotAt: '2026-09-15T08:00:00.000Z',
  key: { createdAt: '2026-09-14T08:00:00.000Z', id: 'card-9' },
};
const cardCursor = domain.encodePracticeCursor(cardCursorContext);
assert.match(cardCursor, /^[A-Za-z0-9_-]+$/);
assert.deepEqual(domain.decodePracticeCursor(cardCursor, cardCursorContext).key, cardCursorContext.key);
assert.throws(
  () => domain.decodePracticeCursor(cardCursor, { ...cardCursorContext, ownerId: 'user-b' }),
  domain.PracticeCursorError,
);
assert.throws(
  () => domain.decodePracticeCursor(cardCursor, { ...cardCursorContext, filter: { q: 'graph', difficulty: 'medium' } }),
  domain.PracticeCursorError,
);
const dueCursorContext = {
  ownerId: 'user-a',
  view: 'due',
  filter: {},
  sort: 'next_review_asc_nulls_first_easiness_factor_asc_id_asc',
  snapshotAt: '2026-09-15T08:00:00.000Z',
  key: { nextReview: null, easinessFactor: 2.5, cardId: 'card-9' },
};
const dueCursor = domain.encodePracticeCursor(dueCursorContext);
assert.deepEqual(domain.decodePracticeCursor(dueCursor, dueCursorContext).key, dueCursorContext.key);
assert.throws(
  () => domain.decodePracticeCursor(dueCursor, { ...dueCursorContext, sort: 'created_at_desc_id_desc' }),
  domain.PracticeCursorError,
);
assert.throws(
  () => domain.decodePracticeCursor(cardCursor, {
    ...cardCursorContext,
    maxAgeMs: domain.PRACTICE_CURSOR_MAX_AGE_MS,
    now: new Date('2026-09-16T08:01:00.000Z'),
  }),
  (error) => error instanceof domain.PracticeCursorError && /expired/.test(error.message),
);

// Library summaries are server-filtered, lightweight, and created-keyset paged.
assert.match(summary, /normalizePracticeLimit\([\s\S]*PRACTICE_PAGE_LIMITS\.cards/);
assert.match(summary, /options\.q|options\.query/);
assert.match(summary, /options\.difficulty/);
assert.match(summary, /options\.cursor/);
assert.match(summary, /decodePracticeCursor/);
assert.match(summary, /encodePracticeCursor/);
assert.match(summary, /ORDER BY c\.created_at DESC, c\.id DESC/);
assert.match(summary, /SELECT\s+EXISTS\s*\(/is);
assert.match(summary, /nextCursor/);
assert.match(summary, /hasMore/);
assert.match(summary, /version/);
assert.doesNotMatch(summary, /\bOFFSET\b/i);
assert.doesNotMatch(summary, /COUNT\(\*\)\s+OVER/i);
for (const field of ['answer', 'actual_code', 'my_thinking', 'right_thinking', 'notes', 'question_description']) {
  assert.doesNotMatch(summary, new RegExp(`\\b${field}\\b`, 'i'), `summary must not mention ${field}`);
}
assert.match(cardAfterKey, /c\.created_at </);
assert.match(cardAfterKey, /c\.created_at =/);
assert.match(cardAfterKey, /c\.id </);
const summaryHasMore = block(summary, 'const last = rows[rows.length - 1];', 'const cards = rows.map');
assert.match(summaryHasMore, /if \(last\)/);
assert.match(summaryHasMore, /SELECT\s+EXISTS\s*\(/is);
assert.match(summaryHasMore, /addCardAfterKeySql\(moreWhere, moreParams/);
assert.doesNotMatch(summaryHasMore, /\bLIMIT\b/i);

// Due summaries retain the legacy null-first/next-review/easiness/id order,
// but use a bounded lightweight cursor path without exclusions.
assert.match(dueSummary, /normalizePracticeLimit\([\s\S]*PRACTICE_PAGE_LIMITS\.due/);
assert.match(dueSummary, /options\.cursor/);
assert.match(dueSummary, /decodePracticeCursor/);
assert.match(dueSummary, /encodePracticeCursor/);
assert.match(dueSummary, /CASE WHEN c\.next_review IS NULL THEN 0 ELSE 1 END/);
assert.match(dueSummary, /c\.next_review ASC/);
assert.match(dueSummary, /COALESCE\(c\.easiness_factor, 2\.5\) ASC/);
assert.match(dueSummary, /c\.id ASC/);
assert.match(dueSummary, /SELECT\s+EXISTS\s*\(/is);
assert.match(dueSummary, /nextCursor/);
assert.match(dueSummary, /hasMore/);
assert.match(dueSummary, /version/);
assert.doesNotMatch(dueSummary, /\bOFFSET\b|excludeIds|ANY\s*\(|COUNT\(\*\)\s+OVER/i);
for (const field of ['answer', 'actual_code', 'my_thinking', 'right_thinking', 'notes', 'question_description']) {
  assert.doesNotMatch(dueSummary, new RegExp(`\\b${field}\\b`, 'i'), `due summary must not mention ${field}`);
}
assert.match(dueAfterKey, /next_review/);
assert.match(dueAfterKey, /easiness_factor|easinessFactor/);
assert.match(dueAfterKey, /c\.id >/);
const dueHasMore = block(dueSummary, 'const last = rows[rows.length - 1];', 'const cards = rows.map');
assert.match(dueHasMore, /if \(last\)/);
assert.match(dueHasMore, /SELECT\s+EXISTS\s*\(/is);
assert.match(dueHasMore, /addDueAfterKeySql\(moreWhere, moreParams/);
assert.doesNotMatch(dueHasMore, /\bLIMIT\b/i);

// APIs pass all summary pagination/filter inputs through and return envelopes;
// legacy full-card callers retain their explicit path.
assert.match(cardsSource, /loadCardSummaries/);
assert.match(cardsSummary, /loadCardSummaries\(userId,\s*\{[\s\S]*limit[\s\S]*cursor[\s\S]*q[\s\S]*difficulty/);
assert.match(cardsSummary, /sendConditionalJSON/);
assert.match(cardsSummary, /nextCursor/);
assert.match(cardsSummary, /hasMore/);
assert.match(cardsSummary, /version/);
assert.doesNotMatch(cardsSummary, /\.sort\(/);
assert.match(cardsGet, /load\(userId\)/);
assert.match(dueSource, /loadDueCardSummaries/);
assert.match(dueSummaryBranch, /loadDueCardSummaries\(userId,\s*\{[\s\S]*limit[\s\S]*cursor/);
assert.match(dueSummaryBranch, /sendConditionalJSON/);
assert.match(dueSummaryBranch, /nextCursor/);
assert.match(dueSummaryBranch, /hasMore/);
assert.match(dueSummaryBranch, /version/);
assert.match(dueSource, /loadDueCards/);
assert.match(dueSource, /load\(userId\)/);
assert.match(dueSource, /exclude/);

// Capture identity and idempotency locks must be acquired in one deterministic
// order before the identity-sensitive duplicate/card writes.
assert.match(capture, /practiceCaptureIdentity\(normalized\)/);
assert.match(capture, /capture_lock_keys|identity_lock|capture_identity/i);
assert.match(capture, /hashtextextended/);
assert.match(capture, /pg_advisory_xact_lock/);
assert.match(capture, /LEAST\(/);
assert.match(capture, /GREATEST\(/);
assert.match(capture, /capture_claim_existing/);
assert.ok(capture.indexOf('capture_lock') < capture.indexOf('capture_claim_existing'));
assert.match(capture, /owner.*idempotency|idempotency.*owner/i);
assert.match(capture, /owner.*identity|identity.*owner/i);

console.log('DSA transfer-boundary backend contract: PASS');
