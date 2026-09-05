import assert from 'node:assert/strict';
import { buildShadowReviewMutation } from '../lib/db.js';

const transition = Object.freeze({
  parameterVersion: 2,
  algorithm: 'fsrs',
  algorithmVersion: 6,
  dueAt: '2026-03-09T04:00:00.000Z',
  actualElapsedDays: 3,
  overdueDays: 1,
  scheduledIntervalDays: 7,
  stateBefore: {
    due: '2026-03-08T04:00:00.000Z', stability: 4, difficulty: 5,
    elapsed_days: 3, scheduled_days: 2, learning_steps: 0, reps: 2, lapses: 0, state: 2,
    last_review: '2026-03-05T04:00:00.000Z',
  },
  stateAfter: {
    due: '2026-03-09T04:00:00.000Z', stability: 6, difficulty: 4,
    elapsed_days: 3, scheduled_days: 7, learning_steps: 0, reps: 3, lapses: 0, state: 2,
    last_review: '2026-03-08T04:00:00.000Z',
  },
});

const mutation = buildShadowReviewMutation({
  parameterRecord: '{"fixture":true}',
  eventId: 'event-1',
  owner: 'owner-1',
  cardId: 'card-1',
  rating: 'good',
  solvedFromScratch: true,
  now: '2026-03-08T06:30:00.000Z',
  key: 'review-1',
  transition,
  compatibilitySm2: {
    easinessFactor: 2.6,
    interval: 5,
    repetitions: 4,
    nextReview: '2026-03-13',
    lastReview: '2026-03-08',
    lastQuality: 4,
  },
  cardUpdatedAt: '2026-03-08T06:00:00.000Z',
  stateName: 'review',
  practiceDueAt: '2026-04-07T06:30:00.000Z',
});

assert.match(mutation.text, /^\s*WITH seeded_parameter AS \(/);
assert.match(mutation.text, /INSERT INTO fsrs_review_events[\s\S]*?state_before[\s\S]*?state_after/is);
assert.match(mutation.text, /INSERT INTO fsrs_card_schedules[\s\S]*?card_state/is);
assert.match(mutation.text, /ON CONFLICT \(owner_id, idempotency_key\) DO NOTHING/i);
assert.match(mutation.text, /c\.updated_at = \$24::timestamptz/i);
const placeholders = [...mutation.text.matchAll(/\$(\d+)/g)].map((match) => Number(match[1]));
assert.equal(Math.max(...placeholders), 30, 'query must bind exactly the 30 declared slots');
assert.equal(mutation.params.length, 30, 'every declared placeholder must receive one parameter');
assert.deepEqual(mutation.params.slice(0, 17), [
  2, '{"fixture":true}', 'event-1', 'owner-1', 'card-1', 'good', true,
  '2026-03-08T06:30:00.000Z', '2026-03-09T04:00:00.000Z', 'fsrs', 6,
  JSON.stringify(transition.stateBefore), JSON.stringify(transition.stateAfter), 3, 1, 7, 'review-1',
]);
assert.deepEqual(mutation.params.slice(17), [
  2.6, 5, 4, '2026-03-13', '2026-03-08', 4, '2026-03-08T06:00:00.000Z',
  6, 4, 'review', JSON.stringify(transition.stateAfter), '2026-04-07T06:30:00.000Z', true,
]);

console.log('FSRS shadow mutation contract: PASS');
