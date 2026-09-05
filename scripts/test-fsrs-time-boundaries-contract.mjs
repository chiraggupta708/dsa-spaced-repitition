import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import test from 'node:test';
import {
  RATINGS,
  createFsrsTransition,
  isSerializedFsrsCard,
  scheduleNextDue,
} from '../lib/fsrs.js';

function reviewCard(overrides = {}) {
  return {
    due: '2026-03-01T23:30:00.000Z',
    last_review: '2026-03-01T23:30:00.000Z',
    stability: 14.2,
    difficulty: 5.1,
    elapsed_days: 7,
    scheduled_days: 7,
    learning_steps: 0,
    reps: 5,
    lapses: 0,
    state: 2,
    ...overrides,
  };
}

function transitionUnderTimeZone(timeZone) {
  const adapterUrl = new URL('../lib/fsrs.js', import.meta.url).href;
  const script = [
    `import { createFsrsTransition } from ${JSON.stringify(adapterUrl)};`,
    `const card = ${JSON.stringify(reviewCard())};`,
    "console.log(JSON.stringify(createFsrsTransition({ card, rating: 'good', now: '2026-03-08T06:30:00.000Z', timeZone: 'America/New_York' })));",
  ].join('\n');
  return execFileSync(process.execPath, ['--input-type=module', '--eval', script], {
    encoding: 'utf8',
    env: { ...process.env, TZ: timeZone },
  }).trim();
}

test('requires explicit instants and canonical persisted timestamps', () => {
  assert.throws(() => createFsrsTransition({
    rating: RATINGS.GOOD,
    now: null,
    timeZone: 'UTC',
  }), /Invalid now date/);
  assert.throws(() => createFsrsTransition({
    rating: RATINGS.GOOD,
    now: '2026-03-08T06:30:00',
    timeZone: 'UTC',
  }), /Invalid now date/);
  assert.throws(() => createFsrsTransition({
    rating: RATINGS.GOOD,
    now: '2026-02-30T06:30:00.000Z',
    timeZone: 'UTC',
  }), /Invalid now date/);
  assert.equal(isSerializedFsrsCard(reviewCard({ due: '2026-03-01T23:30:00' })), false);
  assert.equal(isSerializedFsrsCard(reviewCard({ last_review: '2026-03-01' })), false);
});

test('keeps input and emitted timestamps inside the replayable year domain', () => {
  assert.throws(() => createFsrsTransition({
    rating: RATINGS.AGAIN,
    now: '0099-12-31T12:00:00.000Z',
    timeZone: 'UTC',
  }), /Invalid now date/);
  assert.equal(isSerializedFsrsCard(reviewCard({ due: '0099-12-31T12:00:00.000Z' })), false);
  assert.throws(() => createFsrsTransition({
    rating: RATINGS.AGAIN,
    now: '9999-12-31T23:59:00.000Z',
    timeZone: 'UTC',
  }), /supported|Invalid FSRS card due/);
});

test('produces identical transitions across host time zones for canonical state', () => {
  assert.equal(transitionUnderTimeZone('UTC'), transitionUnderTimeZone('America/Los_Angeles'));
});

test('counts an Again deferral as one local calendar day over fall-back DST', () => {
  const transition = createFsrsTransition({
    rating: RATINGS.AGAIN,
    now: '2026-11-01T04:30:00.000Z',
    timeZone: 'America/New_York',
  });
  assert.equal(transition.dueAt, '2026-11-02T05:00:00.000Z');
  assert.equal(transition.scheduledIntervalDays, 1);
  assert.equal(transition.stateAfter.scheduled_days, 1);
});

test('advances a midnight DST gap to the first valid local instant', () => {
  const scheduled = scheduleNextDue({
    mode: 'review',
    rating: RATINGS.AGAIN,
    now: '2026-03-07T05:30:00.000Z',
    timeZone: 'America/Havana',
  });
  assert.equal(scheduled.dueAt, '2026-03-08T05:00:00.000Z');

  const transition = createFsrsTransition({
    rating: RATINGS.AGAIN,
    now: '2026-03-07T05:30:00.000Z',
    timeZone: 'America/Havana',
  });
  assert.equal(transition.dueAt, scheduled.dueAt);
  assert.equal(transition.scheduledIntervalDays, 1);
});
