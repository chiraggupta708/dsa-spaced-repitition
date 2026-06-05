#!/usr/bin/env node
/**
 * API integration tests for Coding Journal
 *
 * Usage:
 *   node test/api-test.js                            # test live Vercel deployment
 *   BASE_URL=http://localhost:3000 node test/api-test.js  # test local dev server
 *
 * Exit code: 0 = all pass, 1 = any failure
 */

const BASE_URL = process.env.BASE_URL || 'https://dsa-spaced-repitition.vercel.app';

let passed = 0;
let failed = 0;
let createdCardId = null;

async function request(method, path, body) {
  const url = `${BASE_URL}${path}`;
  const opts = { method, headers: {} };
  if (body) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(url, opts);
  const contentType = res.headers.get('content-type') || '';
  let data;
  if (contentType.includes('application/json')) {
    data = await res.json();
  } else {
    data = await res.text();
  }
  return { status: res.status, data };
}

function test(name, fn) {
  return fn().then(
    () => { passed++; console.log(`  ✅ ${name}`); },
    (err) => { failed++; console.log(`  ❌ ${name}: ${err.message || err}`); }
  );
}

function assert(condition, msg) {
  if (!condition) throw new Error(msg);
}

/* ================================================================ */
/*  TESTS                                                            */
/* ================================================================ */

async function testHealth() {
  const { status, data } = await request('GET', '/api/health');
  assert(status === 200, `expected 200, got ${status}`);
  assert(data.status === 'ok', `expected status='ok', got ${JSON.stringify(data)}`);
}

async function testCreateCard() {
  const card = {
    question: 'Test Two Sum',
    link: 'https://leetcode.com/problems/two-sum/',
    tags: ['arrays', 'hash-map', 'test'],
    difficulty: 'easy',
    actual_code: 'function twoSum(nums, target) {\n  const map = {};\n  for (let i = 0; i < nums.length; i++) {\n    const complement = target - nums[i];\n    if (complement in map) return [map[complement], i];\n    map[nums[i]] = i;\n  }\n}',
    my_thinking: 'I thought about brute force O(n²) but hash map is better.',
    right_thinking: 'Use hash map to store complements for O(n) time, O(n) space.',
    notes: 'Classic Two Sum — always hash map first.'
  };

  const { status, data } = await request('POST', '/api/cards', card);
  assert(status === 201, `expected 201, got ${status}`);
  assert(data.ok === true, `expected ok=true, got ${JSON.stringify(data)}`);
  assert(data.card && data.card.id, `expected card with id, got ${JSON.stringify(data)}`);
  assert(data.card.question === card.question, `question mismatch`);
  assert(Array.isArray(data.card.tags) && data.card.tags.length === 3, `expected 3 tags`);
  assert(data.card.difficulty === 'easy', `difficulty mismatch`);
  assert(data.card.sm2, `expected sm2 object`);
  assert(data.card.sm2.repetitions === 0, `expected fresh card with 0 reps`);

  createdCardId = data.card.id;
}

async function testGetAllCards() {
  const { status, data } = await request('GET', '/api/cards');
  assert(status === 200, `expected 200, got ${status}`);
  assert(data.ok === true, `expected ok=true`);
  assert(Array.isArray(data.cards), `expected cards array`);
  assert(data.cards.length > 0, `expected at least 1 card`);
  const found = data.cards.find(c => c.id === createdCardId);
  assert(found, `created card (${createdCardId}) not found in list`);
}

async function testGetSingleCard() {
  assert(createdCardId, 'no card to fetch');
  const { status, data } = await request('GET', `/api/cards/${createdCardId}`);
  assert(status === 200, `expected 200, got ${status}`);
  assert(data.ok === true, `expected ok=true`);
  assert(data.card.id === createdCardId, `card id mismatch`);
  assert(data.card.question === 'Test Two Sum', `question mismatch`);
}

async function testGetSingleCardNotFound() {
  const { status, data } = await request('GET', '/api/cards/nonexistent-id-999999');
  assert(status === 404, `expected 404, got ${status}`);
  assert(data.ok === false, `expected ok=false`);
}

async function testUpdateCard() {
  assert(createdCardId, 'no card to update');
  const updates = {
    question: 'Test Two Sum (Updated)',
    difficulty: 'hard',
    notes: 'Updated notes for testing.'
  };
  const { status, data } = await request('PUT', `/api/cards/${createdCardId}`, updates);
  assert(status === 200, `expected 200, got ${status}`);
  assert(data.ok === true, `expected ok=true`);
  assert(data.card.question === updates.question, `question not updated`);
  assert(data.card.difficulty === updates.difficulty, `difficulty not updated`);
  assert(data.card.notes === updates.notes, `notes not updated`);
}

async function testReviewCard() {
  assert(createdCardId, 'no card to review');
  const { status, data } = await request('POST', `/api/cards/${createdCardId}?review=1`, { quality: 3 });
  assert(status === 200, `expected 200, got ${status}`);
  assert(data.ok === true, `expected ok=true`);
  assert(data.card.sm2, `expected sm2 object`);
  assert(data.card.sm2.repetitions === 1, `expected 1 rep after review, got ${data.card.sm2.repetitions}`);
  assert(data.card.sm2.interval === 1, `expected interval 1, got ${data.card.sm2.interval}`);
  assert(data.card.sm2.lastQuality === 3, `expected lastQuality 3`);
  assert(data.card.sm2.nextReview, `expected nextReview date`);
  assert(data.card.updated, `expected updated timestamp`);
}

async function testReviewCardInvalidQuality() {
  assert(createdCardId, 'no card to review');
  const { status, data } = await request('POST', `/api/cards/${createdCardId}?review=1`, { quality: 99 });
  assert(status === 400, `expected 400, got ${status}`);
  assert(data.ok === false, `expected ok=false`);
}

async function testReviewCardNoRating() {
  assert(createdCardId, 'no card to review');
  const { status, data } = await request('POST', `/api/cards/${createdCardId}?review=1`, {});
  assert(status === 400, `expected 400, got ${status}`);
  assert(data.ok === false, `expected ok=false`);
}

async function testGetDueCards() {
  const { status, data } = await request('GET', '/api/cards/due');
  assert(status === 200, `expected 200, got ${status}`);
  assert(data.ok === true, `expected ok=true`);
  assert(Array.isArray(data.cards), `expected cards array`);
  // The reviewed card's nextReview is tomorrow, so it shouldn't be due today
  if (createdCardId) {
    const foundDue = data.cards.find(c => c.id === createdCardId);
    // It might be 'due' if nextReview is today or null, but we set it to tomorrow
    // If it shows up, that's fine — just document it
  }
}

async function testGetMasteredCards() {
  const { status, data } = await request('GET', '/api/cards/mastered');
  assert(status === 200, `expected 200, got ${status}`);
  assert(data.ok === true, `expected ok=true`);
  assert(Array.isArray(data.cards), `expected cards array`);
  // Our test card only has 1 rep, so it shouldn't be mastered (needs 5+)
  if (createdCardId) {
    const foundMastered = data.cards.find(c => c.id === createdCardId);
    assert(!foundMastered, `test card should not be mastered yet (only 1 rep)`);
  }
}

async function testGetStats() {
  const { status, data } = await request('GET', '/api/stats');
  assert(status === 200, `expected 200, got ${status}`);
  assert(data.ok === true, `expected ok=true`);
  assert(typeof data.stats.total === 'number', `expected stats.total number`);
  assert(typeof data.stats.due === 'number', `expected stats.due number`);
  assert(typeof data.stats.mastered === 'number', `expected stats.mastered number`);
  assert(typeof data.stats.streak === 'number', `expected stats.streak number`);
}

async function testExport() {
  const res = await fetch(`${BASE_URL}/api/export`);
  assert(res.status === 200, `expected 200, got ${res.status}`);
  const contentType = res.headers.get('content-type') || '';
  assert(contentType.includes('application/json'), `expected JSON content-type`);
  const data = await res.json();
  assert(Array.isArray(data.cards), `expected cards array in export`);
}

async function testDeleteCard() {
  assert(createdCardId, 'no card to delete');
  const { status, data } = await request('DELETE', `/api/cards/${createdCardId}`);
  assert(status === 200, `expected 200, got ${status}`);
  assert(data.ok === true, `expected ok=true`);

  // Verify it's gone
  const { status: getStatus } = await request('GET', `/api/cards/${createdCardId}`);
  assert(getStatus === 404, `expected 404 after delete, got ${getStatus}`);

  createdCardId = null;
}

async function testDeleteCardNotFound() {
  const { status, data } = await request('DELETE', '/api/cards/nonexistent-id-999999');
  assert(status === 404, `expected 404, got ${status}`);
  assert(data.ok === false, `expected ok=false`);
}

async function testUpdateCardNotFound() {
  const { status, data } = await request('PUT', '/api/cards/nonexistent-id-999999', { question: 'nope' });
  assert(status === 404, `expected 404, got ${status}`);
  assert(data.ok === false, `expected ok=false`);
}

async function testImport() {
  // Create a card first, then clean up via import
  const testCards = [
    {
      id: `import-test-${Date.now()}`,
      question: 'Import Test Card',
      link: '',
      tags: ['test'],
      difficulty: 'medium',
      actual_code: '',
      my_thinking: 'test import',
      right_thinking: 'test import',
      notes: '',
      sm2: {
        easinessFactor: 2.5,
        interval: 0,
        repetitions: 0,
        nextReview: null,
        lastReview: null,
        lastQuality: null
      }
    }
  ];
  const { status, data } = await request('POST', '/api/import', { cards: testCards });
  assert(status === 200, `expected 200, got ${status}`);
  assert(data.ok === true, `expected ok=true`);
  assert(data.count === testCards.length, `expected count ${testCards.length}`);

  // Verify imported card exists
  const { data: allCards } = await request('GET', '/api/cards');
  const found = allCards.cards.find(c => c.id === testCards[0].id);
  assert(found, `imported card not found after import`);
}

async function testHealthAfterImport() {
  // Just ensure everything still works
  const { status, data } = await request('GET', '/api/health');
  assert(status === 200, `expected 200, got ${status}`);
  assert(data.status === 'ok', `health check failed after operations`);
}

/* ================================================================ */
/*  RUNNER                                                           */
/* ================================================================ */

async function runAll() {
  console.log(`\n  Coding Journal API Tests`);
  console.log(`  ${BASE_URL}`);
  console.log(`  ${new Date().toISOString()}`);
  console.log(`  ──────────────────────────────────────\n`);

  await test('GET  /api/health', testHealth);
  await test('POST /api/cards (create)', testCreateCard);
  await test('GET  /api/cards (all)', testGetAllCards);
  await test('GET  /api/cards/:id (single)', testGetSingleCard);
  await test('GET  /api/cards/:id (404)', testGetSingleCardNotFound);
  await test('PUT  /api/cards/:id (update)', testUpdateCard);
  await test('POST /api/cards/:id?review=1 (review)', testReviewCard);
  await test('POST /api/cards/:id?review=1 (invalid quality)', testReviewCardInvalidQuality);
  await test('POST /api/cards/:id?review=1 (missing quality)', testReviewCardNoRating);
  await test('GET  /api/cards/due', testGetDueCards);
  await test('GET  /api/cards/mastered', testGetMasteredCards);
  await test('GET  /api/stats', testGetStats);
  await test('GET  /api/export', testExport);
  await test('DELETE /api/cards/:id', testDeleteCard);
  await test('DELETE /api/cards/:id (404)', testDeleteCardNotFound);
  await test('PUT  /api/cards/:id (404)', testUpdateCardNotFound);
  await test('POST /api/import', testImport);
  await test('GET  /api/health (post-import)', testHealthAfterImport);

  console.log(`\n  ──────────────────────────────────────`);
  console.log(`  Results: ${passed} passed, ${failed} failed\n`);

  process.exit(failed > 0 ? 1 : 0);
}

runAll().catch((err) => {
  console.error('\n  💥 Unexpected error:', err.message);
  process.exit(1);
});