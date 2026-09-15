import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const indexPath = path.join(scriptDir, '..', 'index.html');
const source = fs.readFileSync(indexPath, 'utf8');
const scripts = [...source.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((match) => match[1]);
assert.equal(scripts.length, 4, 'the single-file app keeps its four inline script blocks');
const appScript = scripts[0];
const finalScript = scripts.at(-1);
const dsaMarkupStart = source.indexOf('<section class="dsa-workspace" id="dsaPracticeWorkspace"');
const dsaMarkupEnd = source.indexOf('<section class="review-panel"', dsaMarkupStart);
const dsaDialogStart = source.indexOf('<div class="dialog hidden" id="dsaCaptureDialog"');
const dsaDialogEnd = source.indexOf('<div class="dialog hidden" id="designDialog"', dsaDialogStart);
const dsaMarkup = source.slice(dsaMarkupStart, dsaMarkupEnd) + source.slice(dsaDialogStart, dsaDialogEnd);

function includes(needle, message = needle) {
  assert.ok(source.includes(needle), `missing ${message}`);
}
function appIncludes(needle, message = needle) {
  assert.ok(appScript.includes(needle), `existing app controller missing ${message}`);
}
function scriptIncludes(needle, message = needle) {
  assert.ok(finalScript.includes(needle), `DSA controller missing ${message}`);
}
function markupIncludes(needle, message = needle) {
  assert.ok(dsaMarkup.includes(needle), `DSA markup missing ${message}`);
}

assert.ok(dsaMarkupStart >= 0 && dsaMarkupEnd > dsaMarkupStart, 'DSA workspace markup boundary missing');
assert.ok(dsaDialogStart >= 0 && dsaDialogEnd > dsaDialogStart, 'DSA dialog markup boundary missing');

for (const marker of [
  'id="dsaPracticeWorkspace"',
  'data-dsa-view="today"',
  'data-dsa-view="recall"',
  'data-dsa-view="cold"',
  'data-dsa-view="library"',
  'id="dsaDueCount"',
  'id="dsaFirstCheckCount"',
  'id="dsaNextTitle"',
  'id="dsaPracticeAge"',
  'id="dsaPracticeStatus"',
  'id="dsaDueReason"',
  'id="dsaTrapExplanation"',
  'data-dsa-start-next',
  'data-dsa-start-recall',
  'id="dsaColdApproach"',
  'id="dsaColdInvariant"',
  'id="dsaColdComplexity"',
  'id="dsaColdReflection"',
  'id="dsaColdBlocker"',
  'id="dsaColdReveal"',
  'id="dsaColdRevealPanel"',
  'id="dsaDetailReveal"',
  'id="dsaDetailRevealPanel"',
  'data-dsa-history-disclosure',
  'id="dsaHistoryPrevious"',
  'id="dsaHistoryNext"',
  'id="dsaLibraryQuery"',
  'id="dsaLibraryDifficulty"',
  'id="dsaLibraryBucket"',
  'id="dsaLibraryNext"',
]) markupIncludes(marker, marker);

for (const field of ['title', 'link', 'difficulty', 'tags', 'description', 'approach', 'reference', 'code', 'notes', 'insight', 'trap', 'outcome']) {
  markupIncludes(`data-dsa-capture="${field}"`, `atomic capture field ${field}`);
}

// Exact-card navigation never falls back to an unrelated due batch.
scriptIncludes("return '/api/practice?view=session&cardId='+encodeURIComponent(cardId)", 'selected cold session route');
scriptIncludes("dsaStartSession(dsaState.nextItem.cardId,null)", 'Today next problem selected card');
scriptIncludes("dsaStartSession(selectedCard,null)", 'library detail cold solve selected card');
scriptIncludes("window.__cjStartReview(recallCard)", 'recall detail selected card');
scriptIncludes("dsaSelectedSessionUrl(cardId)", 'cold session cardId query');
appIncludes("return '/api/practice?view=card&cardId='+encodeURIComponent(cardId)", 'prompt route');
appIncludes("return '/api/practice?view=reveal&cardId='+encodeURIComponent(cardId)", 'explicit reference reveal route');
assert.doesNotMatch(finalScript, /detailRecall[\s\S]*?legacyReview\.click\(\)/, 'recall detail must not silently start a due batch');

// Sensitive answer bodies are fetched only after the explicit reveal action.
const libraryRenderer = finalScript.slice(finalScript.indexOf('function dsaRenderLibrary'), finalScript.indexOf('function dsaLoadLibraryPage'));
const historyRenderer = finalScript.slice(finalScript.indexOf('function dsaLoadHistory'), finalScript.indexOf('function dsaOpenAttempt'));
const coldRenderer = finalScript.slice(finalScript.indexOf('function dsaRenderColdItem'), finalScript.indexOf('function dsaStartSession'));
for (const [name, renderer] of [['library', libraryRenderer], ['history', historyRenderer], ['session', coldRenderer]]) {
  assert.doesNotMatch(renderer, /\b(?:item|card|c|detail)\.(?:answer|actual_code|right_thinking|code|notes|reference)\b/, `${name} rendering must stay lightweight`);
}
scriptIncludes("dsaRenderReveal('dsaColdReveal',reveal)", 'cold reveal rendering');
scriptIncludes("dsaRenderReveal('dsaDetailReveal',reveal)", 'detail reveal rendering');
scriptIncludes('dsaState.coldRevealLoading', 'cold reveal in-flight guard');
scriptIncludes('dsaState.detailRevealLoading', 'detail reveal in-flight guard');

// Capture is atomic and preserves all entered state until a successful response.
scriptIncludes("dsaPracticeUrl('capture')", 'atomic capture endpoint');
scriptIncludes('dsaCaptureBody(values,key)', 'atomic capture payload');
for (const field of ['title', 'link', 'description', 'approach', 'reference', 'code', 'notes', 'insight', 'trap', 'tags', 'difficulty', 'outcome']) {
  scriptIncludes(`${field}:values.${field}`, `capture payload ${field}`);
}
scriptIncludes('idempotencyKey:key', 'capture idempotency key');
scriptIncludes('data.duplicate', 'explicit duplicate handling');
scriptIncludes('Your form and pending outcome remain here', 'duplicate preserves pending capture');
const captureSubmitStart = finalScript.indexOf('function dsaSubmitCapture');
const captureSubmitEnd = finalScript.indexOf('function dsaBind', captureSubmitStart);
assert.ok(captureSubmitStart >= 0 && captureSubmitEnd > captureSubmitStart, 'capture submit controller boundary missing');
const captureSubmit = finalScript.slice(captureSubmitStart, captureSubmitEnd);
const duplicateBranchStart = captureSubmit.indexOf('if(data.duplicate){');
const duplicateBranchEnd = captureSubmit.indexOf('      }\n      var next=', duplicateBranchStart);
assert.ok(duplicateBranchStart >= 0 && duplicateBranchEnd > duplicateBranchStart, 'capture duplicate success branch missing');
const duplicateBranch = captureSubmit.slice(duplicateBranchStart, duplicateBranchEnd);
assert.match(duplicateBranch, /dsaState\.capturePending\.idempotencyKey=null/, 'duplicate must clear only the consumed idempotency key');
assert.match(duplicateBranch, /if\(button\)button\.disabled=false/, 'duplicate must re-enable the Save button');
assert.doesNotMatch(duplicateBranch, /capture\.reset\(\)|dsaState\.capturePending\s*=\s*null|dsaState\.capturePending\.values\s*=\s*null/, 'duplicate must preserve the captured form and pending outcome');
assert.match(captureSubmit, /pending&&pending\.idempotencyKey\|\|\(dsaState\.capturePending=\{idempotencyKey:'dsa-capture-/, 'retry must generate a fresh idempotency key');
scriptIncludes('Nothing was discarded.', 'save failure preserves form');
scriptIncludes('No independent solve recorded', 'no-outcome copy');
scriptIncludes('30 local calendar days with no immediate repeat', 'independent outcome copy');
scriptIncludes('retry in 3 local calendar days', 'retry outcome copy');
scriptIncludes('dsaClearStaleDrafts()', 'successful save draft cleanup');

// Forced summary refreshes queue behind an existing request instead of overlapping it.
const summaryStart = finalScript.indexOf('function dsaLoadSummary');
const summaryEnd = finalScript.indexOf('function dsaLoadTimezoneStatus', summaryStart);
assert.ok(summaryStart >= 0 && summaryEnd > summaryStart, 'summary loader boundary missing');
const summaryLoader = finalScript.slice(summaryStart, summaryEnd);
const summaryInFlightStart = summaryLoader.indexOf('if(dsaState.summaryLoading&&dsaState.summaryPromise)');
const summaryRequestStart = summaryLoader.indexOf('var generation=', summaryInFlightStart);
assert.ok(summaryInFlightStart >= 0 && summaryRequestStart > summaryInFlightStart, 'summary in-flight guard boundary missing');
const summaryInFlightGuard = summaryLoader.slice(summaryInFlightStart, summaryRequestStart);
assert.match(summaryInFlightGuard, /if\(!force\)return dsaState\.summaryPromise;/, 'non-forced summary loads must reuse the in-flight promise');
assert.match(summaryInFlightGuard, /var queuedGeneration=dsaGeneration;/, 'queued summary refresh must capture its generation');
assert.match(summaryInFlightGuard, /return dsaState\.summaryPromise\.then\(function\(\)\{[\s\S]*?if\(!dsaCurrent\(queuedGeneration\)\)return null;[\s\S]*?return dsaLoadSummary\(true\);/, 'forced summary loads must refresh after the current request completes with generation guards');
assert.doesNotMatch(summaryInFlightGuard, /if\(!force&&dsaState\.summaryLoading/, 'force must not bypass the in-flight promise guard');
assert.match(summaryLoader, /dsaCurrent\(generation\)/, 'summary response must retain generation/account checks');
assert.match(summaryLoader, /dsaState\.summaryRequest/, 'summary response must retain request ordering checks');
assert.match(summaryLoader, /finally\(function\(\)\{if\(dsaCurrent\(generation\)\)\{dsaState\.summaryLoading=false;dsaState\.summaryPromise=null\}\}\)/, 'summary loader must clear in-flight state only for the current generation');
assert.doesNotMatch(source, /dsaSaveLocalDraft|dsa-practice-draft-|data-dsa-capture[^\n]*(?:localStorage|sessionStorage)/, 'capture must not write a pre-card browser draft');

// Account isolation resets state, requests, dialogs, rendered data, and DSA storage.
appIncludes('window.__dsaPracticeAuthChanged', 'auth transition bridge');
appIncludes('authIdentity!==identity', 'legacy account-switch identity boundary');
appIncludes('apiCache={}', 'legacy private cache reset');
scriptIncludes('dsaAbortRequests()', 'abort controllers on reset');
scriptIncludes('dsaClearDsaStorage()', 'DSA local-storage reset');
scriptIncludes('dsaResetState(\'signed-out\')', 'signed-out reset');
scriptIncludes('dsaResetState(\'account-switch\')', 'account-switch reset');
scriptIncludes('dsaResetTransientForWorkspace()', 'workspace dialog/reset path');
scriptIncludes('dsaCloseAllDialogs()', 'dialog reset');

// No bootstrap download-all: legacy views use bounded server pages and cursors.
appIncludes("url='/api/cards?summary=1&limit='+CARD_PAGE_SIZE", 'Cards page size 10');
appIncludes("return '/api/cards/due?summary=1&limit=5'", 'Due page size 5');
appIncludes("encodeURIComponent(cursor)", 'legacy cursor continuation');
appIncludes("url+='&q='+encodeURIComponent(query)", 'server query filter');
appIncludes("url+='&difficulty='+encodeURIComponent(difficulty)", 'server difficulty filter');
appIncludes("return '/api/cards/due?summary=1&limit=5'", 'server due summaries');
appIncludes("url='/api/cards?summary=1&limit='+CARD_PAGE_SIZE", 'server card summaries');
assert.doesNotMatch(source, /\/api\/cards\?summary=1(?:['"`]|\s|$)/, 'no unbounded summary bootstrap');
assert.doesNotMatch(source, /excludeIds|exclude=|\bOFFSET\b/, 'no client exclusion or offset pagination');
assert.doesNotMatch(appScript.slice(appScript.indexOf('function renderCards'), appScript.indexOf('function loadCardPage')), /\.slice\(/, 'legacy renderer must not client-slice a downloaded collection');
appIncludes("'/api/cards/'+encodeURIComponent(cardId)+'?review=1&response=summary", 'legacy Recall rating route');
appIncludes('solvedFromScratch:$(\'solvedFromScratch\').checked', 'legacy solved-from-scratch payload');
scriptIncludes('dsaLoadLibraryPage(page.nextCursor,false)', 'explicit library cursor continuation');
assert.doesNotMatch(finalScript, /dsaLoadLibraryPage\([^)]*false\)[\s\S]*?dsaLoadLibraryPage\([^)]*false\)/, 'library must not automatically prefetch another page');

// History is cursor-aware and attempt bodies are on demand.
scriptIncludes("dsaPracticeUrl('history',params)", 'history cursor route');
scriptIncludes('params.cursor=cursor', 'history cursor parameter');
scriptIncludes('page.hasMore', 'history continuation state');
scriptIncludes("dsaPracticeUrl('attempt',{attemptId:attemptId})", 'attempt detail route');
scriptIncludes('History page '+"'+(dsaState.detailHistoryPage+1)", 'history page status');

// Time-zone formatting uses only the persisted IANA zone and exposes an unknown state.
scriptIncludes('dsaPracticeTimeZone()', 'persisted timezone helper');
scriptIncludes("timeZone:zone", 'timezone payload');
scriptIncludes('date unknown — Set time zone', 'unknown timezone state');
const timezoneFormatter = finalScript.slice(finalScript.indexOf('function dsaFormatDate'), finalScript.indexOf('function dsaLocalDateKey'));
assert.match(timezoneFormatter, /timeZone:zone/);
assert.match(timezoneFormatter, /toLocale(?:DateString|String)\([^)]*timeZone:zone/);

// Accessibility and responsive guarantees.
for (const marker of [
  'aria-live="polite"',
  'role="tablist"',
  'role="status"',
  'role="alert"',
  'aria-pressed="false"',
  'aria-selected="true"',
  'data-dsa-mobile',
]) includes(marker, `accessibility/mobile marker ${marker}`);
scriptIncludes("setAttribute('aria-pressed'", 'self-report pressed state');
scriptIncludes("setAttribute('aria-selected'", 'view selected state');
scriptIncludes('focus()', 'keyboard focus management');
assert.match(source, /@media\(max-width:760px\)[\s\S]*?dsa-/);
assert.match(source, /@media\(max-width:430px\)[\s\S]*?dsa-/);
assert.match(source, /@media\(max-width:390px\)[\s\S]*?dsa-/);
assert.match(source, /\.dsa-[^}]*min-height:44px/);
assert.doesNotMatch(dsaMarkup + finalScript, /transition\s*:\s*all/i, 'DSA UI must not use transition:all');

// The existing Recall and LLD/HLD surfaces remain present, with no duplicate generic overrides.
for (const marker of [
  'id="reviewDialog"',
  'id="solvedFromScratch"',
  'data-rating="again"',
  'data-rating="hard"',
  'data-rating="good"',
  'data-rating="easy"',
  '/api/cards/due',
  'review=1',
  'id="lldWorkspace"',
  'id="lldDialog"',
  'id="lldSimulatorDialog"',
  'data-lld-view',
  'function setTab',
  'function setWorkspace',
]) includes(marker, `untouched legacy marker ${marker}`);
assert.equal((source.match(/function renderTab|function switchTab/g) || []).length, 0, 'DSA addition must not add generic renderTab/switchTab overrides');
assert.equal((source.match(/function dsaSetView/g) || []).length, 1, 'one DSA view renderer is defined');
assert.equal((source.match(/function dsaRenderLibrary/g) || []).length, 1, 'one DSA library renderer is defined');
assert.ok(!dsaMarkup.includes('onclick='), 'DSA markup must use delegated/data listeners, not inline onclick');

// Basic structural check catches the known unmatched section regression.
assert.equal((source.match(/<section\b/g) || []).length, (source.match(/<\/section>/g) || []).length, 'section markup is balanced');
assert.equal((source.match(/<div\b/g) || []).length, (source.match(/<\/div>/g) || []).length, 'div markup is balanced');

console.log('DSA practice UI source contract: PASS');
