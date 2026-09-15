#!/usr/bin/env node
/**
 * Database-free source/runtime contract for the DSA practice domain.
 * This test only exercises pure validation, calendar and cursor helpers.
 */
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { readFile } from 'node:fs/promises';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const domainPath = path.join(root, 'lib', 'dsa-practice.js');
const source = await readFile(domainPath, 'utf8');
const domain = await import(pathToFileURL(domainPath).href);

const {
  PRACTICE_OUTCOMES,
  PRACTICE_TEXT_LIMITS,
  PRACTICE_CURSOR_MAX_AGE_MS,
  PracticeCursorError,
  PracticeTimezoneError,
  PracticeTimezoneRequiredError,
  normalizePracticeInput,
  normalizePracticeTimeZone,
  schedulePracticeOutcome,
  encodePracticeCursor,
  decodePracticeCursor,
  toPracticeQueueItem,
  toPracticeAttemptSummary,
  practiceErrorStatus,
} = domain;

assert.deepEqual(PRACTICE_OUTCOMES, ['independent', 'hinted', 'unfinished']);
assert.ok(PRACTICE_TEXT_LIMITS.blocker > 0);
assert.ok(PRACTICE_TEXT_LIMITS.reflection > PRACTICE_TEXT_LIMITS.blocker);
assert.ok(PRACTICE_TEXT_LIMITS.challengeApproach > 0);

const normalized = normalizePracticeInput({
  idempotencyKey: '  attempt-1  ',
  outcome: 'hinted',
  blocker: '  missed the invariant  ',
  reflection: '',
  challenge: {
    approach: '  two pointers  ',
    invariant: null,
    complexity: 'O(n)',
  },
});
assert.deepEqual(normalized, {
  idempotencyKey: 'attempt-1',
  outcome: 'hinted',
  blocker: 'missed the invariant',
  reflection: null,
  challenge: { approach: 'two pointers', invariant: null, complexity: 'O(n)' },
});

assert.throws(
  () => normalizePracticeInput({ idempotencyKey: 'x', outcome: 'again' }),
  (error) => error.code === 'invalid_practice_input' && practiceErrorStatus(error) === 400,
);
assert.throws(
  () => normalizePracticeInput({ idempotencyKey: 'x', outcome: 'independent', occurredAt: '2024-01-01T00:00:00.000Z' }),
  (error) => error.code === 'invalid_practice_input',
);
assert.throws(
  () => normalizePracticeInput({ idempotencyKey: 'x'.repeat(PRACTICE_TEXT_LIMITS.idempotencyKey + 1), outcome: 'independent' }),
  (error) => error.code === 'invalid_practice_input',
);
assert.throws(
  () => normalizePracticeInput({ idempotencyKey: 'x', outcome: 'independent', blocker: 'x'.repeat(PRACTICE_TEXT_LIMITS.blocker + 1) }),
  (error) => error.code === 'invalid_practice_input',
);
assert.throws(
  () => normalizePracticeInput({ idempotencyKey: 'x', outcome: 'independent', challenge: { approach: 'x'.repeat(PRACTICE_TEXT_LIMITS.challengeApproach + 1) } }),
  (error) => error.code === 'invalid_practice_input',
);

assert.equal(normalizePracticeTimeZone('America/New_York'), 'America/New_York');
assert.equal(normalizePracticeTimeZone(' UTC '), 'UTC');
assert.throws(() => normalizePracticeTimeZone('Not/AZone'), PracticeTimezoneError);
assert.throws(() => normalizePracticeTimeZone(''), PracticeTimezoneError);
assert.throws(() => schedulePracticeOutcome({ outcome: 'independent', now: new Date('2024-01-01T00:00:00.000Z') }), PracticeTimezoneRequiredError);

function localDate(instant, timeZone) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    calendar: 'iso8601',
    numberingSystem: 'latn',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(instant);
}

const independent = schedulePracticeOutcome({
  outcome: 'independent',
  timeZone: 'America/New_York',
  now: new Date('2024-03-09T17:00:00.000Z'),
});
assert.equal(independent.intervalDays, 30);
assert.equal(independent.dueReason, 'monthly_checkpoint');
assert.equal(localDate(new Date(independent.dueAt), 'America/New_York'), '2024-04-08');

const hintedAcrossSpring = schedulePracticeOutcome({
  outcome: 'hinted',
  timeZone: 'America/New_York',
  now: new Date('2024-03-09T07:30:00.000Z'),
});
assert.equal(hintedAcrossSpring.intervalDays, 3);
assert.equal(hintedAcrossSpring.dueReason, 'three_day_retry');
assert.equal(localDate(new Date(hintedAcrossSpring.dueAt), 'America/New_York'), '2024-03-12');

const unfinishedAcrossFall = schedulePracticeOutcome({
  outcome: 'unfinished',
  timeZone: 'America/New_York',
  now: new Date('2024-11-02T06:30:00.000Z'),
});
assert.equal(localDate(new Date(unfinishedAcrossFall.dueAt), 'America/New_York'), '2024-11-05');

const springGapTarget = schedulePracticeOutcome({
  outcome: 'hinted',
  timeZone: 'America/New_York',
  now: new Date('2024-03-08T07:30:00.000Z'),
});
assert.equal(localDate(new Date(springGapTarget.dueAt), 'America/New_York'), '2024-03-11');

const cursorContext = {
  ownerId: 'user-a',
  view: 'queue',
  bucket: 'due',
  filter: { q: 'heap', difficulty: 'medium' },
  sort: 'next_practice_at_asc_card_id_asc',
  snapshotAt: '2024-11-01T00:00:00.000Z',
  key: { nextPracticeAt: '2024-11-03T12:00:00.000Z', cardId: 'card-9' },
};
const cursor = encodePracticeCursor(cursorContext);
assert.match(cursor, /^[A-Za-z0-9_-]+$/);
assert.ok(!cursor.includes('user-a'));
assert.deepEqual(decodePracticeCursor(cursor, cursorContext).key, cursorContext.key);
assert.throws(() => decodePracticeCursor(cursor, { ...cursorContext, ownerId: 'user-b' }), PracticeCursorError);
assert.throws(() => decodePracticeCursor(cursor, { ...cursorContext, bucket: 'first-check' }), PracticeCursorError);
assert.throws(() => decodePracticeCursor(`${cursor.slice(0, -1)}!`, cursorContext), PracticeCursorError);
assert.throws(() => decodePracticeCursor(encodePracticeCursor({ ...cursorContext, snapshotAt: null }), cursorContext), PracticeCursorError);

assert.ok(Number.isFinite(PRACTICE_CURSOR_MAX_AGE_MS));
assert.ok(PRACTICE_CURSOR_MAX_AGE_MS > 0);
const cursorClock = new Date('2026-09-14T12:00:00.000Z');
const recentCursorContext = {
  ...cursorContext,
  snapshotAt: '2026-09-14T11:30:00.000Z',
  key: { nextPracticeAt: '2026-09-15T12:00:00.000Z', cardId: 'card-9' },
};
const recentCursor = encodePracticeCursor(recentCursorContext);
assert.deepEqual(
  decodePracticeCursor(recentCursor, {
    ...recentCursorContext,
    maxAgeMs: PRACTICE_CURSOR_MAX_AGE_MS,
    now: cursorClock,
  }).key,
  recentCursorContext.key,
);
const expiredCursor = encodePracticeCursor({
  ...recentCursorContext,
  snapshotAt: '2026-09-12T11:30:00.000Z',
});
assert.throws(
  () => decodePracticeCursor(expiredCursor, {
    ...recentCursorContext,
    snapshotAt: '2026-09-12T11:30:00.000Z',
    maxAgeMs: PRACTICE_CURSOR_MAX_AGE_MS,
    now: cursorClock,
  }),
  (error) => error instanceof PracticeCursorError && /expired/.test(error.message),
);
const futureCursor = encodePracticeCursor({
  ...recentCursorContext,
  snapshotAt: '2026-09-14T12:01:00.000Z',
});
assert.throws(
  () => decodePracticeCursor(futureCursor, {
    ...recentCursorContext,
    snapshotAt: '2026-09-14T12:01:00.000Z',
    maxAgeMs: PRACTICE_CURSOR_MAX_AGE_MS,
    now: cursorClock,
  }),
  (error) => error instanceof PracticeCursorError && /future/.test(error.message),
);

const queueItem = toPracticeQueueItem({
  card_id: 'card-1',
  question: 'Two Sum',
  link: 'https://example.test/two-sum',
  difficulty: 'easy',
  tags: [{ name: 'array' }],
  last_independent_solve_at: null,
  last_attempt_at: '2024-01-02T00:00:00.000Z',
  last_outcome: 'unfinished',
  next_practice_at: '2024-01-05T00:00:00.000Z',
  due_reason: 'three_day_retry',
});
assert.equal(queueItem.historyStatus, 'no_independent_solve_recorded');
assert.equal(queueItem.cardId, 'card-1');
assert.equal('answer' in queueItem, false);
assert.equal('actual_code' in queueItem, false);
assert.equal('notes' in queueItem, false);

const attemptSummary = toPracticeAttemptSummary({
  id: 'attempt-1',
  card_id: 'card-1',
  occurred_at: '2024-01-02T00:00:00.000Z',
  time_zone: 'UTC',
  outcome: 'independent',
  next_practice_at: '2024-02-01T00:00:00.000Z',
  due_reason: 'monthly_checkpoint',
  source: 'practice',
  blocker: 'must not leak',
});
assert.equal(attemptSummary.id, 'attempt-1');
assert.equal('blocker' in attemptSummary, false);

assert.equal(source.includes('Intl.DateTimeFormat'), true);
assert.equal(source.includes('base64url'), true);
assert.equal(source.includes('snapshotAt'), true);
assert.equal(source.includes('PRACTICE_CURSOR_MAX_AGE_MS'), true);
assert.match(source, /age\s*<\s*0/);
assert.match(source, /maxAgeMs/);
assert.equal(practiceErrorStatus(new PracticeTimezoneError('bad')), 400);
assert.equal(practiceErrorStatus(new PracticeCursorError('bad')), 400);
assert.equal(practiceErrorStatus(new PracticeTimezoneRequiredError()), 409);

console.log('DSA practice domain contract: PASS');
