import assert from 'node:assert/strict';
import fs from 'node:fs';

const routePath = new URL('../api/cards/[...cardId].js', import.meta.url);
const routeSource = fs.readFileSync(routePath, 'utf8');

function reviewPostBlock(source) {
  const start = source.indexOf("if (req.method === 'POST' && isReviewPath)");
  assert.ok(start >= 0, 'route must retain a dedicated POST review branch');
  const open = source.indexOf('{', start);
  assert.ok(open >= 0, 'POST review branch must have a body');

  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    if (source[index] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }
  throw new Error('POST review branch is not closed');
}

const reviewSource = reviewPostBlock(routeSource);
const failures = [];
const check = (condition, message) => {
  if (!condition) failures.push(message);
};

// Phase 0 request contract: first-class FSRS fields, with a route-local
// compatibility mapping for clients that still submit legacy SM-2 quality.
check(
  /\b(?:body\.(?:rating|reviewRating)|\{[^}]*\b(?:rating|reviewRating)\b[^}]*\}\s*=\s*body)/.test(reviewSource) &&
    /['"]again['"]/.test(routeSource.toLowerCase()) &&
    /['"]hard['"]/.test(routeSource.toLowerCase()) &&
    /['"]good['"]/.test(routeSource.toLowerCase()) &&
    /['"]easy['"]/.test(routeSource.toLowerCase()),
  'POST review must validate semantic rating labels: again, hard, good, easy'
);
check(
  /\bbody\.(?:idempotencyKey|idempotency_key)\b|\{[^}]*\b(?:idempotencyKey|idempotency_key)\b[^}]*\}\s*=\s*body/.test(reviewSource),
  'POST review must accept an idempotencyKey request field'
);
check(
  /\b(?:body\.)?solvedFromScratch\b/.test(reviewSource) &&
    /typeof\s+(?:body\.)?solvedFromScratch\s*!==?\s*['"]boolean['"]/.test(reviewSource),
  'POST review must separately validate solvedFromScratch as a boolean'
);
check(
  /\bquality\b/.test(reviewSource) &&
    /(?:\b(?:legacy|quality)[A-Za-z_]*\s*=\s*\{|\b(?:legacy|quality)[A-Za-z_]*\s*=\s*new Map|\bquality\s*[=:][\s\S]{0,240}['"](?:again|hard|good|easy)['"])/i.test(routeSource),
  'POST review must contain an explicit legacy quality-to-rating mapping in the route'
);
check(
  /\brecordReview\s*\(/.test(reviewSource),
  'POST review must delegate scheduling and persistence to recordReview'
);
check(
  !/\bsm2Calc\s*\(/.test(reviewSource),
  'POST review must not call sm2Calc directly'
);
check(
  !/\bupsertCard\s*\(/.test(reviewSource),
  'POST review must not call upsertCard directly'
);

if (failures.length) {
  throw new assert.AssertionError({
    message: `FSRS review API contract failures:\n- ${failures.join('\n- ')}`,
  });
}

console.log('FSRS review API contract tests passed.');
