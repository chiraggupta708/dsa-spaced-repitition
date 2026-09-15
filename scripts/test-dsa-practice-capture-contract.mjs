#!/usr/bin/env node
/**
 * Database-free source/runtime contract for DSA capture, selected sessions,
 * and explicit practice reveal. It never imports lib/db.js or opens a DB.
 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const domainPath = path.join(root, 'lib', 'dsa-practice.js');
const dbPath = path.join(root, 'lib', 'db.js');
const apiPath = path.join(root, 'api', 'practice.js');
const schemaPath = path.join(root, 'schema.sql');
const [domainSource, dbSource, apiSource, schemaSource] = await Promise.all([
  readFile(domainPath, 'utf8'),
  readFile(dbPath, 'utf8'),
  readFile(apiPath, 'utf8'),
  readFile(schemaPath, 'utf8'),
]);
const domain = await import(pathToFileURL(domainPath).href);
const postBranchStart = apiSource.indexOf("if (req.method === 'POST')");
const postBranchEnd = apiSource.indexOf("if (req.method === 'PUT')", postBranchStart);
assert.ok(postBranchStart >= 0 && postBranchEnd > postBranchStart, 'practice API must have a bounded POST branch');
const postBranch = apiSource.slice(postBranchStart, postBranchEnd);

const {
  PRACTICE_CAPTURE_LIMITS,
  PRACTICE_CAPTURE_FIELDS,
  PRACTICE_REVEAL_FIELDS,
  PracticeIdempotencyConflictError,
  normalizePracticeCaptureInput,
  fingerprintPracticeCaptureInput,
  practiceCaptureIdentity,
  toPracticeQueueItem,
  toPracticeCardDto,
  toPracticeRevealDto,
} = domain;

assert.ok(PRACTICE_CAPTURE_LIMITS.title > 0);
assert.ok(PRACTICE_CAPTURE_LIMITS.link > 0);
assert.ok(PRACTICE_CAPTURE_LIMITS.description > 0);
assert.ok(PRACTICE_CAPTURE_LIMITS.approach > 0);
assert.ok(PRACTICE_CAPTURE_LIMITS.reference > 0);
assert.ok(PRACTICE_CAPTURE_LIMITS.code > 0);
assert.ok(PRACTICE_CAPTURE_LIMITS.notes > 0);
assert.ok(PRACTICE_CAPTURE_LIMITS.insight > 0);
assert.ok(PRACTICE_CAPTURE_LIMITS.trap > 0);
assert.ok(PRACTICE_CAPTURE_LIMITS.tag > 0);
assert.ok(Array.isArray(PRACTICE_CAPTURE_FIELDS));
assert.ok(PRACTICE_CAPTURE_FIELDS.includes('title'));
assert.ok(PRACTICE_CAPTURE_FIELDS.includes('idempotencyKey'));
assert.ok(Array.isArray(PRACTICE_REVEAL_FIELDS));
assert.ok(PRACTICE_REVEAL_FIELDS.includes('reference'));
assert.ok(PRACTICE_REVEAL_FIELDS.includes('keyInsight'));

const capture = normalizePracticeCaptureInput({
  idempotencyKey: '  capture-1  ',
  title: '  Two   Sum  ',
  link: 'https://EXAMPLE.test/problems/two-sum#notes',
  description: '  constraints and examples  ',
  approach: '  two pointers  ',
  reference: '  reference solution  ',
  code: '  const answer = 1;  ',
  notes: '  watch the invariant  ',
  insight: '  move the left pointer  ',
  trap: '  forgetting duplicate values  ',
  tags: [' Array ', 'array', ' Hash Map '],
});
assert.equal(capture.idempotencyKey, 'capture-1');
assert.equal(capture.title, 'Two Sum');
assert.equal(capture.link, 'https://example.test/problems/two-sum');
assert.equal(capture.description, 'constraints and examples');
assert.deepEqual(capture.tags, ['array', 'hash map']);
assert.equal(capture.difficulty, null);
assert.equal(capture.outcome, null);
assert.deepEqual(practiceCaptureIdentity(capture), {
  type: 'link',
  value: 'https://example.test/problems/two-sum',
});

const titleOnly = normalizePracticeCaptureInput({
  idempotencyKey: 'capture-2',
  title: '  Custom   Problem ',
  difficulty: null,
  outcome: null,
  tags: [],
});
assert.equal(titleOnly.link, null);
assert.equal(titleOnly.difficulty, null);
assert.equal(titleOnly.outcome, null);
assert.deepEqual(practiceCaptureIdentity(titleOnly), {
  type: 'title',
  value: 'custom problem',
});

assert.equal(
  fingerprintPracticeCaptureInput(capture),
  fingerprintPracticeCaptureInput(normalizePracticeCaptureInput({ ...capture, tags: ['hash map', 'array'] })),
);
assert.notEqual(
  fingerprintPracticeCaptureInput(capture),
  fingerprintPracticeCaptureInput({ ...capture, notes: 'different' }),
);

for (const field of ['cardId', 'ownerId', 'timeZone', 'answer', 'question', 'source']) {
  assert.throws(
    () => normalizePracticeCaptureInput({ idempotencyKey: 'capture-x', title: 'Problem', [field]: 'bad' }),
    (error) => error.code === 'invalid_practice_input',
    `capture must reject unsupported field ${field}`,
  );
}
assert.throws(
  () => normalizePracticeCaptureInput({ idempotencyKey: 'capture-x', title: 'Problem', outcome: 'again' }),
  (error) => error.code === 'invalid_practice_input',
);
assert.throws(
  () => normalizePracticeCaptureInput({ idempotencyKey: 'capture-x', title: 'Problem', difficulty: 'mediumish' }),
  (error) => error.code === 'invalid_practice_input',
);
for (const field of ['title', 'link', 'description', 'approach', 'reference', 'code', 'notes', 'insight', 'trap']) {
  assert.throws(
    () => normalizePracticeCaptureInput({
      idempotencyKey: 'capture-x',
      title: 'Problem',
      [field]: 'x'.repeat(PRACTICE_CAPTURE_LIMITS[field] + 1),
    }),
    (error) => error.code === 'invalid_practice_input',
    `${field} must be bounded`,
  );
}
assert.throws(
  () => normalizePracticeCaptureInput({ idempotencyKey: 'capture-x', title: 'Problem', tags: ['x'.repeat(PRACTICE_CAPTURE_LIMITS.tag + 1)] }),
  (error) => error.code === 'invalid_practice_input',
);

const reveal = toPracticeRevealDto({
  card_id: 'card-1',
  prompt: 'Prompt text',
  link: 'https://example.test/problem',
  reference: 'Reference',
  approach: 'Approach',
  code: 'Code',
  notes: 'Notes',
  key_insight: 'Insight',
  recurring_trap: 'Trap',
});
assert.deepEqual(reveal, {
  cardId: 'card-1',
  prompt: 'Prompt text',
  link: 'https://example.test/problem',
  reference: 'Reference',
  approach: 'Approach',
  code: 'Code',
  notes: 'Notes',
  keyInsight: 'Insight',
  recurringTrap: 'Trap',
});
for (const field of ['answer', 'actual_code', 'my_thinking', 'right_thinking']) {
  assert.equal(field in toPracticeQueueItem({ [field]: 'secret' }), false);
  assert.equal(field in toPracticeCardDto({ [field]: 'secret' }), false);
}
assert.equal('reference' in toPracticeQueueItem({ reference: 'secret' }), false);
assert.equal('keyInsight' in toPracticeCardDto({ key_insight: 'secret' }), false);

assert.match(domainSource, /normalizePracticeCaptureInput/);
assert.match(domainSource, /fingerprintPracticeCaptureInput/);
assert.match(domainSource, /PRACTICE_CAPTURE_LIMITS/);
assert.match(domainSource, /PRACTICE_REVEAL_FIELDS/);
assert.match(domainSource, /question_description/);
assert.match(dbSource, /export async function getPracticeReveal\(cardId, ownerId\)/);
assert.match(dbSource, /export async function recordPracticeCapture\(/);
assert.match(dbSource, /dsa_practice_captures/);
assert.match(dbSource, /dsa_practice_learning_notes/);
assert.match(dbSource, /capture_claim AS/);
assert.match(dbSource, /ON CONFLICT \(owner_id, idempotency_key\) DO NOTHING/);
assert.match(dbSource, /request_fingerprint/);
assert.match(dbSource, /WHERE c\.owner_id\s*=\s*\$\d/);
assert.match(dbSource, /INSERT INTO cards/);
assert.match(dbSource, /INSERT INTO cards_tags/);
assert.match(dbSource, /INSERT INTO dsa_practice_attempts/);
assert.match(dbSource, /INSERT INTO fsrs_practice_states/);
assert.match(dbSource, /revision/);
assert.match(dbSource, /WHERE\s+\$\d+::text IS NOT NULL/);
assert.match(dbSource, /String\(row\.request_fingerprint\) !== fingerprint/);
assert.match(dbSource, /PracticeIdempotencyConflictError/);
assert.match(dbSource, /cardId\s*=|card_id\s*=/);
assert.match(dbSource, /status.*duplicate|duplicate.*status/is);
assert.match(apiSource, /getPracticeReveal/);
assert.match(apiSource, /recordPracticeCapture/);
assert.match(apiSource, /view === 'reveal'/);
assert.match(apiSource, /view === 'capture'/);
assert.match(apiSource, /getPracticeSession\(userId,\s*\{[\s\S]*cardId/);
assert.match(apiSource, /duplicate:\s*result\.duplicate/);
assert.match(apiSource, /cardId:\s*result\.cardId/);
assert.doesNotMatch(postBranch, /body\.timeZone|timeZone\s*:/);
for (const field of ['answer', 'actual_code', 'my_thinking', 'right_thinking', 'notes']) {
  assert.doesNotMatch(apiSource, new RegExp(`\\b${field}\\b`, 'i'));
}
assert.match(schemaSource, /CREATE TABLE IF NOT EXISTS dsa_practice_captures/);
assert.match(schemaSource, /CREATE TABLE IF NOT EXISTS dsa_practice_learning_notes/);
assert.match(schemaSource, /card_id\s+TEXT(?!\s+NOT NULL)/);
assert.match(schemaSource, /status\s+TEXT\s+NOT NULL[\s\S]*pending[\s\S]*created[\s\S]*duplicate/);
assert.match(schemaSource, /UNIQUE \(owner_id, idempotency_key\)/);
assert.match(schemaSource, /idx_dsa_practice_captures_owner_idempotency/);
assert.match(schemaSource, /idx_dsa_practice_learning_notes_owner_card/);
assert.match(schemaSource, /key_insight/);
assert.match(schemaSource, /recurring_trap/);
assert.doesNotMatch(schemaSource, /-- DSA Practice Phase 0[\s\S]*\b(?:INSERT INTO|UPDATE\s+\w+\s+SET|DELETE FROM)\b/i);
assert.equal(PracticeIdempotencyConflictError.prototype instanceof Error, true);

console.log('DSA practice capture source contract: PASS (database-free; source assertions only).');
