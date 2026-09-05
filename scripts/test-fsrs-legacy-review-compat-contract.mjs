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

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const reviewSource = reviewPostBlock(routeSource);
const failures = [];
const check = (condition, message) => {
  if (!condition) failures.push(message);
};

// Temporary request-edge compatibility: quality-only clients have not sent any
// FSRS semantic fields. Keep that mode separate from explicit rating requests.
const legacyModeMatch = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*legacy[\w$]*(?:quality|only|compat)[\w$]*)\s*=\s*([\s\S]{0,600}?)(?:;|\n)/i.exec(reviewSource);
const legacyModeName = legacyModeMatch && legacyModeMatch[1];
const legacyModeExpression = legacyModeMatch && legacyModeMatch[2];
const legacyModePattern = legacyModeName && escapeRegex(legacyModeName);

check(
  Boolean(legacyModeName) &&
    /\bquality\b/.test(legacyModeExpression) &&
    /\brating\b/.test(legacyModeExpression) &&
    /(?:===?\s*undefined|===?\s*null|!\s*(?:body\.)?(?:rating|idempotencyKey|solvedFromScratch)|==\s*null)/.test(legacyModeExpression),
  'POST review must explicitly classify a quality-only legacy request separately from an explicit semantic rating request'
);

check(
  Boolean(legacyModePattern) &&
    new RegExp(`(?:solvedFromScratch\s*:\s*${legacyModePattern}\s*\?\s*false|${legacyModePattern}\s*\?\s*false\s*:\s*(?:body\.)?solvedFromScratch|if\\s*\\(\\s*${legacyModePattern}\\s*\\)[\\s\\S]{0,180}?solvedFromScratch\\s*=\\s*false)`, 'i').test(reviewSource),
  'POST review must set solvedFromScratch to false at the server boundary for a quality-only legacy request'
);

check(
  Boolean(legacyModePattern) &&
    new RegExp(`(?:idempotencyKey\\s*=\\s*${legacyModePattern}\\s*\\?[\\s\\S]{0,260}?(?:crypto|random|uuid|Date\\.now|cardId|userId)|if\\s*\\(\\s*${legacyModePattern}\\s*\\)[\\s\\S]{0,260}?idempotencyKey\\s*=\\s*[\\s\\S]{0,180}?(?:crypto|random|uuid|Date\\.now|cardId|userId))`, 'i').test(reviewSource),
  'POST review must derive or generate a nonempty legacy idempotency key at the server boundary instead of requiring one from a quality-only client'
);

check(
  Boolean(legacyModePattern) &&
    new RegExp(`if\\s*\\(\\s*!${legacyModePattern}\\s*&&[\\s\\S]{0,420}?typeof\\s+body\\.solvedFromScratch\\s*!==?\\s*['"]boolean['"]`, 'i').test(reviewSource),
  'POST review must keep solvedFromScratch strictly boolean for explicit semantic rating requests'
);

check(
  Boolean(legacyModePattern) &&
    new RegExp(`if\\s*\\(\\s*!${legacyModePattern}\\s*&&[\\s\\S]{0,420}?(?:typeof\\s+idempotencyKey\\s*!==?\\s*['"]string['"]|typeof\\s+body\\.idempotencyKey\\s*!==?\\s*['"]string['"])`, 'i').test(reviewSource),
  'POST review must keep idempotencyKey required for explicit semantic rating requests'
);

if (failures.length) {
  throw new assert.AssertionError({
    message: `FSRS legacy quality-only compatibility contract failures:\n- ${failures.join('\n- ')}`,
  });
}

console.log('FSRS legacy quality-only compatibility contract passed.');
