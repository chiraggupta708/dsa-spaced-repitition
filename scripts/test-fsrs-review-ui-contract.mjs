import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const html = readFileSync(resolve(process.cwd(), 'index.html'), 'utf8');
const match = (pattern, message) => assert.match(html, pattern, message);
const absent = (pattern, message) => assert.doesNotMatch(html, pattern, message);
const between = (start, end) => {
  const from = html.indexOf(start);
  const to = html.indexOf(end, from);
  assert.ok(from >= 0 && to > from, `Expected source block from ${start} to ${end}`);
  return html.slice(from, to);
};

const ratingButtons = [...html.matchAll(/<button\b[^>]*\bclass="rating"[^>]*\bdata-rating="([^"]+)"[^>]*>([\s\S]*?)<\/button>/g)];
assert.equal(ratingButtons.length, 4, 'Review UI has exactly four semantic rating buttons');
assert.deepEqual(ratingButtons.map((button) => button[1]), ['again', 'hard', 'good', 'easy'], 'Rating data values are semantic and ordered');
assert.deepEqual(ratingButtons.map((button) => button[2].replace(/<[^>]+>/g, '').trim()), ['Again', 'Hard', 'Good', 'Easy'], 'Rating labels are exact and visible');
absent(/data-rating="[1-5]"/, 'Legacy numeric rating values are removed');
absent(/choose 1(?:–|-|to)5|rate this card[^<]{0,80}1(?:–|-|to)5/i, 'Legacy numeric review wording is removed');

match(/<label class="practice-credit"[^>]*for="solvedFromScratch"/, 'Solved-from-scratch uses a dedicated practice-credit card');
match(/<label class="practice-credit"[\s\S]*?id="solvedFromScratch"[^>]*type="checkbox"[^>]*aria-describedby="solvedFromScratchHelp"[\s\S]*?<span class="practice-credit-frame">/, 'Practice-credit card keeps the accessible checkbox inside its visual frame');
match(/class="practice-credit-check"[^>]*aria-hidden="true"/, 'Practice-credit card has a presentational selected-state check');
match(/class="practice-credit-copy"[\s\S]*?<strong>Solved from scratch<\/strong>/, 'Practice-credit card has a clear primary label');
match(/id="solvedFromScratchHelp"[^>]*>[\s\S]*30-day practice checkpoint[\s\S]*recall rating stays separate/i, 'Solved control explains its separate reminder-only effect');
match(/class="practice-credit-badge"[^>]*aria-hidden="true">30d/, 'Practice-credit card exposes the 30-day cadence at a glance');
match(/\.practice-credit-frame\{[\s\S]*?min-height:(?:4[4-9]|[5-9]\d)px/, 'Practice-credit card has a touch-safe minimum hit area');
match(/\.practice-credit input:checked\+\.practice-credit-frame\{/, 'Practice-credit card has a selected visual state');
match(/\.practice-credit input:focus-visible\+\.practice-credit-frame\{/, 'Practice-credit card has a visible keyboard focus state');

const dialog = between('<div class="dialog hidden" id="reviewDialog"', '<script');
const revealedMarkup = between('<div id="revealed"', '</div></div></div><footer class="review-foot">');
assert.ok(dialog.indexOf('id="reviewPromptText"') < dialog.indexOf('id="revealed"'), 'Question prompt occurs before revealed content');
absent(/id="revealDescription"/, 'Question description is not rendered a second time after Reveal');
absent(/questionDescription[^\n]{0,160}revealDescription|revealDescription[^\n]{0,160}questionDescription/, 'Reveal code does not render questionDescription');
const revealFn = html.match(/function reveal\(\)\{([\s\S]*?)\}\s*async function continueReview/);
assert.ok(revealFn, 'Reveal handler is present');
assert.ok(revealFn[1].includes("$('reviewPromptText').classList.add('hidden')") && revealFn[1].includes("$('reviewLinkWrap').classList.add('hidden')") && revealFn[1].includes("$('revealNotes').classList.add('hidden')"), 'Reveal hides prompt, link, and reveal control');
const renderReviewFn = html.match(/function renderReview\(\)\{([\s\S]*?)\}\s*function reveal/);
assert.ok(renderReviewFn, 'Review renderer is present');
assert.ok(renderReviewFn[1].includes("$('reviewPromptText').classList.remove('hidden')") && renderReviewFn[1].includes("$('reviewLinkWrap').classList.remove('hidden')") && renderReviewFn[1].includes("$('solvedFromScratch').checked=false"), 'Each new review restores pre-Reveal content and resets solved control');
assert.ok(revealedMarkup.includes('id="solvedFromScratch"'), 'Solved control is revealed with review choices');

match(/function makeReviewIdempotencyKey\(\)[\s\S]*crypto\.randomUUID\(\)[\s\S]*review-[\s\S]*Date\.now/, 'Idempotency key prefers randomUUID with deterministic safe fallback');
match(/pendingReview:\s*null/, 'Review state tracks a pending request');
match(/pending=state\.pendingReview[\s\S]*?state\.pendingReview=pending[\s\S]*?pending\.idempotencyKey/, 'Failed retries reuse the pending idempotency key');
match(/body:JSON\.stringify\(\{rating:state\.rating,idempotencyKey:pending\.idempotencyKey,solvedFromScratch:\$\('solvedFromScratch'\)\.checked\}\)/, 'Review payload explicitly sends rating, idempotencyKey, and solvedFromScratch');
absent(/body:JSON\.stringify\(\{quality:/, 'Review payload does not send quality');
match(/state\.rating=b\.dataset\.rating/, 'Rating selection preserves semantic value');
match(/state\.revealed&&state\.rating/, 'Continue only enables after Reveal and semantic selection');

match(/@media\(max-width:760px\)\{[\s\S]*?#content \.item\+\.item\{margin-top:(?:1[2-9]|[2-9]\d)px\}/, 'Mobile adjacent problem cards have at least 12px vertical spacing');

console.log('FSRS review UI contract: PASS');
