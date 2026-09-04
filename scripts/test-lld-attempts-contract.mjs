#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { LLD_ATTEMPT_PHASES } from '../lib/lld-phases.js';

const source = readFileSync(new URL('../lib/lld-attempts-db.js', import.meta.url), 'utf8');

function check(name, callback) {
  try {
    callback();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

check('attempts use a fixed phasewise flow with separate requirements checkpoints', () => {
  assert.deepEqual(LLD_ATTEMPT_PHASES.map((phase) => phase.key), [
    'functional_requirements',
    'nfr',
    'model',
    'code',
    'diagram',
    'flow_tradeoffs',
    'review',
  ]);
  assert.match(source, /from '\.\/lld-phases\.js'/);
  assert.match(source, /legacyAnswers/);
});

check('attempt reads and writes are owner-scoped', () => {
  assert.match(source, /WHERE a\.id = \$1 AND a\.owner_id = \$2/);
  assert.match(source, /WHERE attempt_id = \$1 AND owner_id = \$2/);
  assert.match(source, /FROM lld_ai_turns/);
  assert.match(source, /WHERE id = \$1 AND owner_id = \$2 AND status = 'started'/);
  assert.match(source, /WHERE lld_attempt_answers\.owner_id = EXCLUDED\.owner_id/);
});

check('attempt answers are bounded and phase-validated', () => {
  assert.match(source, /MAX_ANSWER_LENGTH = 20_000/);
  assert.match(source, /if \(!PHASE_KEYS\.has\(key\)\)/);
  assert.match(source, /answerMd is too large/);
  assert.match(source, /MAX_AI_TURNS_PER_ATTEMPT/);
});

check('AI feedback is persisted without executing learner code', () => {
  assert.match(source, /export async function saveLldAiTurn/);
  assert.match(source, /INSERT INTO lld_ai_turns/);
  assert.match(source, /missing_points/);
  assert.match(source, /top_improvements/);
  assert.match(source, /next_drill/);
  assert.doesNotMatch(source, /child_process|exec\(|spawn\(/);
});

check('review persistence validates client input and uses a transaction', () => {
  assert.match(source, /normalizeLldReview\(input\)/);
  assert.match(source, /const queries = \[/);
  assert.match(source, /DELETE FROM lld_review_dimensions/);
  assert.match(source, /await db\.transaction\(queries\)/);
  assert.match(source, /UPDATE lld_designs SET lifecycle_state/);
  assert.match(source, /scheduledReviewAt\(review\.readinessStatus, now\)/);
  assert.match(source, /next_review_at = EXCLUDED\.next_review_at/);
});

check('attempt completion is a state transition', () => {
  assert.match(source, /status = 'completed'/);
  assert.match(source, /completed_at = NOW\(\)/);
});

check('abandonment remains owner-scoped', () => {
  assert.match(source, /status = 'abandoned'/);
  assert.match(source, /WHERE id = \$1 AND owner_id = \$2 AND status = 'started'/);
});

console.log('LLD attempt contract tests passed.');