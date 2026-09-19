import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(scriptDir, '..', 'index.html'), 'utf8');
const ids = [...source.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
const idCounts = new Map();
for (const id of ids) idCounts.set(id, (idCounts.get(id) || 0) + 1);
assert.deepEqual([...idCounts].filter(([, count]) => count > 1), [], 'HTML ids must be unique');

function blocks(tag) {
  const open = `<${tag}>`;
  const close = `</${tag}>`;
  const result = [];
  let cursor = 0;
  while (true) {
    const start = source.indexOf(open, cursor);
    if (start < 0) return result;
    const bodyStart = start + open.length;
    const end = source.indexOf(close, bodyStart);
    assert.ok(end >= 0, `${tag} block must close`);
    result.push(source.slice(bodyStart, end));
    cursor = end + close.length;
  }
}

function includes(haystack, needle, message = needle) {
  assert.ok(haystack.includes(needle), `missing ${message}`);
}
function excludes(haystack, needle, message = needle) {
  assert.ok(!haystack.includes(needle), `unexpected ${message}`);
}

const scripts = blocks('script');
assert.equal(scripts.length, 4, 'the single-file app keeps its four inline script blocks');
for (const [index, script] of scripts.entries()) {
  assert.doesNotThrow(() => new Function(script), `inline script ${index + 1} must parse`);
}
const appScript = scripts[0];
const finalScript = scripts.at(-1);
const dsaMarkupStart = source.indexOf('<section class="dsa-workspace dsa-approved-workspace hidden"');
const dsaMarkupEnd = source.indexOf('<div class="dialog hidden" id="designDialog"', dsaMarkupStart);
assert.ok(dsaMarkupStart >= 0 && dsaMarkupEnd > dsaMarkupStart, 'approved DSA markup boundary missing');
const dsaMarkup = source.slice(dsaMarkupStart, dsaMarkupEnd);
includes(source, 'id="dsaSidebarNav"', 'DSA sidebar navigation');

for (const marker of [
  'id="dsaPracticeWorkspace"',
  'id="dsaMobileNav"',
  'data-dsa-nav="today"',
  'data-dsa-nav="cold"',
  'data-dsa-nav="library"',
  'id="dsaTodayRecallList"',
  'id="dsaTodayColdList"',
  'id="dsaColdScheduledList"',
  'id="dsaColdFirstList"',
  'id="dsaLibraryList"',
  'id="dsaTodayRecallPager"',
  'id="dsaColdScheduledPager"',
  'id="dsaLibraryPager"',
  'id="dsaRecallCount"',
  'id="dsaColdCount"',
  'id="dsaLibraryCount"',
  'id="dsaColdDialog"',
  'id="dsaColdDialogPrompt"',
  'id="dsaColdDialogRevealBox"',
  'id="dsaColdDialogReflection"',
  'id="dsaColdDialogApproachReveal"',
  'id="dsaColdDialogReferenceReveal"',
  'id="dsaColdDialogCodeReveal"',
  'id="dsaColdDialogInsightReveal"',
  'id="dsaColdDialogTrapReveal"',
  'id="dsaColdDialogNotesReveal"',
  'id="dsaColdDialogSave"',
  'id="dsaCaptureDialog"',
  'id="dsaTimezoneDialog"',
  'id="dsaCardDetailDialog"',
  'id="dsaCardDetailBody"',
  'id="dsaDetailReveal"',
  'id="dsaDetailRevealPanel"',
  'id="dsaHistoryList"',
  'id="dsaAttemptDetail"',
  'id="dsaDetectedTimezone"',
  'id="dsaTimezoneSave"',
  'data-dsa-history-disclosure',
  'id="dsaHistoryPrevious"',
  'id="dsaHistoryNext"',
  'id="dsaLibraryQuery"',
  'id="dsaLibraryDifficulty"',
  'id="dsaLibraryBucket"',
]) includes(dsaMarkup, marker, `approved DSA markup ${marker}`);
excludes(dsaMarkup, 'data-dsa-view=', 'duplicate upper DSA tab surface');

for (const field of ['title', 'link', 'difficulty', 'tags', 'description', 'approach', 'reference', 'code', 'notes', 'insight', 'trap', 'outcome']) {
  includes(dsaMarkup, `data-dsa-capture="${field}"`, `atomic capture field ${field}`);
}

// Today uses the bounded legacy recall endpoint; cold solve uses two bounded practice buckets.
includes(finalScript, "return '/api/cards/due?summary=1&limit='+RECALL_LIMIT", 'bounded recall queue');
includes(finalScript, "dsaPracticeUrl('queue',{bucket:'due',limit:RECALL_LIMIT", 'Today cold queue');
includes(finalScript, "dsaPracticeUrl('queue',{bucket:'first-check',limit:QUEUE_LIMIT", 'first-check queue');
includes(finalScript, "dsaPracticeUrl('session',{cardId:String(cardId),limit:1})", 'selected cold session route');
includes(finalScript, "dsaPracticeUrl('card',{cardId:String(cardId)})", 'selected prompt route');
includes(finalScript, "dsaPracticeUrl('attempt',{cardId:flow.item.cardId})", 'selected cold attempt route');
includes(finalScript, 'window.__cjStartReview(review.dataset.dsaReview)', 'selected recall row action');
includes(finalScript, 'window.__cjOpenCard(edit.dataset.dsaEditCard)', 'selected library edit action');
includes(appScript, "return '/api/practice?view=card&cardId='+encodeURIComponent(cardId)", 'legacy recall prompt route');
includes(appScript, "return '/api/practice?view=reveal&cardId='+encodeURIComponent(cardId)", 'legacy recall reveal route');
includes(appScript, "'/api/cards/'+encodeURIComponent(cardId)+'?review=1&response=summary", 'legacy recall rating route');
includes(appScript, 'window.__cjOpenCard=openCard', 'library edit bridge');
includes(appScript, 'solvedFromScratch:false', 'recall/cold cadence separation payload');

// The all-problems library uses the existing bounded card-summary endpoint; no invalid queue bucket is sent.
includes(finalScript, "params.set('summary','1')", 'all-problem summary request');
includes(finalScript, "return '/api/cards?'+params.toString()", 'all-problem library endpoint');
includes(finalScript, "if(bucket==='scheduled')bucket='due'", 'scheduled library filter mapping');
excludes(finalScript, "bucket:'all'", 'invalid all queue bucket');
includes(finalScript, "dsaLoadPaged(key,dsaLibraryUrl(page.nextCursor),false)", 'explicit library cursor continuation');

// Prompt/list renderers stay lightweight. Sensitive bodies are fetched only after the attempt is saved.
const queueRendererStart = finalScript.indexOf('function dsaQueueRow');
const queueRendererEnd = finalScript.indexOf('function dsaRenderPaged', queueRendererStart);
assert.ok(queueRendererStart >= 0 && queueRendererEnd > queueRendererStart, 'queue renderer boundary missing');
const queueRenderer = finalScript.slice(queueRendererStart, queueRendererEnd);
for (const field of ['answer', 'actual_code', 'right_thinking', 'reference', 'notes', 'code']) excludes(queueRenderer, `item.${field}`, `queue body field ${field}`);
includes(finalScript, "dsaRequest(dsaPracticeUrl('reveal',{cardId:flow.item.cardId})", 'cold reveal request');
includes(finalScript, "dsaRequest(dsaPracticeUrl('reveal',{cardId:cardId})", 'detail reveal request');
includes(finalScript, 'dsaRenderColdReveal(flow.reveal)', 'cold reveal body rendering');
includes(finalScript, "dsaRenderReveal('dsaDetailReveal',data.reveal||{})", 'detail reveal body rendering');
includes(finalScript, 'flow.revealLoading', 'cold reveal in-flight guard');
includes(finalScript, 'dsaState.detailRevealLoading', 'detail reveal in-flight guard');

// Capture is atomic, idempotent, and preserves entered fields on duplicate/error.
includes(finalScript, "dsaPracticeUrl('capture')", 'atomic capture endpoint');
includes(finalScript, 'dsaCaptureBody(values,key)', 'atomic capture payload');
for (const field of ['title', 'link', 'description', 'approach', 'reference', 'code', 'notes', 'insight', 'trap', 'tags', 'difficulty', 'outcome']) {
  includes(finalScript, `${field}:values.${field}`, `capture payload ${field}`);
}
includes(finalScript, 'idempotencyKey:key', 'capture idempotency key');
includes(finalScript, 'data.duplicate', 'explicit duplicate handling');
includes(finalScript, 'Your fields and pending outcome remain here', 'duplicate preserves pending capture');
includes(finalScript, 'pending&&pending.idempotencyKey||(dsaState.capturePending={idempotencyKey:', 'retry gets an idempotency key');
const captureSubmitStart = finalScript.indexOf('function dsaSubmitCapture');
const captureSubmitEnd = finalScript.indexOf('function dsaExport', captureSubmitStart);
assert.ok(captureSubmitStart >= 0 && captureSubmitEnd > captureSubmitStart, 'capture submit controller boundary missing');
const captureSubmit = finalScript.slice(captureSubmitStart, captureSubmitEnd);
const duplicateBranchStart = captureSubmit.indexOf('if(data.duplicate){');
const duplicateBranchEnd = captureSubmit.indexOf('var outcome=', duplicateBranchStart);
assert.ok(duplicateBranchStart >= 0 && duplicateBranchEnd > duplicateBranchStart, 'capture duplicate success branch missing');
const duplicateBranch = captureSubmit.slice(duplicateBranchStart, duplicateBranchEnd);
assert.match(duplicateBranch, /dsaState\.capturePending\.idempotencyKey=null/, 'duplicate must clear only the consumed idempotency key');
assert.match(duplicateBranch, /if\(button\)button\.disabled=false/, 'duplicate must re-enable the Save button');
assert.doesNotMatch(duplicateBranch, /capture\.reset\(\)|dsaState\.capturePending\s*=\s*null|dsaState\.capturePending\.values\s*=\s*null/, 'duplicate must preserve the captured form and pending outcome');
assert.match(captureSubmit, /pending&&pending\.idempotencyKey\|\|\(dsaState\.capturePending=\{idempotencyKey:'dsa-capture-/, 'retry must generate a fresh idempotency key');
includes(finalScript, 'Nothing was discarded.', 'save failure preserves form');
includes(finalScript, 'No outcome is recorded', 'no-outcome copy');
includes(finalScript, 'Solved: schedule Independent Solve again in 30 days.', 'independent outcome copy');
includes(finalScript, 'retry in 3 days.', 'retry outcome copy');
includes(finalScript, 'dsaClearStaleDrafts()', 'successful save draft cleanup');

// Cold outcomes are server-owned and display the returned schedule; no client prediction is saved.
includes(finalScript, 'flow.outcome', 'cold outcome selection');
includes(finalScript, 'data.attempt&&data.attempt.nextPracticeAt', 'server-confirmed schedule');
includes(finalScript, 'data.practice&&data.practice.nextPracticeAt', 'server-confirmed practice fallback');
includes(finalScript, 'dsaLoadSummary(true);dsaLoadRecall(true);dsaLoadTodayCold(true)', 'post-attempt refresh');

// Summary/request ordering and account boundaries remain guarded.
const summaryStart = finalScript.indexOf('function dsaLoadSummary');
const summaryEnd = finalScript.indexOf('function dsaLoadTimezoneStatus', summaryStart);
assert.ok(summaryStart >= 0 && summaryEnd > summaryStart, 'summary loader boundary missing');
const summaryLoader = finalScript.slice(summaryStart, summaryEnd);
includes(summaryLoader, 'if(dsaState.summaryLoading&&dsaState.summaryPromise)', 'summary in-flight guard');
const summaryInFlightStart = summaryLoader.indexOf('if(dsaState.summaryLoading&&dsaState.summaryPromise)');
const summaryRequestStart = summaryLoader.indexOf('var generation=', summaryInFlightStart);
assert.ok(summaryInFlightStart >= 0 && summaryRequestStart > summaryInFlightStart, 'summary in-flight guard boundary missing');
const summaryInFlightGuard = summaryLoader.slice(summaryInFlightStart, summaryRequestStart);
assert.match(summaryInFlightGuard, /if\(!force\)return dsaState\.summaryPromise;/, 'non-forced summary loads must reuse the in-flight promise');
assert.match(summaryInFlightGuard, /var queuedGeneration=dsaGeneration;/, 'queued summary refresh must capture its generation');
assert.match(summaryInFlightGuard, /return dsaState\.summaryPromise\.then\(function\(\)\{[\s\S]*?if\(!dsaCurrent\(queuedGeneration\)\)return null;[\s\S]*?return dsaLoadSummary\(true\)\s*;?\s*\}/, 'forced summary loads must refresh after the current request completes with generation guards');
assert.doesNotMatch(summaryInFlightGuard, /if\(!force&&dsaState\.summaryLoading/, 'force must not bypass the in-flight promise guard');
includes(summaryLoader, 'dsaCurrent(generation)', 'summary generation check');
includes(summaryLoader, 'dsaState.summaryRequest', 'summary request ordering');
assert.match(summaryLoader, /finally\(function\(\)\{if\(dsaCurrent\(generation\)\)\{dsaState\.summaryLoading=false;dsaState\.summaryPromise=null\}\}\)/, 'summary loader must clear in-flight state only for the current generation');
assert.doesNotMatch(source, /dsaSaveLocalDraft|dsa-practice-draft-|data-dsa-capture[^\n]*(?:localStorage|sessionStorage)/, 'capture must not write a pre-card browser draft');
includes(appScript, 'window.__dsaPracticeAuthChanged', 'auth transition bridge');
includes(appScript, 'authIdentity!==identity', 'legacy account-switch boundary');
includes(appScript, 'apiCache={}', 'legacy private cache reset');
includes(finalScript, 'dsaAbortRequests()', 'abort controllers on reset');
includes(finalScript, 'dsaClearDsaStorage()', 'DSA storage reset');
includes(finalScript, "dsaResetState('signed-out')", 'signed-out reset');
includes(finalScript, "dsaResetState('account-switch')", 'account-switch reset');
includes(finalScript, 'dsaCloseAllDsaDialogs()', 'dialog reset');

// All private list reads stay bounded and cursor-based.
includes(appScript, "url='/api/cards?summary=1&limit='+CARD_PAGE_SIZE", 'bounded card page size');
includes(appScript, "return '/api/cards/due?summary=1&limit=5'", 'bounded due page size');
includes(appScript, 'encodeURIComponent(cursor)', 'legacy cursor continuation');
includes(appScript, "url+='&q='+encodeURIComponent(query)", 'server query filter');
includes(appScript, "url+='&difficulty='+encodeURIComponent(difficulty)", 'server difficulty filter');
excludes(source, "'/api/cards?summary=1'", 'unbounded card summary bootstrap');
excludes(source, 'excludeIds', 'client exclusion pagination');
excludes(source, 'OFFSET', 'offset pagination');
includes(appScript, 'if(dsaPracticeVisible()&&typeof window.__dsaPracticeRefresh===\'function\')', 'DSA refresh delegation');

// History, detail, timezone, loading/error/empty, and navigation remain progressive.
includes(finalScript, "dsaPracticeUrl('history',{cardId:cardId,limit:10", 'history cursor route');
includes(finalScript, 'page.hasMore', 'history continuation state');
includes(finalScript, "dsaPracticeUrl('attempt',{attemptId:attemptId})", 'attempt detail route');
includes(finalScript, 'History page '+"'+(state.page+1)", 'history page status');
includes(finalScript, 'date unknown — Set time zone', 'unknown timezone state');
includes(finalScript, 'dsaPracticeTimeZone()', 'persisted timezone helper');
includes(finalScript, 'timeZone:zone', 'timezone payload');
includes(finalScript, 'toLocaleDateString(\'en-US\',{timeZone:zone', 'persisted timezone formatter');
includes(finalScript, 'dsaLoadingHtml', 'loading state');
includes(finalScript, 'dsaErrorHtml', 'error state');
includes(finalScript, 'dsaEmptyHtml', 'empty state');
includes(finalScript, 'data-dsa-retry', 'retry affordance');
includes(finalScript, 'focus()', 'focus management');

// DSA surface isolation preserves the old review/card/LLD flows and both workspace switches.
for (const marker of [
  'data-dsa-legacy-shell="true"',
  'id="workspaceNavLabel"',
  'id="mobileNav"',
  'id="reviewDialog"',
  'data-rating="again"',
  'data-rating="hard"',
  'data-rating="good"',
  'data-rating="easy"',
  'id="lldWorkspace"',
  'id="lldDialog"',
  'id="lldSimulatorDialog"',
  'data-lld-view',
  'function setTab',
  'function setWorkspace',
]) includes(source, marker, `preserved legacy marker ${marker}`);
const dsaSurfaceStart = finalScript.indexOf('function dsaActivateSurface');
const dsaSurfaceEnd = finalScript.indexOf('function dsaOpenTimezone', dsaSurfaceStart);
assert.ok(dsaSurfaceStart >= 0 && dsaSurfaceEnd > dsaSurfaceStart, 'DSA surface controller boundary missing');
const dsaSurface = finalScript.slice(dsaSurfaceStart, dsaSurfaceEnd);
includes(finalScript, 'function dsaSetLegacyVisibility', 'legacy content visibility owner');
includes(dsaSurface, 'dsaSetLegacyVisibility(false)', 'legacy content isolation');
includes(dsaSurface, 'dsaSetLegacyVisibility(true)', 'legacy content restoration');
includes(dsaSurface, "data-dsa-legacy-shell],[data-dsa-legacy-nav=\"true\"", 'legacy shell/nav isolation');
includes(dsaSurface, "dsa$('mobileNav')", 'legacy mobile isolation');
includes(finalScript, "dsaActivateSurface(active,true)", 'workspace switch wiring');
includes(finalScript, "button.dataset.workspaceNav==='lld'", 'LLD nav deactivation');
includes(finalScript, "button.dataset.workspaceNav==='dsa'", 'DSA nav activation');

// Accessibility and responsive guarantees are source-level contracts; real viewport checks run separately.
for (const marker of ['aria-live="polite"', 'role="status"', 'role="alert"', 'aria-pressed="false"', 'data-dsa-mobile']) {
  includes(source, marker, `accessibility marker ${marker}`);
}
includes(finalScript, "setAttribute('aria-pressed'", 'pressed-state sync');
includes(finalScript, "setAttribute('aria-current'", 'current-page sync');
includes(source, '@media (max-width: 760px)', 'mobile layout breakpoint');
includes(source, '@media (max-width: 430px)', 'small mobile layout breakpoint');
includes(source, '@media (max-width: 390px)', 'narrow mobile layout breakpoint');
includes(source, 'min-height: 44px', 'touch target minimum');
excludes(dsaMarkup + finalScript, 'transition:all', 'transition-all layout risk');

assert.equal(source.split('function dsaSetView').length - 1, 1, 'one DSA view controller is defined');
assert.equal(source.split('function dsaQueueRow').length - 1, 1, 'one DSA queue renderer is defined');
assert.equal(source.split('function dsaResetDom').length - 1, 0, 'prototype DSA controller was replaced');
assert.equal(source.split('function dsaLoadLibraryPage').length - 1, 0, 'first-check-only library controller was replaced');
assert.equal((source.match(/<section/g) || []).length, (source.match(/<\/section>/g) || []).length, 'section markup is balanced');
assert.equal(source.split('<div').length - 1, source.split('</div>').length - 1, 'div markup is balanced');
assert.equal((dsaMarkup.match(/onclick=/g) || []).length, 0, 'approved DSA markup uses delegated/data listeners');

console.log('DSA practice UI source contract: PASS');
