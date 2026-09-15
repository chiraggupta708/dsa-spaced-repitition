#!/usr/bin/env node
/**
 * Database-free source contract for owner-scoped DSA practice persistence.
 * It never imports lib/db.js, starts a server, opens a database, or runs a migration.
 * These assertions guard source shape only; they do not prove live SQL
 * concurrency, owner isolation, or transaction behavior.
 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const db = await readFile(path.join(root, 'lib', 'db.js'), 'utf8');
const domain = await readFile(path.join(root, 'lib', 'dsa-practice.js'), 'utf8');

function functionBlock(source, marker, nextMarker) {
  const start = source.indexOf(marker);
  assert.ok(start >= 0, `missing source marker: ${marker}`);
  const end = nextMarker ? source.indexOf(nextMarker, start) : source.length;
  return source.slice(start, end < 0 ? source.length : end);
}

const queue = functionBlock(db, 'export async function listPracticeQueue(', 'export async function getPracticeSession(');
const session = functionBlock(db, 'export async function getPracticeSession(', 'export async function getPracticeCard(');
const card = functionBlock(db, 'export async function getPracticeCard(', 'export async function getPracticeReveal(');
const reveal = functionBlock(db, 'export async function getPracticeReveal(', 'export async function listPracticeHistory(');
const history = functionBlock(db, 'export async function listPracticeHistory(', '/** Fetch one owner/card-bound attempt detail');
const attempt = functionBlock(db, 'export async function getPracticeAttempt(', 'export async function recordPracticeAttempt(');
const record = functionBlock(db, 'export async function recordPracticeAttempt(', 'export async function getPracticeTimeZone(');
const timezone = functionBlock(db, 'export async function getPracticeTimeZone(', 'export async function setPracticeTimeZone(');
const setTimezone = functionBlock(db, 'export async function setPracticeTimeZone(', 'export async function getPracticeSummary(');
const summary = functionBlock(db, 'export async function getPracticeSummary(', 'export async function listPracticeQueue(');
const queueAfterKey = functionBlock(db, 'function addQueueAfterKeySql(', 'function addHistoryAfterKeySql(');
const historyAfterKey = functionBlock(db, 'function addHistoryAfterKeySql(', 'function practiceStateDto(');

for (const [name, block] of Object.entries({ queue, session, card, history, attempt, record, timezone, setTimezone, summary })) {
  assert.match(block, /owner_id/, `${name} must use owner-scoped SQL`);
  assert.doesNotMatch(block, /\bOFFSET\b/i, `${name} must use keyset pagination, not OFFSET`);
  assert.doesNotMatch(block, /excludeIds|exclusion|ANY\s*\(/i, `${name} must not use exclusion-ID pagination`);
}

assert.match(queue, /PRACTICE_PAGE_LIMITS\.queue/);
assert.match(queue, /SELECT\s+EXISTS\s*\(/is, 'queue hasMore must use an indexed key-only EXISTS query');
assert.match(queue, /decodePracticeCursor/);
assert.match(queue, /encodePracticeCursor/);
assert.match(queue, /next_practice_at/);
assert.match(queue, /card_id|c\.id/);
assert.match(queue, /const serverNow = new Date\(\)/);
assert.match(queue, /const params = \[owner, snapshotAt\]/, 'queue must not carry an unused duplicate snapshot bind');
assert.match(queue, /COALESCE\(s\.updated_at, c\.updated_at\) <= \$2/);
assert.match(queue, /s\.next_practice_at IS NOT NULL AND s\.next_practice_at <= \$2/);
assert.match(queue, /maxAgeMs:\s*PRACTICE_CURSOR_MAX_AGE_MS/);
assert.match(queue, /now:\s*serverNow/);
assert.match(queue, /const last = rows\[rows\.length - 1\]/);
assert.match(queue, /addQueueAfterKeySql\(moreWhere, moreParams/);
assert.doesNotMatch(queue, /\b(answer|actual_code|notes)\b/i, 'queue SQL must not load solution bodies');

const queueHasMore = functionBlock(queue, 'const last = rows[rows.length - 1];', 'const items = rows.map');
assert.match(queueHasMore, /if \(last\)/);
assert.match(queueHasMore, /const moreWhere = \[\.\.\.where\]/);
assert.match(queueHasMore, /const moreParams = \[\.\.\.params\]/);
assert.match(queueHasMore, /SELECT\s+EXISTS\s*\(/is);
assert.match(queueHasMore, /addQueueAfterKeySql\(moreWhere, moreParams/);
assert.doesNotMatch(queueHasMore, /\bLIMIT\b/i, 'queue hasMore must not fetch a bounded full-card lookahead');
assert.match(queueAfterKey, /s\.next_practice_at IS NOT NULL/);
assert.match(queueAfterKey, /s\.next_practice_at >/);
assert.match(queueAfterKey, /s\.next_practice_at =/);
assert.match(queueAfterKey, /c\.id >/);
assert.match(queue, /ORDER BY s\.next_practice_at ASC NULLS FIRST, c\.id ASC/);

assert.match(session, /PRACTICE_PAGE_LIMITS\.session/);
assert.match(session, /listPracticeQueue|listPracticeItems/);
assert.doesNotMatch(session, /\b(answer|actual_code|notes)\b/i, 'session must stay lightweight');

assert.match(card, /c\.id\s*=|card_id\s*=|id\s*=\s*\$\d/i);
assert.match(card, /c\.owner_id\s*=|owner_id\s*=\s*\$\d/i);
assert.match(card, /question_description\s+AS\s+prompt/i);
assert.doesNotMatch(card, /\b(answer|actual_code|notes)\b/i, 'card prompt DTO must not include solution bodies');

assert.match(reveal, /export async function getPracticeReveal\(cardId, ownerId\)/);
assert.match(reveal, /c\.owner_id\s*=\s*\$\d/);
assert.match(reveal, /question_description\s+AS\s+prompt/i);
assert.match(reveal, /right_thinking|my_thinking|actual_code|notes/);
assert.match(reveal, /key_insight|recurring_trap/);

assert.match(history, /PRACTICE_PAGE_LIMITS\.history/);
assert.match(history, /SELECT\s+EXISTS\s*\(/is);
assert.match(history, /occurred_at/);
assert.match(history, /decodePracticeCursor/);
assert.match(history, /encodePracticeCursor/);
assert.match(history, /const serverNow = new Date\(\)/);
assert.match(history, /maxAgeMs:\s*PRACTICE_CURSOR_MAX_AGE_MS/);
assert.match(history, /now:\s*serverNow/);
assert.match(history, /const last = rows\[rows\.length - 1\]/);
assert.match(history, /addHistoryAfterKeySql\(moreWhere, moreParams/);
assert.doesNotMatch(history, /\b(blocker|reflection|challenge_|approach|invariant|complexity)\b/i, 'history list must return summaries only');

const historyHasMore = functionBlock(history, 'const last = rows[rows.length - 1];', 'const items = rows.map');
assert.match(historyHasMore, /if \(last\)/);
assert.match(historyHasMore, /const moreWhere = \[\.\.\.where\]/);
assert.match(historyHasMore, /const moreParams = \[\.\.\.params\]/);
assert.match(historyHasMore, /SELECT\s+EXISTS\s*\(/is);
assert.match(historyHasMore, /addHistoryAfterKeySql\(moreWhere, moreParams/);
assert.doesNotMatch(historyHasMore, /\bLIMIT\b/i, 'history hasMore must not fetch a bounded full-card lookahead');
assert.match(historyAfterKey, /a\.occurred_at </);
assert.match(historyAfterKey, /a\.occurred_at =/);
assert.match(historyAfterKey, /a\.id </);
assert.match(history, /ORDER BY a\.occurred_at DESC, a\.id DESC/);

assert.match(attempt, /owner_id/);
assert.match(attempt, /id\s*=\s*\$\d/);
assert.match(attempt, /blocker|reflection|challenge_/i);

assert.match(record, /normalizePracticeInput/);
assert.match(record, /getPracticeTimeZone/);
assert.match(record, /PracticeTimezoneRequiredError/);
assert.match(record, /schedulePracticeOutcome/);
assert.match(record, /WITH\s+/is);
assert.match(record, /FOR\s+UPDATE/i, 'practice writes must serialize owner/card projection updates');
assert.match(record, /INSERT\s+INTO\s+dsa_practice_attempts/i);
assert.match(record, /ON\s+CONFLICT/i);
assert.match(record, /request_fingerprint/);
assert.match(record, /fsrs_practice_states/);
assert.match(record, /revision/);
assert.match(record, /owner_id\s*=|owner_id,/i);
assert.match(record, /card_id\s*=|card_id,/i);
assert.match(record, /replayed|idempotency/);
assert.match(record, /if \(!persistedTimeZone\) throw new PracticeTimezoneRequiredError/);
for (const marker of ['WITH card_guard AS', 'existing AS', 'claimed AS', 'projection AS', 'projection_guard AS', 'selected AS']) {
  assert.ok(record.includes(marker), `record must contain atomic CTE marker: ${marker}`);
}
assert.match(record, /FROM card_guard g[\s\S]*WHERE NOT EXISTS \(SELECT 1 FROM existing\)/is);
assert.match(record, /ON CONFLICT \(owner_id, idempotency_key\) DO NOTHING/i);
assert.match(record, /SELECT s\.\* FROM selected s CROSS JOIN projection_guard/is);
assert.match(record, /String\(row\.request_fingerprint\) !== fingerprint/);
assert.match(record, /PracticeIdempotencyConflictError/);
assert.match(record, /findPracticeAttemptByKey/);

assert.match(timezone, /learner_preferences/);
assert.match(setTimezone, /INSERT\s+INTO\s+learner_preferences/i);
assert.match(setTimezone, /normalizePracticeTimeZone/);
assert.match(summary, /COUNT|count/i);
assert.match(summary, /nextItem|listPracticeQueue|LIMIT\s+1/i);
assert.match(summary, /WITH\s+summary_rows\s+AS\s*\(/i, 'summary must materialize per-card rows before aggregating correlated recognition state');
assert.match(summary, /FROM\s+summary_rows/i, 'summary aggregate must read from its per-card materialized rows');
assert.match(summary, /recognition_trap_suggested/i, 'summary must aggregate the materialized recognition flag');
assert.match(summary, /next_practice_at\s*<=\s*\$2::timestamptz/i, 'summary must type its timestamp bind explicitly');
assert.match(summary, /ownerParameter:\s*['"]\$1::text['"]/i, 'summary must type its owner bind explicitly');

const reviewMutation = functionBlock(db, 'export function buildShadowReviewMutation(', '/**\n * Record a semantic review');
const review = functionBlock(db, 'export async function recordReview(', '\nconst DESIGN_COLS');
const practiceWrite = functionBlock(reviewMutation, 'practice_write AS (', 'legacy_practice_bridge AS');
const legacyPracticeBridge = functionBlock(reviewMutation, 'legacy_practice_bridge AS (', 'claim_guard AS');
const legacyBridge = functionBlock(db, 'async function bridgeLegacyReviewEvent(', 'function normalizePracticeLimit(');
const compatibilityMutation = functionBlock(db, 'function withoutLegacyPracticeBridge(', 'async function bridgeLegacyReviewEvent(');
assert.match(reviewMutation, /dsa_practice_attempts/i, 'legacy review mutation must bridge solved events');
assert.match(reviewMutation, /source_event_id/i);
assert.match(reviewMutation, /source[^\n]*legacy_review|legacy_review[^\n]*source/i);
assert.match(reviewMutation, /WHERE\s+\$\d+::boolean/is, 'legacy bridge must be solvedFromScratch guarded');
assert.match(practiceWrite, /WHERE\s+\$30::boolean\s+AND\s+\$31::text IS NOT NULL/is, 'legacy practice state must require a persisted timezone');
assert.match(legacyPracticeBridge, /WHERE\s+\$30::boolean\s+AND\s+\$31::text IS NOT NULL/is, 'legacy DSA attempt must require a persisted timezone');
assert.match(compatibilityMutation, /WHERE\s+\$30::boolean\s+AND\s+\$29::timestamptz IS NOT NULL/is, 'legacy compatibility projection must require a computed due date from a persisted timezone');
assert.match(reviewMutation, /\$31/);
assert.match(reviewMutation, /\$32/);
assert.match(reviewMutation, /ON\s+CONFLICT\s*\(\s*source_event_id\s*\)\s+DO\s+NOTHING/i);
assert.match(review, /solvedFromScratch/);
assert.match(review, /persistedPracticeTimeZone/);
assert.match(review, /const fsrsTimeZone = persistedPracticeTimeZone \|\| 'UTC'/);
assert.match(review, /if \(solvedFromScratch\) \{[\s\S]*persistedPracticeTimeZone[\s\S]*scheduleNextDue/is);
assert.match(review, /legacyTimeZone:\s*persistedPracticeTimeZone/);
assert.match(legacyBridge, /normalizePracticeTimeZone/);
assert.match(legacyBridge, /if \(!zone\)/);
assert.match(legacyBridge, /return \{ inserted: false, unknown: true \}/);
assert.doesNotMatch(legacyBridge, /['"]UTC['"]/i, 'legacy DSA bridge must not invent UTC');
assert.match(review, /legacy|bridge|dsa_practice_attempts/i);
assert.match(review, /catch|relation|to_regclass|information_schema/i, 'review path must remain compatible before the explicit DSA migration');
assert.doesNotMatch(reviewMutation, /recall[-_ ]only/i);

assert.match(domain, /PracticeTimezoneRequiredError/);
assert.match(domain, /PRACTICE_OUTCOMES/);
assert.match(domain, /base64url/);
assert.match(domain, /snapshotAt/);
assert.match(domain, /PRACTICE_CURSOR_MAX_AGE_MS/);
assert.match(domain, /age\s*<\s*0/);
assert.match(db, /PRACTICE_CURSOR_MAX_AGE_MS/);

console.log('DSA practice persistence contract: PASS');
