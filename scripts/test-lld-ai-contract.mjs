#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  LLD_AI_MODES,
  LLD_AI_REQUEST_TYPES,
  createFallbackLldAiResponse,
  describeLldAiProvider,
  normalizeLldAiInput,
  normalizeLldAiResponse,
} from '../lib/lld-ai.js';

assert.deepEqual(LLD_AI_MODES, ['tutor', 'interviewer']);
assert.deepEqual(LLD_AI_REQUEST_TYPES, ['evaluate', 'hint', 'follow_up', 'debrief']);
const savedProviderEnv = { ...process.env };
process.env.OPENROUTER_API_KEY = 'test-openrouter-key';
delete process.env.LLD_AI_PROVIDER;
delete process.env.LLD_AI_API_KEY;
delete process.env.OPENAI_API_KEY;
const openRouterProvider = describeLldAiProvider();
assert.equal(openRouterProvider.provider, 'openrouter');
assert.equal(openRouterProvider.baseUrl, 'https://openrouter.ai/api/v1');
assert.equal(openRouterProvider.model, 'openai/gpt-4o-mini');
assert.equal(openRouterProvider.configured, true);
for (const key of Object.keys(process.env)) {
  if (!(key in savedProviderEnv)) delete process.env[key];
}
for (const [key, value] of Object.entries(savedProviderEnv)) process.env[key] = value;

const input = normalizeLldAiInput({
  phaseKey: 'model',
  mode: 'tutor',
  requestType: 'evaluate',
  answerMd: 'The inventory owns stock and the machine owns the session state.',
});
assert.equal(input.phaseKey, 'model');
assert.equal(input.mode, 'tutor');
assert.equal(input.requestType, 'evaluate');
const reNormalizedInput = normalizeLldAiInput(input);
assert.equal(reNormalizedInput.review, null);

const debrief = normalizeLldAiInput({
  mode: 'interviewer',
  requestType: 'debrief',
  answerMd: '',
  review: {
    dimensions: [{ key: 'ownership', level: 'partial', notesMd: '' }],
    readinessStatus: 'practicing',
    nextAction: 'Redo ownership boundaries.',
  },
});
assert.equal(debrief.phaseKey, null);
assert.equal(debrief.review.readinessStatus, 'practicing');

assert.throws(() => normalizeLldAiInput({
  phaseKey: 'model', mode: 'tutor', requestType: 'evaluate', owner_id: 'attacker', answerMd: 'x',
}), /identity field|must not be supplied/i);
assert.throws(() => normalizeLldAiInput({
  phaseKey: 'model', mode: 'tutor', requestType: 'evaluate', answerMd: 'x'.repeat(20_001),
}), /answerMd.*20,?000/i);
assert.throws(() => normalizeLldAiInput({
  phaseKey: 'model', mode: 'tutor', requestType: 'evaluate', answerMd: 'x', context: { email: 'attacker@example.com' },
}), /identity field|must not be supplied/i);

const fallback = createFallbackLldAiResponse({
  phaseKey: 'scope',
  mode: 'tutor',
  requestType: 'evaluate',
  answerMd: 'The user can select an item and pay.',
  design: { title: 'Vending Machine', problemStatementMd: 'Accept payment and vend items.' },
});
assert.equal(fallback.provider, 'fallback');
assert.ok(fallback.feedbackMd.length > 0);
assert.ok(Array.isArray(fallback.missingPoints));
assert.ok(fallback.followUpQuestion.length > 0);
assert.ok(Array.isArray(fallback.topImprovements));
assert.ok(fallback.nextDrill.length > 0);
assert.ok(!fallback.missingPoints.some((point) => /\b(require|nfr|assum)\b/i.test(point)));

const response = normalizeLldAiResponse({
  provider: 'openai-compatible',
  assessment: 'partial',
  feedbackMd: 'Good ownership start.',
  missingPoints: ['Concurrency boundary'],
  topImprovements: ['Clarify the concurrency boundary.'],
  nextDrill: 'Redo the ownership phase with a retry case.',
  followUpQuestion: 'Who owns the lock?',
  hintMd: 'Name the mutable state owner.',
});
assert.equal(response.assessment, 'partial');
assert.equal(response.missingPoints[0], 'Concurrency boundary');
assert.equal(response.topImprovements[0], 'Clarify the concurrency boundary.');
assert.equal(response.nextDrill, 'Redo the ownership phase with a retry case.');
assert.equal(response.shouldReveal, false);
assert.throws(() => normalizeLldAiResponse({ assessment: 'clear', feedbackMd: 'x', missingPoints: ['x'.repeat(2_001)] }), /missingPoints/i);

console.log('LLD AI contract tests passed.');
