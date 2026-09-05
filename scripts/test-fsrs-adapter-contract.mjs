import assert from 'node:assert/strict';
import test from 'node:test';
import {
  FSRS_CONFIG,
  FSRS_LIBRARY,
  RATINGS,
  createFsrsTransition,
  isSerializedFsrsCard,
} from '../lib/fsrs.js';

const NEW_YORK = 'America/New_York';
const SEED_AT = '2026-03-05T14:00:00.000Z';
const REVIEW_AT = '2026-03-08T06:30:00.000Z'; // 01:30 EST on DST transition day

function jsonClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function hasDateInstance(value) {
  if (value instanceof Date) return true;
  if (!value || typeof value !== 'object') return false;
  return Object.values(value).some(hasDateInstance);
}

test('pins the maintained TS-FSRS v6 adapter and deterministic parameters', () => {
  assert.deepEqual(FSRS_LIBRARY, {
    packageName: 'ts-fsrs',
    packageVersion: '5.4.2',
    algorithm: 'fsrs',
    algorithmVersion: 6,
    parameterVersion: 1,
  });
  assert.equal(FSRS_CONFIG.requestRetention, 0.9);
  assert.equal(FSRS_CONFIG.enableFuzz, false);
});

test('creates a JSON-safe, replayable FSRS transition from semantic ratings', () => {
  const transition = createFsrsTransition({
    rating: RATINGS.GOOD,
    now: SEED_AT,
    timeZone: NEW_YORK,
  });

  assert.equal(transition.rating, RATINGS.GOOD);
  assert.equal(transition.algorithm, 'fsrs');
  assert.equal(transition.algorithmVersion, 6);
  assert.equal(transition.parameterVersion, 1);
  assert.ok(Date.parse(transition.dueAt) > Date.parse(SEED_AT));
  assert.ok(Number.isInteger(transition.scheduledIntervalDays));
  assert.ok(transition.scheduledIntervalDays >= 0);
  assert.ok(isSerializedFsrsCard(transition.stateBefore));
  assert.ok(isSerializedFsrsCard(transition.stateAfter));
  assert.equal(hasDateInstance(transition.stateBefore), false);
  assert.equal(hasDateInstance(transition.stateAfter), false);
  assert.deepEqual(jsonClone(transition.stateAfter), transition.stateAfter);

  const replay = createFsrsTransition({
    card: jsonClone(transition.stateAfter),
    rating: 5,
    now: transition.dueAt,
    timeZone: NEW_YORK,
  });
  assert.equal(replay.rating, RATINGS.EASY);
  assert.ok(isSerializedFsrsCard(replay.stateAfter));
  assert.ok(Date.parse(replay.dueAt) > Date.parse(transition.dueAt));
});

test('is deterministic and preserves Hard < Good < Easy once a card is established', () => {
  const initial = createFsrsTransition({
    rating: RATINGS.EASY,
    now: SEED_AT,
    timeZone: NEW_YORK,
  });
  const input = {
    card: initial.stateAfter,
    now: REVIEW_AT,
    timeZone: NEW_YORK,
  };

  const hard = createFsrsTransition({ ...input, rating: RATINGS.HARD });
  const good = createFsrsTransition({ ...input, rating: RATINGS.GOOD });
  const easy = createFsrsTransition({ ...input, rating: RATINGS.EASY });
  const repeatedGood = createFsrsTransition({ ...input, rating: RATINGS.GOOD });

  assert.ok(hard.scheduledIntervalDays < good.scheduledIntervalDays);
  assert.ok(good.scheduledIntervalDays < easy.scheduledIntervalDays);
  assert.deepEqual(repeatedGood, good);
});

test('overrides FSRS Again to the next local-day start, including DST', () => {
  const initial = createFsrsTransition({
    rating: RATINGS.EASY,
    now: SEED_AT,
    timeZone: NEW_YORK,
  });
  const again = createFsrsTransition({
    card: initial.stateAfter,
    rating: RATINGS.AGAIN,
    now: REVIEW_AT,
    timeZone: NEW_YORK,
  });

  assert.equal(again.dueAt, '2026-03-09T04:00:00.000Z'); // 00:00 EDT
  assert.equal(again.rating, RATINGS.AGAIN);
  assert.ok(again.scheduledIntervalDays >= 1);
});

test('rejects malformed persisted card state without mutating caller input', () => {
  const malformed = { state: 'review', due: 'not-a-date' };
  assert.throws(
    () => createFsrsTransition({
      card: malformed,
      rating: RATINGS.GOOD,
      now: REVIEW_AT,
      timeZone: NEW_YORK,
    }),
    /card|state|date/i,
  );
  assert.deepEqual(malformed, { state: 'review', due: 'not-a-date' });
});
