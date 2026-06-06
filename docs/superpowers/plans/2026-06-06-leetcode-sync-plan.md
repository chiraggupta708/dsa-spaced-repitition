# LeetCode URL Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a LeetCode URL field to the New Card form that fetches problem data (title, difficulty, tags, description) from LeetCode's public GraphQL API.

**Architecture:** New serverless endpoint `/api/leetcode/fetch` proxies to LeetCode GraphQL, cleans HTML to plain text. Frontend adds URL input + fetch button to existing form, populates fields. Backend stores `questionDescription` as new card field alongside existing fields.

**Tech Stack:** Node.js fetch (built-in), existing Express API at `api/`, single-file SPA at `index.html`, no new dependencies.

---

### File Map

| File | Action | Purpose |
|---|---|---|
| `api/leetcode/fetch.js` | Create | Serverless endpoint: validate URL → fetch from LeetCode GraphQL → clean HTML → return JSON |
| `lib/leetcode.js` | Create | URL parser, GraphQL query builder, HTML-to-text cleaner |
| `test/api-test.js` | Modify | Add tests for `/api/leetcode/fetch` endpoint |
| `index.html` | Modify | Add LeetCode URL field + fetch button to form, add questionDescription to card/review views |
| `lib/db.js` | Modify | Add `questionDescription` field to default card schema |

---

### Task 1: Create LeetCode Lib Module

**Files:**
- Create: `coding-journal-vercel/lib/leetcode.js`

- [ ] **Step 1: Write the lib module**

```js
/**
 * LeetCode problem fetcher
 * Uses LeetCode's public GraphQL API (no auth required for problem data)
 */

const LEETCODE_GRAPHQL = 'https://leetcode.com/graphql/';

const PROBLEM_QUERY = `
  query questionData($slug: String!) {
    question(titleSlug: $slug) {
      questionId
      questionFrontendId
      title
      difficulty
      content
      topicTags { name }
    }
  }
`;

/**
 * Extract title slug from LeetCode URL
 * Returns null for invalid URLs
 */
function extractSlug(url) {
  if (!url || typeof url !== 'string') return null;
  try {
    const u = new URL(url);
    if (!u.hostname.endsWith('leetcode.com')) return null;
    const match = u.pathname.match(/^\/problems\/([a-z0-9-]+)\/?$/i);
    return match ? match[1].toLowerCase() : null;
  } catch {
    return null;
  }
}

/**
 * Fetch problem data from LeetCode GraphQL API
 */
async function fetchProblem(slug) {
  const response = await fetch(LEETCODE_GRAPHQL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query: PROBLEM_QUERY,
      variables: { slug }
    })
  });

  if (!response.ok) {
    throw new Error(`LeetCode API returned ${response.status}`);
  }

  const json = await response.json();

  if (json.errors && json.errors.length > 0) {
    const msg = json.errors[0].message || 'Unknown LeetCode API error';
    if (msg.includes('not find') || msg.includes('does not exist')) {
      throw new Error('Problem not found');
    }
    throw new Error(msg);
  }

  const q = json.data && json.data.question;
  if (!q) {
    throw new Error('Problem not found');
  }

  return {
    title: q.title || '',
    titleSlug: slug,
    difficulty: (q.difficulty || 'Medium').toLowerCase(),
    tags: (q.topicTags || []).map(t => t.name),
    description: cleanHtml(q.content || ''),
    url: `https://leetcode.com/problems/${slug}/`
  };
}

/**
 * Clean LeetCode HTML content to plain text
 * Handles: <p>, <pre>, <code>, <li>, <strong>, <em>, <br>, <a>
 */
function cleanHtml(html) {
  if (!html) return '';
  let text = html
    // Replace <br> and <br/> with newlines
    .replace(/<br\s*\/?>/gi, '\n')
    // Replace </p> with double newline
    .replace(/<\/p>/gi, '\n\n')
    // Replace <li> with bullet
    .replace(/<li[^>]*>/gi, '- ')
    // Replace </li> with newline
    .replace(/<\/li>/gi, '\n')
    // Replace <pre> blocks with code fences
    .replace(/<pre[^>]*>/gi, '\n')
    .replace(/<\/pre>/gi, '\n')
    // Replace <code> with backticks
    .replace(/<code[^>]*>/gi, ' `')
    .replace(/<\/code>/gi, '` ')
    // Replace <strong>/<b> with **
    .replace(/<(strong|b)[^>]*>/gi, '**')
    .replace(/<\/(strong|b)>/gi, '**')
    // Replace <em>/<i> with *
    .replace(/<(em|i)[^>]*>/gi, '*')
    .replace(/<\/(em|i)>/gi, '*')
    // Replace <a href="x">text</a> with text (url)
    .replace(/<a[^>]+href="([^"]+)"[^>]*>/gi, '')
    .replace(/<\/a>/gi, '')
    // Strip all remaining HTML tags
    .replace(/<[^>]*>/g, '')
    // Decode common HTML entities
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    // Collapse multiple newlines to max 2
    .replace(/\n{3,}/g, '\n\n')
    // Trim each line
    .split('\n').map(l => l.trim()).join('\n')
    .trim();

  return text;
}

module.exports = { extractSlug, fetchProblem, cleanHtml };
```

- [ ] **Step 2: Create the file**

Write `coding-journal-vercel/lib/leetcode.js` with the above content.

- [ ] **Step 3: Run a quick smoke test**

```bash
cd /Users/chirag/.openclaw/workspace/zuck/coding-journal-vercel
node -e "
const { extractSlug, cleanHtml } = require('./lib/leetcode');
console.log('extractSlug valid:', extractSlug('https://leetcode.com/problems/two-sum/'));
console.log('extractSlug invalid:', extractSlug('https://google.com/'));
console.log('extractSlug null:', extractSlug(null));
console.log('cleanHtml sample:', cleanHtml('<p>Test <strong>bold</strong></p>').substring(0, 50));
"
```

Expected:
```
extractSlug valid: two-sum
extractSlug invalid: null
extractSlug null: null
cleanHtml sample: Test **bold**
```

---

### Task 2: Create LeetCode Fetch API Endpoint

**Files:**
- Create: `coding-journal-vercel/api/leetcode/fetch.js`
- Test: `coding-journal-vercel/test/api-test.js`

- [ ] **Step 1: Write the endpoint**

```js
const { extractSlug, fetchProblem } = require('../../lib/leetcode.js');
const { handleOptions, sendJSON, getBody, badBodyError } = require('../../lib/api.js');

export default async function handler(req, res) {
  if (handleOptions(req, res)) return;

  if (req.method !== 'POST') {
    res.statusCode = 405;
    return sendJSON(res, { ok: false, error: 'Method not allowed' });
  }

  try {
    const body = await getBody(req);
    const url = (body && body.url || '').trim();

    if (!url) {
      res.statusCode = 400;
      return sendJSON(res, { ok: false, error: 'URL is required' });
    }

    const slug = extractSlug(url);
    if (!slug) {
      res.statusCode = 400;
      return sendJSON(res, { ok: false, error: 'Invalid LeetCode URL. Expected format: https://leetcode.com/problems/<slug>/' });
    }

    const data = await fetchProblem(slug);
    res.statusCode = 200;
    return sendJSON(res, { ok: true, data });

  } catch (err) {
    const msg = err.message || 'Failed to fetch problem';
    if (msg === 'Problem not found') {
      res.statusCode = 404;
      return sendJSON(res, { ok: false, error: 'Problem not found on LeetCode' });
    }
    res.statusCode = 502;
    return sendJSON(res, { ok: false, error: 'Failed to fetch from LeetCode. Please try again.' });
  }
}
```

- [ ] **Step 2: Add tests to `test/api-test.js`**

Find the line `await test('GET  /api/health (post-import)', testHealthAfterImport);` and add before it:

```js
  // --- LeetCode fetch tests ---
  await test('POST /api/leetcode/fetch (valid URL)', testLeetCodeFetch);
  await test('POST /api/leetcode/fetch (invalid URL)', testLeetCodeFetchInvalid);
  await test('POST /api/leetcode/fetch (empty body)', testLeetCodeFetchEmpty);
  await test('POST /api/leetcode/fetch (non-existent slug)', testLeetCodeFetchNotFound);
  await test('POST /api/leetcode/fetch (method not allowed)', testLeetCodeFetchMethod);
```

Then add the test functions before the closing `main()` call:

```js
async function testLeetCodeFetch() {
  const { status, data } = await request('POST', '/api/leetcode/fetch', {
    url: 'https://leetcode.com/problems/two-sum/'
  });
  if (status !== 200) throw new Error(`Expected 200, got ${status}`);
  if (!data.ok) throw new Error(`Expected ok=true, got ${JSON.stringify(data)}`);
  if (!data.data) throw new Error('Expected data field');
  if (!data.data.title || data.data.title !== 'Two Sum') throw new Error(`Expected title "Two Sum", got "${data.data.title}"`);
  if (!data.data.difficulty || !['easy', 'medium', 'hard'].includes(data.data.difficulty)) throw new Error(`Invalid difficulty "${data.data.difficulty}"`);
  if (!Array.isArray(data.data.tags) || data.data.tags.length === 0) throw new Error('Expected tags array');
  if (!data.data.description || data.data.description.length < 10) throw new Error(`Description too short: "${data.data.description}"`);
  if (!data.data.url || !data.data.url.includes('two-sum')) throw new Error(`Invalid url "${data.data.url}"`);
}

async function testLeetCodeFetchInvalid() {
  const { status, data } = await request('POST', '/api/leetcode/fetch', {
    url: 'https://google.com/'
  });
  if (status !== 400) throw new Error(`Expected 400, got ${status}`);
  if (data.ok) throw new Error('Expected ok=false');
}

async function testLeetCodeFetchEmpty() {
  const { status, data } = await request('POST', '/api/leetcode/fetch', {});
  if (status !== 400) throw new Error(`Expected 400, got ${status}`);
  if (data.ok) throw new Error('Expected ok=false');
}

async function testLeetCodeFetchNotFound() {
  const { status, data } = await request('POST', '/api/leetcode/fetch', {
    url: 'https://leetcode.com/problems/xyznonexistentproblem999/'
  });
  if (status !== 404) throw new Error(`Expected 404, got ${status}`);
  if (data.ok) throw new Error('Expected ok=false');
}

async function testLeetCodeFetchMethod() {
  const { status } = await request('GET', '/api/leetcode/fetch');
  if (status !== 405) throw new Error(`Expected 405, got ${status}`);
}
```

- [ ] **Step 3: Run existing tests to confirm they still pass**

```bash
cd /Users/chirag/.openclaw/workspace/zuck/coding-journal-vercel
BASE_URL=http://localhost:3000 node test/api-test.js
# Or against Vercel deployment:
# node test/api-test.js
```

Expected: 18 tests pass (before adding leetcode tests)

---

### Task 3: Run LeetCode Tests

**Files:**
- Run: `test/api-test.js` (after adding leetcode tests)

- [ ] **Step 1: Run all tests including leetcode**

```bash
cd /Users/chirag/.openclaw/workspace/zuck/coding-journal-vercel
BASE_URL=http://localhost:3000 node test/api-test.js
```

Expected: 23 tests pass (18 original + 5 new)

---

### Task 4: Add questionDescription to Card Schema

**Files:**
- Modify: `coding-journal-vercel/lib/db.js`

- [ ] **Step 1: Find the defaultSm2 or card creation logic**

Search for `defaultSm2` or where new card defaults are created. Add `questionDescription: ''` to the default card object.

- [ ] **Step 2: Create the file or show the diff**

Look for card defaults in `lib/db.js`. The exact change depends on the current schema. Add `questionDescription: ''` as an empty string field alongside existing fields like `question`, `link`, etc.

- [ ] **Step 3: Verify by creating a card via API**

```bash
cd /Users/chirag/.openclaw/workspace/zuck/coding-journal-vercel
curl -s -X POST http://localhost:3000/api/cards \
  -H 'Content-Type: application/json' \
  -d '{"question":"Test","my_thinking":"test","right_thinking":"test"}' \
  | node -e "process.stdin.resume(); let d=''; process.stdin.on('data',c=>d+=c); process.stdin.on('end',()=>{const j=JSON.parse(d); console.log('Has questionDescription:', 'questionDescription' in (j.card||j)); })"
```

Expected: `Has questionDescription: true` (even if empty string)

---

### Task 5: Frontend — Add LeetCode URL Field to Form

**Files:**
- Modify: `coding-journal-vercel/index.html` (the `CJ.form.render` function around line 612)

- [ ] **Step 1: Add LeetCode URL field to the form HTML**

In `CJ.form.render`, replace the form HTML to add the LeetCode URL input + Fetch button at the top:

```js
// Inside CJ.form.render, after the <h2> line:
el.innerHTML = '<div class="form"><h2>'+(isEdit?'Edit':'New')+' Card</h2><form id="cardForm">' +
  // NEW: LeetCode URL row
  '<div class="lc-row">' +
    '<div class="fg">' +
      '<label>LeetCode URL</label>' +
      '<input type="url" id="fLC" placeholder="https://leetcode.com/problems/two-sum/" style="font-size:12px">' +
    '</div>' +
    '<button type="button" class="lc-fetch-btn" id="fLCFetch">🔗 Fetch</button>' +
  '</div>' +
  '<div id="lcState"></div>' +
  '<div id="lcDupe" class="hidden"></div>' +
  // Existing fields...
  '<div class="f-row"><div class="fg"><label>Question *</label><input type="text" id="fQ" placeholder="e.g. Two Sum" required></div>' +
  // ...rest of existing form
```

- [ ] **Step 2: Add CSS for LeetCode components**

Add CSS rules (find the existing `<style>` block and add):

```css
/* LeetCode URL row */
.lc-row{display:flex;gap:6px;margin-bottom:12px;align-items:flex-start}
.lc-row .fg{flex:1;margin-bottom:0}
.lc-fetch-btn{padding:6px 14px;border-radius:6px;font-size:11px;font-weight:600;white-space:nowrap;flex-shrink:0;margin-top:18px;height:34px;display:flex;align-items:center;gap:4px;background:#1c1c1e;color:#fff;transition:opacity .2s}
.lc-fetch-btn:disabled{opacity:.5;cursor:not-allowed}
.lc-state{padding:6px 10px;border-radius:6px;font-size:11px;font-weight:600;margin-bottom:12px;display:flex;align-items:center;gap:6px}
.lc-state.success{background:#ecfdf5;color:#065f46;border:1px solid #a7f3d0}
.lc-state.error{background:#fef2f2;color:#991b1b;border:1px solid #fecaca}
.lc-state.loading{background:#eff6ff;color:#1e40af;border:1px solid #bfdbfe}
.lc-spinner{display:inline-block;width:12px;height:12px;border:2px solid rgba(255,255,255,.3);border-top-color:#fff;border-radius:50%;animation:spin .6s linear infinite}
@keyframes spin{to{transform:rotate(360deg)}}
.lc-dupe{margin-bottom:12px;padding:10px 14px;border-radius:8px;font-size:12px;background:#fefce8;border:1px solid #fde68a;color:#92400e}
.lc-dupe strong{display:block;margin-bottom:2px}
.lc-dupe-actions{display:flex;gap:6px;margin-top:6px}
.lc-dupe-actions button{padding:4px 12px;border-radius:6px;font-size:11px;font-weight:600}
.lc-dupe-cancel{background:transparent;border:1px solid #d97706;color:#92400e}
.lc-dupe-ok{background:#d97706;color:#fff}
.lc-autofill{font-size:10px;opacity:.5;margin-top:2px;display:flex;align-items:center;gap:3px}
```

Also add dark theme equivalents (search for `.dark` section in CSS and add):

```css
.dark .lc-state.success{background:#064e3b;color:#6ee7b7;border:1px solid #065f46}
.dark .lc-state.error{background:#450a0a;color:#fca5a5;border:1px solid #7f1d1d}
.dark .lc-state.loading{background:#1e3a5f;color:#93c5fd;border:1px solid #1e40af}
.dark .lc-dupe{background:#2d281a;color:#fde68a;border:1px solid #92400e}
.dark .lc-dupe-cancel{color:#fde68a;border-color:#d97706;background:transparent}
.dark .lc-dupe-ok{background:#d97706;color:#0f0f16}
.dark .lc-fetch-btn{background:#7aa2f7;color:#0f0f16}
```

- [ ] **Step 3: Add fetch logic to `CJ.form`**

Inside the `CJ.form` module (around line 605), add a `fetchLeetCode` method and wire it:

```js
// Add to CJ.form object:
fetchLeetCode: function() {
  var self = this;
  var urlInput = document.getElementById('fLC');
  var stateEl = document.getElementById('lcState');
  var dupeEl = document.getElementById('lcDupe');
  var fetchBtn = document.getElementById('fLCFetch');
  var url = (urlInput && urlInput.value || '').trim();

  if (!url) {
    stateEl.className = 'lc-state error';
    stateEl.innerHTML = 'Please enter a LeetCode URL';
    stateEl.classList.remove('hidden');
    return;
  }

  // Show loading
  fetchBtn.disabled = true;
  fetchBtn.innerHTML = '<span class="lc-spinner"></span> Fetching';
  stateEl.className = 'lc-state loading';
  stateEl.innerHTML = '<span class="lc-spinner"></span> Fetching problem from LeetCode...';
  stateEl.classList.remove('hidden');
  dupeEl.classList.add('hidden');

  fetch('/api/leetcode/fetch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: url })
  })
  .then(function(r) { return r.json(); })
  .then(function(json) {
    fetchBtn.disabled = false;
    fetchBtn.innerHTML = '🔗 Fetch';

    if (!json.ok) {
      stateEl.className = 'lc-state error';
      stateEl.innerHTML = json.error || 'Failed to fetch';
      return;
    }

    var d = json.data;

    // Auto-fill fields
    var fQ = document.getElementById('fQ');
    var fL = document.getElementById('fL');
    var fT = document.getElementById('fT');
    var fD = document.getElementById('fD');
    var fNotes = document.getElementById('fNotes');

    if (fQ) fQ.value = d.title || '';
    if (fL) fL.value = d.url || '';
    if (fT) fT.value = (d.tags || []).join(', ');
    if (fD) {
      for (var i = 0; i < fD.options.length; i++) {
        if (fD.options[i].value === d.difficulty) {
          fD.selectedIndex = i;
          break;
        }
      }
    }
    // Prepend description to notes (preserve existing notes)
    if (fNotes) {
      var existingNotes = fNotes.value.trim();
      fNotes.value = d.description || '';
      if (existingNotes) {
        fNotes.value += '\n\n---\n\n' + existingNotes;
      }
    }

    // Show success
    stateEl.className = 'lc-state success';
    stateEl.innerHTML = '✅ Fetched: ' + d.title + ' — ' + d.difficulty.charAt(0).toUpperCase() + d.difficulty.slice(1);

    // Duplicate check
    if (d.url && window.CJ && window.CJ.api) {
      window.CJ.api.getAll().then(function(cards) {
        var existing = (cards || []).filter(function(c) { return c.link === d.url; });
        if (existing.length > 0) {
          dupeEl.innerHTML = '<strong>⚠️ This problem already exists</strong>' +
            'A card with this LeetCode URL already exists: "' + U.esc(existing[0].question || existing[0].title || 'Unknown') + '".' +
            '<div class="lc-dupe-actions">' +
            '<button class="lc-dupe-ok" onclick="document.getElementById('lcDupe').classList.add('hidden')">Save Anyway</button>' +
            '<button class="lc-dupe-cancel" onclick="document.getElementById('lcDupe').classList.add('hidden');document.getElementById('fLC').focus()">Cancel</button>' +
            '</div>';
          dupeEl.classList.remove('hidden');
        }
      }).catch(function() {
        // Silently fail — duplicate check is best-effort
      });
    }
  })
  .catch(function(err) {
    fetchBtn.disabled = false;
    fetchBtn.innerHTML = '🔗 Fetch';
    stateEl.className = 'lc-state error';
    stateEl.innerHTML = 'Failed to connect. Check your network and try again.';
  });
}
```

- [ ] **Step 4: Wire the Fetch button**

In the `CJ.form.wire` method (or in the DOMContentLoaded event), add:

```js
// Wire LeetCode fetch button
var lcBtn = document.getElementById('fLCFetch');
if (lcBtn) {
  lcBtn.addEventListener('click', function() {
    CJ.form.fetchLeetCode();
  });
}

// Also fetch on Enter key in the URL field
var lcInput = document.getElementById('fLC');
if (lcInput) {
  lcInput.addEventListener('keydown', function(e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      CJ.form.fetchLeetCode();
    }
  });
}
```

---

### Task 6: Frontend — Show questionDescription in Card View

**Files:**
- Modify: `coding-journal-vercel/index.html` (the `CJ.renderer.renderCard` function)

- [ ] **Step 1: Add description to expanded card view**

In `CJ.renderer.renderCard`, after the tags/difficulty row and before "Your code", add:

```js
(card.questionDescription ? '<div class="sl">Problem</div><div class="nb desc">' + U.esc(card.questionDescription).replace(/\n/g, '<br>') + '</div>' : '')
```

The full expanded card section becomes:

```js
(open ? '<div class="dt" onclick="event.stopPropagation()">' +
  // NEW: Show description first
  (card.questionDescription ? '<div class="sl">Problem</div><div class="nb desc">' + U.esc(card.questionDescription).replace(/\n/g, '<br>') + '</div>' : '') +
  '<div class="sl">Your code</div><pre class="cb">' + U.esc(card.actual_code||card.code||'') + '</pre>' +
  '<div class="sl">My thinking</div><div class="nb">' + (card.my_thinking?U.esc(card.my_thinking).replace(/\n/g, '<br>'):'<em>None</em>') + '</div>' +
  '<div class="sl">Right thinking</div><div class="nb">' + (card.right_thinking?U.esc(card.right_thinking).replace(/\n/g, '<br>'):'<em>None</em>') + '</div>' +
  notes +
  // ...rest
```

Also add a CSS class for the description block:

```css
.nb.desc{background:#f1efec;border:1px solid #e6e2dc;color:#333;font-size:12px;line-height:1.6}
.dark .nb.desc{background:#181822;border:1px solid #262636;color:#c8c4d0}
```

---

### Task 7: Frontend — Show questionDescription in Review Mode

**Files:**
- Modify: `coding-journal-vercel/index.html` (the `CJ.review.renderQuestion` function)

- [ ] **Step 1: Add description to review question card**

In `CJ.review.renderQuestion`, after setting the title and before the hint, add:

```js
// Show description if available
var descEl = document.getElementById('rvQDesc');
if (card.questionDescription) {
  descEl.innerHTML = U.esc(card.questionDescription).replace(/\n/g, '<br>');
  descEl.classList.remove('hidden');
} else {
  descEl.classList.add('hidden');
}
```

Add the description element to the review HTML (in the rvQuestion section of the index.html shell):

```html
<!-- After rvQMeta -->
<div class="rv-desc hidden" id="rvQDesc"></div>
```

And add CSS:

```css
.rv-desc{font-size:12px;line-height:1.6;color:#555;margin-bottom:14px;padding:10px 14px;background:#f5f3f1;border-radius:8px}
.dark .rv-desc{background:#111118;color:#aaa;border:1px solid #262636}
```

---

### Task 8: Final Verification

- [ ] **Step 1: Run all tests**

```bash
cd /Users/chirag/.openclaw/workspace/zuck/coding-journal-vercel
BASE_URL=http://localhost:3000 node test/api-test.js
```

Expected: 23 tests pass (18 original + 5 leetcode)

- [ ] **Step 2: Manual smoke test**

1. Open the app in browser
2. Click "+ New" tab
3. Verify LeetCode URL field + Fetch button appear at top of form
4. Enter `https://leetcode.com/problems/two-sum/` and click Fetch
5. Verify: Title → "Two Sum", Difficulty → "Easy", Tags → "array, hash-table", Link → URL, Description in Notes
6. Save the card
7. Expand the card → verify description shows at top, before code
8. Start review → verify description shows on the question side before rating
9. Click "Save Anyway" when duplicate warning appears
10. Click "Cancel" on duplicate warning → form stays, fields preserved
11. Enter invalid URL → error shown
12. Light/Dark theme toggle works for all new UI elements