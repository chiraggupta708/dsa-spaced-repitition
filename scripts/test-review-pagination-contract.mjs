import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), 'utf8');
const dbSource = read('../lib/db.js');
const dueSource = read('../api/cards/due.js');
const htmlSource = read('../index.html');

const dueLoaderStart = dbSource.indexOf('export async function loadDueCards');
const dueLoaderEnd = dbSource.indexOf('export async function upsertCard', dueLoaderStart);
assert.ok(dueLoaderStart >= 0 && dueLoaderEnd > dueLoaderStart, 'db layer must expose a bounded due-card loader');
const dueLoader = dbSource.slice(dueLoaderStart, dueLoaderEnd);

assert.match(dueSource, /loadDueCards/, 'due endpoint must use the bounded due-card loader');
assert.match(dueSource, /queryValue\(req, 'limit'\)/, 'due endpoint must accept an explicit batch limit');
assert.match(dueSource, /queryValue\(req, 'exclude'\)/, 'due endpoint must accept reviewed-card exclusions');
assert.match(dueSource, /hasMore/, 'due endpoint must return continuation metadata');
assert.match(dueSource, /load\(userId\)/, 'unparameterized due requests must preserve the existing full response');
assert.match(dueLoader, /c\.owner_id\s*=\s*\$1/, 'bounded due queries must remain owner scoped');
assert.match(dueLoader, /LIMIT\s+\$\d+/, 'bounded due queries must use SQL LIMIT');
assert.match(dueLoader, /COUNT\(\*\)\s+OVER\s*\(\)/, 'bounded due queries must derive continuation metadata without loading all full cards');
assert.match(dueLoader, /ANY\(\$\d+(?:::text\[\])?\)|<>\s*ALL\(\$\d+(?:::text\[\])?\)/, 'bounded due queries must exclude already reviewed IDs');
assert.doesNotMatch(dueLoader, /\bOFFSET\b/i, 'due batching must not use a shifting offset');
assert.match(dueLoader, /c\.\*|actual_code|my_thinking|right_thinking|question_description/, 'bounded due rows must retain full review body fields');

const appScript = [...htmlSource.matchAll(/<script>([\s\S]*?)<\/script>/g)]
  .map((match) => match[1])
  .find((source) => source.includes('function startReview'));
assert.ok(appScript, 'the main application script must be discoverable');

assert.match(appScript, /REVIEW_BATCH_SIZE\s*=\s*5/, 'normal review must use five-card batches');
assert.match(appScript, /CARD_PAGE_SIZE\s*=\s*10/, 'card list pagination must use ten cards per page');
assert.match(appScript, /function reviewBatchUrl\s*\(/, 'review batching must centralize bounded due requests');
assert.match(appScript, /limit='?\+?REVIEW_BATCH_SIZE|limit=\'+REVIEW_BATCH_SIZE/, 'the first and subsequent review requests must ask for five cards');
assert.match(appScript, /exclude|reviewExcludedIds/, 'review batching must carry reviewed-card exclusions');
assert.match(appScript, /function fetchReviewBatch\s*\(/, 'review batching must have one batch-fetch path');
assert.match(appScript, /reviewHasMore|hasMore/, 'the client must consume continuation metadata');

const startReviewStart = appScript.indexOf('async function startReview');
const startReviewEnd = appScript.indexOf('function renderReview', startReviewStart);
assert.ok(startReviewStart >= 0 && startReviewEnd > startReviewStart, 'startReview function must remain discoverable');
const startReviewSource = appScript.slice(startReviewStart, startReviewEnd);
assert.match(startReviewSource, /fetchReviewBatch|reviewBatchUrl/, 'normal review must fetch a batch instead of the entire due queue');
assert.match(startReviewSource, /reviewExcludedIds\s*=\s*\[\]/, 'a new normal review must start with an empty reviewed-ID exclusion set');

const continueStart = appScript.indexOf('function continueReview');
const continueEnd = appScript.indexOf('function openDesign', continueStart);
assert.ok(continueStart >= 0 && continueEnd > continueStart, 'continueReview function must remain discoverable');
const continueSource = appScript.slice(continueStart, continueEnd);
assert.match(continueSource, /reviewExcludedIds.*push|push.*reviewExcludedIds/, 'reviewed IDs must be recorded after successful ratings');
assert.match(continueSource, /reviewHasMore/, 'the next batch decision must use server continuation metadata');
assert.match(continueSource, /fetchReviewBatch/, 'the next batch must be fetched from the batch path');
assert.doesNotMatch(continueSource, /cards\/due\?offset|offset=/i, 'the next batch must not use a naive offset');

assert.match(htmlSource, /id="cardPagination"/, 'card list must expose an accessible pagination region');
assert.match(htmlSource, /id="previousPage"[\s\S]*?Previous/, 'card list must expose a previous-page control');
assert.match(htmlSource, /id="nextPage"[\s\S]*?Next/, 'card list must expose a next-page control');
assert.match(htmlSource, /aria-label="Card list pagination"/, 'pagination must have an accessible label');
assert.match(appScript, /list\.slice\([^)]*CARD_PAGE_SIZE|pageStart[\s\S]*CARD_PAGE_SIZE/, 'pagination must slice only after filtering and sorting');
assert.match(appScript, /previousPage[\s\S]*disabled|disabled[\s\S]*previousPage/, 'previous control must be disabled at the first page');
assert.match(appScript, /nextPage[\s\S]*disabled|disabled[\s\S]*nextPage/, 'next control must be disabled at the last page');
assert.match(appScript, /cardPage\s*=\s*1|resetCardPage/, 'pagination must have an explicit page reset path');

const resetCount = (appScript.match(/resetCardPage\(\)|cardPage\s*=\s*1/g) || []).length;
assert.ok(resetCount >= 5, 'search, filters, tabs, and refresh must reset the visible card page');
assert.match(appScript, /difficulty.*resetCardPage|resetCardPage[\s\S]*difficulty/, 'difficulty changes must reset pagination');
assert.match(appScript, /sort.*resetCardPage|resetCardPage[\s\S]*sort/, 'sort changes must reset pagination');
assert.match(appScript, /searchCards[\s\S]*resetCardPage|oninput[\s\S]*resetCardPage/, 'search changes must reset pagination');
assert.match(appScript, /function refresh[\s\S]*resetCardPage/, 'refresh must reset pagination');
assert.match(appScript, /function setTab[\s\S]*resetCardPage/, 'tab changes must reset pagination');

console.log('Review batching and card pagination contract tests passed.');
