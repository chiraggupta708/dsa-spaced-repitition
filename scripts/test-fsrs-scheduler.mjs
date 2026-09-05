import assert from 'node:assert/strict';
import test from 'node:test';
import {
  FSRS_CONFIG,
  RATINGS,
  normalizeRating,
  scheduleNextDue,
} from '../lib/fsrs.js';

const reviewStart = '2026-03-08T06:30:00.000Z'; // 01:30 EST, DST transition day
const practiceStart = '2026-02-08T06:30:00.000Z'; // 01:30 EST, 30 local days before DST

function date(value) {
  return new Date(value).toISOString();
}

test('exports the exact Phase 0 FSRS configuration and semantic ratings', () => {
  assert.deepEqual(FSRS_CONFIG, { requestRetention: 0.9, enableFuzz: false });
  assert.deepEqual(RATINGS, {
    AGAIN: 'again',
    HARD: 'hard',
    GOOD: 'good',
    EASY: 'easy',
  });
});

test('normalizes semantic and legacy ratings', () => {
  for (const rating of Object.values(RATINGS)) {
    assert.equal(normalizeRating(rating), rating);
  }

  assert.equal(normalizeRating(1), RATINGS.AGAIN);
  assert.equal(normalizeRating(2), RATINGS.HARD);
  assert.equal(normalizeRating(3), RATINGS.HARD);
  assert.equal(normalizeRating(4), RATINGS.GOOD);
  assert.equal(normalizeRating(5), RATINGS.EASY);
});

test('rejects invalid and contradictory ratings', () => {
  for (const invalid of [0, 6, 'Again', 'forgot', null, undefined, {}, []]) {
    assert.throws(() => normalizeRating(invalid), /rating/i);
  }

  assert.throws(
    () => scheduleNextDue({
      mode: 'review',
      rating: RATINGS.GOOD,
      legacyRating: 1,
      now: reviewStart,
      timeZone: 'America/New_York',
    }),
    /contradictory/i,
  );
});

test('schedules Again for the next local calendar-day start across DST', () => {
  const input = {
    mode: 'review',
    rating: RATINGS.AGAIN,
    now: reviewStart,
    timeZone: 'America/New_York',
  };
  const original = structuredClone(input);

  const result = scheduleNextDue(input);

  assert.equal(date(result.dueAt), '2026-03-09T04:00:00.000Z'); // 00:00 EDT
  assert.equal(result.rating, RATINGS.AGAIN);
  assert.deepEqual(input, original);
  assert.notStrictEqual(result, input);
});

test('schedules practice 30 local calendar days later with the same clock time across DST', () => {
  const input = {
    mode: 'practice',
    rating: 5,
    now: practiceStart,
    timeZone: 'America/New_York',
  };
  const original = structuredClone(input);

  const result = scheduleNextDue(input);

  assert.equal(date(result.dueAt), '2026-03-10T05:30:00.000Z'); // 01:30 EDT
  assert.equal(result.rating, RATINGS.EASY);
  assert.deepEqual(input, original);
  assert.notStrictEqual(result, input);
});

test('rejects invalid scheduler inputs', () => {
  const valid = {
    mode: 'review',
    rating: RATINGS.GOOD,
    now: reviewStart,
    timeZone: 'America/New_York',
  };

  for (const change of [
    { mode: 'other' },
    { now: 'not-a-date' },
    { timeZone: 'Not/A_Time_Zone' },
    { rating: 'invalid' },
  ]) {
    assert.throws(() => scheduleNextDue({ ...valid, ...change }));
  }
});
