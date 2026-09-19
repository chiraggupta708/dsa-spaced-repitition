import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), 'utf8');
const dbSource = read('../lib/db.js');
const dueSource = read('../api/cards/due.js');
const htmlSource = read('../index.html');

const dueLoaderStart = dbSource.indexOf('export async function loadDueCardSummaries');
const dueLoaderEnd = dbSource.indexOf('export async function upsertCard', dueLoaderStart);
assert.ok(dueLoaderStart >= 0 && dueLoaderEnd > dueLoaderStart, 'db layer must expose a bounded due-summary loader');
const dueLoader = dbSource.slice(dueLoaderStart, dueLoaderEnd);

const dueSummaryStart = dueSource.indexOf('if (useSummary)');
const dueSummaryEnd = dueSource.indexOf('if (!useSummary && limitValue)', dueSummaryStart);
assert.ok(dueSummaryStart >= 0 && dueSummaryEnd > dueSummaryStart, 'due endpoint summary branch must remain discoverable');
const dueSummaryBranch = dueSource.slice(dueSummaryStart, dueSummaryEnd);

assert.match(dueSummaryBranch, /loadDueCardSummaries/, 'summary due batches must use the bounded summary loader');
assert.match(dueSummaryBranch, /queryValue\(req, 'limit'\)/, 'summary due batches must accept an explicit batch limit');
assert.match(dueSummaryBranch, /queryValue\(req, 'cursor'\)/, 'summary due batches must accept a server cursor');
assert.match(dueSummaryBranch, /nextCursor/, 'summary due batches must return the next cursor');
assert.match(dueSummaryBranch, /hasMore/, 'summary due batches must return continuation metadata');
assert.doesNotMatch(dueSummaryBranch, /excludeIds|excludedIds|exclude/,
  'active summary due batches must not carry a client exclusion list');
assert.match(dueLoader, /c\.owner_id\s*=\s*\$1/, 'summary due queries must remain owner scoped');
assert.match(dueLoader, /normalizePracticeLimit\([\s\S]*PRACTICE_PAGE_LIMITS\.due/,
  'summary due queries must enforce the bounded due-page limit');
assert.match(dueLoader, /options\.cursor/, 'summary due queries must decode the server cursor');
assert.match(dueLoader, /LIMIT\s+\$\$\{limitParameter\}/, 'summary due queries must use SQL LIMIT');
assert.match(dueLoader, /SELECT EXISTS\s*\(/, 'summary due queries must derive continuation metadata server-side');
assert.doesNotMatch(dueLoader, /\bOFFSET\b|excludeIds|ANY\s*\(|COUNT\(\*\)\s+OVER/i,
  'summary due queries must use cursor pagination without exclusions or full-queue counts');
for (const field of ['answer', 'actual_code', 'my_thinking', 'right_thinking', 'notes', 'question_description']) {
  assert.doesNotMatch(dueLoader, new RegExp(`\\b${field}\\b`, 'i'),
    `summary due rows must not transfer ${field}`);
}

const appScript = [...htmlSource.matchAll(/<script>([\s\S]*?)<\/script>/g)]
  .map((match) => match[1])
  .find((source) => source.includes('function startReview'));
assert.ok(appScript, 'the main application script must be discoverable');

assert.match(appScript, /REVIEW_BATCH_SIZE\s*=\s*5/, 'normal review must use five-card batches');
assert.match(appScript, /function reviewBatchUrl\s*\(cursor\)/, 'review batching must centralize bounded due requests');
const reviewUrlStart = appScript.indexOf('function reviewBatchUrl(');
const reviewUrlEnd = appScript.indexOf('async function fetchReviewBatch', reviewUrlStart);
assert.ok(reviewUrlStart >= 0 && reviewUrlEnd > reviewUrlStart, 'review batch URL builder must remain discoverable');
const reviewUrlSource = appScript.slice(reviewUrlStart, reviewUrlEnd);
assert.match(reviewUrlSource, /\/api\/cards\/due\?summary=1&limit='\+REVIEW_BATCH_SIZE/,
  'the first and subsequent review requests must ask for five summary cards');
assert.match(reviewUrlSource, /(?:if\(cursor\)|cursor\?)[\s\S]*?&cursor=.*encodeURIComponent\(cursor\)/,
  'review batching must pass the server cursor');

const fetchReviewStart = appScript.indexOf('async function fetchReviewBatch(');
const fetchReviewEnd = appScript.indexOf('function reviewCardId', fetchReviewStart);
assert.ok(fetchReviewStart >= 0 && fetchReviewEnd > fetchReviewStart, 'review batch fetcher must remain discoverable');
const fetchReviewSource = appScript.slice(fetchReviewStart, fetchReviewEnd);
assert.match(fetchReviewSource, /api\(reviewBatchUrl\(cursor\)\)/, 'review batches must use the summary URL builder');
assert.match(fetchReviewSource, /data\.nextCursor/, 'review batches must consume nextCursor');
assert.match(fetchReviewSource, /data\.hasMore/, 'review batches must consume hasMore');
assert.doesNotMatch(appScript, /excludeIds|reviewExcludedIds|(?:[?&])exclude=/,
  'the active review path must not maintain a client exclusion list');

const startReviewStart = appScript.indexOf('async function startReview');
const startReviewEnd = appScript.indexOf('function renderReview', startReviewStart);
assert.ok(startReviewStart >= 0 && startReviewEnd > startReviewStart, 'startReview function must remain discoverable');
const startReviewSource = appScript.slice(startReviewStart, startReviewEnd);
assert.match(startReviewSource, /fetchReviewBatch\(null\)/, 'normal review must fetch the first summary batch without client exclusions');
assert.doesNotMatch(startReviewSource, /excludeIds|reviewExcludedIds|(?:[?&])exclude=/,
  'normal review must not initialize a client exclusion set');

for (const rating of ['again', 'hard', 'good', 'easy']) {
  assert.match(htmlSource, new RegExp(`data-rating="${rating}"`), `review UI must retain the ${rating} rating`);
}
assert.match(appScript, /state\.rating=b\.dataset\.rating/, 'rating selection must preserve semantic values');
assert.match(appScript, /\/api\/cards\/\'\+encodeURIComponent\(cardId\)\+'\?review=1&response=summary/,
  'review submissions must retain the summary response route');
assert.match(appScript, /body:JSON\.stringify\(\{rating:state\.rating,idempotencyKey:pending\.idempotencyKey,solvedFromScratch:false\}\)/,
  'recall payload must retain rating and idempotency while keeping independent-solve credit separate');
assert.doesNotMatch(appScript, /body:JSON\.stringify\(\{quality:/,
  'review payload must not regress to the legacy quality field');

const continueStart = appScript.indexOf('function continueReview');
const continueEnd = appScript.indexOf('function openDesign', continueStart);
assert.ok(continueStart >= 0 && continueEnd > continueStart, 'continueReview function must remain discoverable');
const continueSource = appScript.slice(continueStart, continueEnd);
assert.doesNotMatch(continueSource, /excludeIds|reviewExcludedIds|(?:[?&])exclude=/,
  'successful ratings must not build a client exclusion list');
assert.match(continueSource, /reviewHasMore/, 'the next batch decision must use server continuation metadata');
assert.match(continueSource, /reviewNextCursor/, 'the next batch decision must use the server cursor');
assert.match(continueSource, /fetchReviewBatch\(state\.reviewNextCursor\)/, 'the next batch must be fetched from the cursor path');
assert.doesNotMatch(continueSource, /cards\/due\?offset|offset=/i, 'the next batch must not use a naive offset');

assert.match(htmlSource, /id="cardPagination"/, 'card list must expose an accessible pagination region');
assert.match(htmlSource, /id="previousPage"[\s\S]*?Previous/, 'card list must expose a previous-page control');
assert.match(htmlSource, /id="nextPage"[\s\S]*?Next/, 'card list must expose a next-page control');
assert.match(htmlSource, /aria-label="Card list pagination"/, 'pagination must have an accessible label');
assert.match(appScript, /cardCursorStack/, 'card pagination must retain server cursor history');
assert.match(appScript, /cardNextCursor/, 'card pagination must retain the server next cursor');
assert.match(appScript, /cardHasMore/, 'card pagination must use server continuation metadata');
assert.doesNotMatch(appScript, /list\.slice\(/, 'pagination must not slice a downloaded collection on the client');
assert.match(appScript, /previousPage[\s\S]*disabled|disabled[\s\S]*previousPage/, 'previous control must be disabled at the first page');
assert.match(appScript, /nextPage[\s\S]*disabled|disabled[\s\S]*nextPage/, 'next control must be disabled at the last page');
assert.match(appScript, /resetCardPage\(\)/, 'pagination must have an explicit page reset path');

const resetLoadCount = (appScript.match(/loadCardPage\(null,true,1\)/g) || []).length;
assert.ok(resetLoadCount >= 5, 'search, filters, tabs, and refresh must reset the visible card page');
assert.match(appScript, /\$\('difficulty'\)\.onchange=function\(\)\{loadCardPage\(null,true,1\)\}/, 'difficulty changes must reset pagination');
assert.match(appScript, /\$\('sort'\)\.onchange=function\(\)\{loadCardPage\(null,true,1\)\}/, 'sort changes must reset pagination');
assert.match(appScript, /function searchCards\(\)[\s\S]*?loadCardPage\(null,true,1\)/, 'search changes must reset pagination');
assert.match(appScript, /function refresh\(\)[\s\S]*?loadCardPage\(null,true,1\)/, 'refresh must reset pagination');
assert.match(appScript, /function setTab\(tab\)[\s\S]*?loadCardPage\(null,true,1\)/, 'tab changes must reset pagination');

console.log('Review batching and card pagination contract tests passed.');
