#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  buildLldAiContext,
  buildLldAiSystemPrompt,
  getCurrentLldAttemptPhase,
  LLD_AI_MODES,
  LLD_AI_REQUEST_TYPES,
  createFallbackLldAiResponse,
  describeLldAiProvider,
  normalizeLldAiInput,
  normalizeLldAiProviderPayload,
  normalizeLldAiResponse,
  requestLldAi,
} from '../lib/lld-ai.js';
import { LLD_ATTEMPT_PHASES } from '../lib/lld-phases.js';

assert.deepEqual(LLD_AI_MODES, ['tutor', 'interviewer']);
assert.deepEqual(LLD_AI_REQUEST_TYPES, ['evaluate', 'hint', 'follow_up', 'debrief']);
assert.deepEqual(LLD_ATTEMPT_PHASES.slice(0, 2).map((phase) => phase.key), [
  'functional_requirements',
  'nfr',
]);
assert.notEqual(LLD_ATTEMPT_PHASES[0].key, 'scope');

const phasePrompt = buildLldAiSystemPrompt({
  phaseKey: 'functional_requirements',
  mode: 'tutor',
  requestType: 'evaluate',
  answerMd: 'A user can add an expense and see the updated balance.',
}, { phases: LLD_ATTEMPT_PHASES });
assert.match(phasePrompt, /ACTIVE CHECKPOINT: functional_requirements/i);
assert.match(phasePrompt, /judge only/i);
assert.match(phasePrompt, /do not judge latency|do not judge.*NFR/i);
assert.match(phasePrompt, /JSON only/i);
const nfrPrompt = buildLldAiSystemPrompt({
  phaseKey: 'nfr',
  mode: 'tutor',
  requestType: 'evaluate',
  answerMd: 'p95 latency under 200ms.',
}, { phases: LLD_ATTEMPT_PHASES });
assert.match(nfrPrompt, /ACTIVE CHECKPOINT: nfr/i);
assert.match(nfrPrompt, /do not judge.*functional/i);

const phaseContext = buildLldAiContext({
  phaseKey: 'nfr',
  mode: 'tutor',
  requestType: 'evaluate',
  answerMd: 'p95 latency under 200ms and expense creation is idempotent.',
}, {
  design: { title: 'SplitWise', problemStatementMd: 'Track group expenses and balances.' },
  sections: [],
  phases: LLD_ATTEMPT_PHASES,
  attempt: {
    aiTurns: [
      { phaseKey: 'functional_requirements', feedbackMd: 'stored functional feedback' },
      { phaseKey: 'nfr', feedbackMd: 'stored NFR feedback' },
    ],
  },
});
assert.equal(phaseContext.activeCheckpoint.key, 'nfr');
assert.equal(phaseContext.submittedAnswer, 'p95 latency under 200ms and expense creation is idempotent.');
assert.deepEqual(phaseContext.priorRelevantTurns.map((turn) => turn.feedbackMd), ['stored NFR feedback']);
assert.ok(phaseContext.referenceCriteria.some((criterion) => /measurable|testable/i.test(criterion)));
assert.equal(getCurrentLldAttemptPhase({ phases: [{ key: 'functional_requirements', answer: { submittedAt: 'now' } }] }).key, 'nfr');
assert.equal(getCurrentLldAttemptPhase({ phases: [] }).key, 'functional_requirements');

const savedProviderEnv = { ...process.env };
process.env.OPENROUTER_API_KEY = 'test-openrouter-key';
delete process.env.LLD_AI_PROVIDER;
delete process.env.LLD_AI_API_KEY;
delete process.env.OPENAI_API_KEY;
const openRouterProvider = describeLldAiProvider();
assert.equal(openRouterProvider.provider, 'openrouter');
assert.equal(openRouterProvider.baseUrl, 'https://openrouter.ai/api/v1');
assert.equal(openRouterProvider.model, 'deepseek/deepseek-v4-flash-0731');
assert.equal(openRouterProvider.configured, true);
assert.equal(normalizeLldAiProviderPayload({ assessment: 'Incomplete' }).assessment, 'missed');
assert.equal(normalizeLldAiProviderPayload({ assessment: 'Needs improvement' }).assessment, 'partial');
assert.equal(normalizeLldAiProviderPayload({ assessment: 'Complete' }).assessment, 'clear');
assert.throws(
  () => normalizeLldAiProviderPayload({ phaseKey: 'functional_requirements', assessment: 'partial' }, 'nfr'),
  /must match active phase nfr/i
);
assert.throws(
  () => normalizeLldAiProviderPayload({ phaseKey: 'nfr', outOfScopePoints: ['functional requirements'], assessment: 'partial' }, 'nfr'),
  /outOfScopePoints.*empty/i
);
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

const functionalFallback = createFallbackLldAiResponse({
  phaseKey: 'functional_requirements',
  mode: 'tutor',
  requestType: 'evaluate',
  answerMd: 'A user can add an expense and view the updated balance.',
  design: { title: 'SplitWise', problemStatementMd: 'Track expenses.' },
});
assert.ok(!functionalFallback.missingPoints.some((point) => /\bNFR|latency|availability|consistency\b/i.test(point)));
assert.ok(!/NFR|latency|availability|consistency/i.test(functionalFallback.feedbackMd));

const nfrFallback = createFallbackLldAiResponse({
  phaseKey: 'nfr',
  mode: 'tutor',
  requestType: 'evaluate',
  answerMd: 'p95 latency under 200ms and expense creation is idempotent.',
  design: { title: 'SplitWise', problemStatementMd: 'Track expenses.' },
});
assert.ok(!nfrFallback.missingPoints.some((point) => /functional requirements|observable action|user can/i.test(point)));

const savedFetch = globalThis.fetch;
const savedAiEnv = {
  LLD_AI_PROVIDER: process.env.LLD_AI_PROVIDER,
  LLD_AI_MODEL: process.env.LLD_AI_MODEL,
  OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY,
};
let capturedProviderRequest;
process.env.LLD_AI_PROVIDER = 'openrouter';
process.env.LLD_AI_MODEL = 'deepseek/deepseek-v4-flash-0731';
process.env.OPENROUTER_API_KEY = 'test-openrouter-key';
globalThis.fetch = async (url, options) => {
  capturedProviderRequest = { url, body: JSON.parse(options.body) };
  return {
    ok: true,
    async json() {
      return {
        choices: [{ message: { content: JSON.stringify({
          phaseKey: 'functional_requirements',
          assessment: 'partial',
          feedbackMd: 'You named the user-visible expense action.',
          missingPoints: ['State the rejection outcome for an invalid participant.'],
          topImprovements: ['Add one observable rejection behavior.'],
          nextDrill: 'Rewrite one rejection path.',
          followUpQuestion: 'What should the user observe when a participant is invalid?',
          hintMd: '',
          outOfScopePoints: [],
        }) } }],
      };
    },
  };
};
const liveResponse = await requestLldAi({
  phaseKey: 'functional_requirements',
  mode: 'tutor',
  requestType: 'evaluate',
  answerMd: 'A user can add an expense and view the balance.',
}, {
  design: { title: 'SplitWise', problemStatementMd: 'Track expenses and balances.' },
  sections: [],
  phases: LLD_ATTEMPT_PHASES,
  attempt: { phases: [], aiTurns: [] },
});
assert.equal(capturedProviderRequest.url, 'https://openrouter.ai/api/v1/chat/completions');
assert.equal(capturedProviderRequest.body.model, 'deepseek/deepseek-v4-flash-0731');
assert.match(capturedProviderRequest.body.messages[0].content, /ACTIVE CHECKPOINT: functional_requirements/i);
assert.match(capturedProviderRequest.body.messages[0].content, /Do not judge latency/i);
const capturedContext = JSON.parse(capturedProviderRequest.body.messages[1].content);
assert.equal(capturedContext.activeCheckpoint.key, 'functional_requirements');
assert.equal(capturedContext.submittedAnswer, 'A user can add an expense and view the balance.');
assert.equal(liveResponse.provider, 'openrouter');
assert.equal(liveResponse.availability, 'live');
globalThis.fetch = savedFetch;
for (const [key, value] of Object.entries(savedAiEnv)) {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

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
