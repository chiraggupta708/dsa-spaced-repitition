import assert from 'node:assert/strict';
import fs from 'node:fs';
import { sendConditionalJSON } from '../lib/api.js';

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), 'utf8');
const dbSource = read('../lib/db.js');
const apiSource = read('../lib/api.js');
const cardsSource = read('../api/cards.js');
const dueSource = read('../api/cards/due.js');
const cardDetailSource = read('../api/cards/[...cardId].js');
const statsSource = read('../api/stats.js');
const htmlSource = read('../index.html');

assert.match(dbSource, /export async function loadCardSummaries\s*\(/,
  'db layer must expose an owner-scoped compact card loader');
assert.match(dbSource, /function rowToCardSummary\s*\(/,
  'db layer must convert summary rows without the full card body');
const summaryMapper = dbSource.slice(
  dbSource.indexOf('function rowToCardSummary'),
  dbSource.indexOf('/** Load cards belonging only to ownerId. */')
);
assert.doesNotMatch(summaryMapper, /\b(answer|actual_code|my_thinking|right_thinking|notes|questionDescription)\s*:/,
  'summary DTO must not include large answer/body fields');

assert.match(cardsSource, /loadCardSummaries/,
  'collection endpoint must be able to serve compact card summaries');
assert.match(cardsSource, /summary/,
  'collection endpoint must expose an explicit summary selector');
assert.match(dueSource, /loadCardSummaries/,
  'due endpoint must support the same compact representation');
assert.match(dbSource, /export async function getCard\s*\(/,
  'db layer must expose an owner-scoped single-card loader');
assert.match(cardDetailSource, /getCard/,
  'single-card routes must use the targeted card loader');
assert.doesNotMatch(cardDetailSource, /await load\(userId\)/,
  'single-card routes must not load the entire card collection');
assert.match(statsSource, /loadCardSummaries/,
  'stats must avoid transferring full answer/code bodies from the database');
assert.match(apiSource, /export function sendConditionalJSON\s*\(/,
  'API must expose conditional private JSON responses');
assert.match(apiSource, /Cache-Control', 'private, no-cache'/,
  'conditional responses must remain private and revalidate each time');
assert.match(apiSource, /ETag/,
  'conditional responses must carry an ETag');
assert.match(apiSource, /status\(304\)/,
  'conditional responses must support 304 Not Modified');
assert.match(cardsSource, /sendConditionalJSON/,
  'summary collection reads must use conditional responses');

assert.match(cardsSource, /response.*summary/,
  'collection writes must support a compact response mode');
assert.match(cardDetailSource, /response.*summary/,
  'single-card writes must support a compact response mode');
assert.match(htmlSource, /response=summary/,
  'frontend writes must opt into compact responses');

assert.match(htmlSource, /If-None-Match/,
  'frontend GETs must send the cached ETag for revalidation');
assert.match(htmlSource, /status===304/,
  'frontend must reuse the cached response body on 304');
assert.match(htmlSource, /apiCache/,
  'frontend must keep a private in-memory cache for conditional responses');
assert.match(htmlSource, /apiCache=\{\}/,
  'frontend must clear cached private responses on sign-out');

function mockResponse() {
  return {
    headers: {},
    statusCode: null,
    body: null,
    ended: false,
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    send(body) { this.body = body; return this; },
    end() { this.ended = true; return this; },
  };
}

const first = mockResponse();
sendConditionalJSON({ headers: {} }, first, 200, { ok: true, cards: [] });
assert.equal(first.statusCode, 200);
assert.equal(first.headers['Cache-Control'], 'private, no-cache');
assert.equal(first.headers.Vary, 'Authorization');
assert.match(first.headers.ETag, /^"[A-Za-z0-9_-]+"$/);
assert.ok(first.body);

const second = mockResponse();
sendConditionalJSON({ headers: { 'if-none-match': first.headers.ETag } }, second, 200, { ok: true, cards: [] });
assert.equal(second.statusCode, 304);
assert.equal(second.ended, true);
assert.equal(second.body, null);

const appScript = [...htmlSource.matchAll(/<script>([\s\S]*?)<\/script>/g)]
  .map((match) => match[1])
  .at(0);
assert.ok(appScript, 'the primary application script must be discoverable');
assert.match(appScript, /REVIEW_BATCH_SIZE\s*=\s*5,CARD_PAGE_SIZE\s*=\s*10/,
  'card pages must remain bounded to ten summaries');

const cardPageStart = appScript.indexOf('function cardPageUrl(');
const cardPageEnd = appScript.indexOf('function updateCardPagination', cardPageStart);
assert.ok(cardPageStart >= 0 && cardPageEnd > cardPageStart, 'card page URL builder must remain discoverable');
const cardPageSource = appScript.slice(cardPageStart, cardPageEnd);
assert.match(cardPageSource, /\/api\/cards\?summary=1&limit='\+CARD_PAGE_SIZE/,
  'card pages must request compact summaries with the ten-card limit');
assert.match(cardPageSource, /if\(cursor\)[\s\S]*?&cursor=.*encodeURIComponent\(cursor\)/,
  'card pages must pass the server cursor');

const loadCardStart = appScript.indexOf('function loadCardPage(');
const loadCardEnd = appScript.indexOf('function renderDesigns', loadCardStart);
assert.ok(loadCardStart >= 0 && loadCardEnd > loadCardStart, 'card page loader must remain discoverable');
const loadCardSource = appScript.slice(loadCardStart, loadCardEnd);
assert.match(loadCardSource, /api\(cardPageUrl\(cursor\)\)/,
  'card loading must delegate URL construction to the bounded summary page path');
assert.match(loadCardSource, /data\.nextCursor/,
  'card loading must retain the server continuation cursor');
assert.match(loadCardSource, /data\.hasMore/,
  'card loading must retain server continuation metadata');

const refreshStart = appScript.indexOf('function refresh(');
const refreshEnd = appScript.indexOf('function closeDialogs', refreshStart);
assert.ok(refreshStart >= 0 && refreshEnd > refreshStart, 'refresh function must remain discoverable');
const refreshSource = appScript.slice(refreshStart, refreshEnd);
assert.match(refreshSource, /loadCardPage\(null,true,1\)/,
  'refresh must delegate to the bounded server summary page loader');
assert.doesNotMatch(refreshSource, /\/api\/cards(?:\/due)?\?/,
  'refresh must not contain the removed direct card request');
assert.doesNotMatch(refreshSource, /Promise\.all/,
  'refresh must not issue duplicate card collection requests');

assert.match(htmlSource, /\/api\/cards\/due/,
  'review flow must retain a lazy full due-card request');
assert.match(cardPageSource, /url\+='&q='\+encodeURIComponent\(query\)/,
  'full-text search must use server-side filtering with compact results');

console.log('Card transfer contract tests passed.');
