# Phase 0 — Frontend Discovery Log

**Scope:** Read-only frontend/review-flow discovery for V1 Quiet Study Desk.

## Files read

1. `/Users/chirag/dsa-spaced-repetition/index.html` — full single-file application (1–1993).
2. `/Users/chirag/dsa-spaced-repetition/package.json` (1–19).
3. `/Users/chirag/dsa-spaced-repetition/mockup-quiet-study-desk.html` (1–160) — approved UI reference only; not modified.
4. No local frontend JS/CSS assets are imported by `index.html`: scripts and styles are inline. The only initial external frontend asset is Google Inter at `index.html:8`; Highlight.js CSS/JS is injected dynamically at `index.html:1940` from cdnjs.

## Architecture / effective ownership note

- `index.html` is the live frontend entrypoint: all application CSS, markup, API wrapper, renderer, review controller, form behavior, search, and later overrides are inline (`index.html:7–1991`). `package.json:5–18` declares Node 20, a `start` server script, and no frontend framework/build dependency.
- The final inline script starts at **`index.html:1939`** and is intentionally minified into a few very long source lines. It *overrides* earlier `CJ.form.render`, `CJ.form.wire`, `CJ.form.read`, `CJ.form.populate`, `CJ.renderer.toggle`, and `CJ.renderer.renderCard` definitions (`index.html:1940–1990`). UI work must change the effective late override, not only the earlier base implementations (`index.html:902–953`).

## 1) Card add form and save calls

### Effective add/edit form
- Base form is defined at `index.html:907–952`, but the effective enhanced form is the late override beginning at `index.html:1940` (form render markup spans `1941–1965`).
- Current effective fields: question `#fQ`; LeetCode source URL `#fLC`; saved card link `#fL`; tags `#fT`; difficulty `#fD`; prompt/description `#fQDesc`; first approach `#fMyT`; correct/reference approach `#fRT`; code `#fCode`; notes `#fNotes`; optional images. See `index.html:1943–1965`.
- Template picker exists in the final override. The Algorithm template maps the relevant fields but keeps old labels such as “My Approach”, “Correct Approach”, “Code”, and “Notes” (`index.html:1940`); template application hides fields and hides the LeetCode row for non-algorithm types (`index.html:1940`).
- Effective payload is built by overridden `CJ.form.read` at `index.html:1990`: `{question, link, tags, difficulty, actual_code, my_thinking, right_thinking, notes, questionDescription, templateType, images}`.
- Validation still requires question, `my_thinking`, and `right_thinking` in the base validator (`index.html:946`), which is used by the override’s submit handlers (`index.html:1978–1981`).
- Save path: normal submit and “Save & Add Another” select `CJ.api.updateCard(editId, payload)` or `CJ.api.createCard(payload)` (`index.html:1978–1981`). API calls are `PUT /api/cards/:id` and `POST /api/cards` respectively (`index.html:656–657`). On normal success it switches to All and refreshes; Save & Add Another re-renders a blank form for a newly created card (`index.html:1978–1981`).

## 2) Current LeetCode fetch UI behavior

- CSS/state affordances are already present: row/button at `index.html:239–259`, with loading/success/error and duplicate-warning styling.
- Effective form puts LeetCode URL and Fetch above the normal card fields (`index.html:1944–1952`). It is visible only for the Algorithm template (`index.html:1940`).
- `CJ.form.fetchLeetCode` (`index.html:1966`) behavior:
  1. Empty URL: sets `#lcState` to an error (“Please enter a LeetCode URL”).
  2. Otherwise disables Fetch, changes it to spinner/Fecthing, shows loading state, hides duplicate warning.
  3. `POST /api/leetcode/fetch` JSON `{url}`; it parses JSON without checking HTTP status.
  4. Success autofills title/question, saved link, comma-separated tags, difficulty option, and problem description (`#fQ`, `#fL`, `#fT`, `#fD`, `#fQDesc`); then shows a success message.
  5. It calls `CJ.api.getAll()` and compares `card.link === fetched.url`; an existing card shows a dismissible warning with “Save Anyway” and “Cancel.” Neither option prevents saving; Cancel only hides warning/refocuses URL.
  6. JSON failure shows the server’s error; transport failure shows a generic network error.
- Fetch is wired both by button click and Enter in `#fLC` (`index.html:1983–1987`).

## 3) Review: start → recall/reveal → rating → continue

- Static review DOM ownership: `#modeReview`, header/progress, `#rvQuestion`, five rating buttons, `#rvReveal` and completion panel at `index.html:526–569`.
- Start: the due prompt’s “Review Now” (`index.html:510–514`) triggers `CJ.review.start()` via DOM wiring (`index.html:1152–1155`). Expanded cards also call `startFromCard(id)` in the effective renderer (`index.html:1990`).
- `start` fetches `/api/cards/due`, sorts due order, optionally positions at the chosen card, switches Browse → Review, and renders the current recall screen (`index.html:838–850`).
- Recall screen sets step/progress/title/tags/difficulty and, if present, description (`index.html:853–865`). **It does not render a direct `card.link`/LeetCode link.**
- Selecting a rating immediately calls both `selectRating` and `revealAndSubmit` (`index.html:1160–1164`); keyboard 1–5 does the same (`index.html:1235–1241`). Thus the existing behavior is “rate to reveal,” not a separate reveal action.
- `revealAndSubmit` rejects no rating, then persists immediately through `POST /api/cards/:id?review=1` with `{quality: 1..5}` (`index.html:659`, `873–885`). It displays raw code in `#rvCode`, escapes then line-break-renders both thinking fields, emits next-review result, and swaps from recall to reveal.
- Continue: `#rvNext` calls `nextCard`; it renders the next question or shows session complete after the last card (`index.html:888–891`, `1158`). Back/End/Done call `end`, which may confirm if cards remain, returns to Browse, refreshes stats/list, and toasts (`index.html:893–898`, `1155–1157`). Enter/Space advances only after reveal; Escape ends (`index.html:1235–1241`).

## 4) Markdown, rendering, sanitization, code blocks

- A custom renderer `CJ.markdown.render` is introduced at `index.html:1940`; it first HTML-escapes `&`, `<`, `>`, then supports bold, italic, inline code, Markdown links, `##` headings, and `- ` lists. It does **not** implement fenced code blocks (triple backticks), paragraphs, ordered lists, or a robust Markdown parser.
- Link handling is potentially unsafe: after text escaping, the replacement inserts the Markdown URL directly into `href` without URL validation/attribute escaping (`index.html:1940`). It also uses `target="_blank"` without `rel="noopener noreferrer"`.
- Effective expanded-card rendering feeds **notes**, **my_thinking**, and **right_thinking** through this Markdown renderer in `.md-rendered` containers; description stays escaped plain text with `<br>` conversion (`index.html:1990`). Review reveal does **not** use Markdown; it escapes and replaces newlines for both approach fields (`index.html:879–881`).
- CSS exists for inline `code` and `.md-rendered pre code` (`index.html:223–236`), but no renderer output creates `<pre>` for fenced Markdown. Therefore the apparent code-block styling is currently unused by Markdown content.
- Saved code is a separate code field. Expanded cards call `CJ.highlight.init()` and render `<pre class="cb"><code>…</code></pre>` (`index.html:1990`); Highlight.js is dynamically loaded from cdnjs at `index.html:1940`. The helper escapes code before passing it to `hljs.highlightAuto`, likely causing escaped entities to be highlighted rather than raw source. Review displays code safely with `textContent` (`index.html:879`).

## 5) Exact `index.html` areas the eventual UI agent must own

1. **Quiet Study Desk visual system/layout:** CSS `index.html:7–447`; replace/reconcile the current gradient/bento/sidebar rules with the approved quiet mockup’s tokens/layout. Preserve responsive behavior.
2. **Browse shell and study queue markup:** sidebar/main/browse header, metrics, due prompt, tools, and mobile nav at `index.html:451–524` and `574–581`; corresponding renderer output at `index.html:704–828`, later patched at `1822–1928` and effective card renderer at `1990`.
3. **Add-card form UI plus LeetCode affordance:** base form `902–953` is superseded by the effective templates/form/LeetCode block at `1939–1990`, particularly effective markup `1941–1965`, `fetchLeetCode` at `1966`, and wiring/read overrides `1978–1990`.
4. **Review dialog/screen and interaction presentation:** DOM `526–569`, review state/controller `830–900`, event/key wiring `1143–1243`. To match the mockup’s explicit Reveal notes → rating → Continue flow, this behavior must be changed in this owned area (not merely restyled).
5. **Markdown display:** Markdown/highlight setup at `1939–1940` and effective expanded-card renderer at `1990`; use this area to make Markdown-first fields and fenced code blocks match the approved spec safely.

## Minimal V1 UI integration checklist (match approved mockup; do not redesign it)

- [ ] Apply the mockup’s quiet token system, 224px sidebar/compact mobile bar, single-column study queue, restrained borders/shadows, and reviewed typography from `mockup-quiet-study-desk.html:8–47`; remove/avoid the existing gradient/bento/momentum visual treatment.
- [ ] Keep existing navigation/API contracts and IDs where possible; render Due, All cards, Designs, Mastered, and Add controls in the mockup’s locations (`mockup:51–99`, `129`).
- [ ] Present the existing due queue/review-start data in the mockup’s review panel and three concise metrics; do not alter backend endpoints.
- [ ] Re-layout the effective Algorithm add form as the mockup’s add dialog: LeetCode fetch helper, Problem, optional link, difficulty, tags, then Markdown-first **Your first approach**, **Reference answer / code**, and **Notes** (`mockup:101–117`). Map these to existing saved keys `my_thinking`, `right_thinking`, `actual_code`, and `notes` without schema changes.
- [ ] Retain `POST /api/leetcode/fetch`, its autofill payload, and duplicate warning; present its loading/success/error states as inline accessible helper feedback (`mockup:106`, current logic `index.html:1966`).
- [ ] Change review UI to mockup’s dialog sequence: recall prompt + direct external problem link, explicit **Reveal notes**, then rating selection and **Continue**; preserve one server `reviewCard` submission per rated card and existing 1–5 quality values (`mockup:119–124`; current state/controller `830–900`).
- [ ] Render the saved Markdown fields consistently in card detail and review reveal; add safe fenced-code handling, validate link URLs, and retain separate escaped/highlighted code rendering. Do not treat CSS `.md-rendered pre code` as existing fenced-code support.
- [ ] Preserve card edit/create, saved-field payload, image behavior, keyboard behavior where compatible, API wrapper, and responsive/mobile access; verify direct problem links use `target="_blank" rel="noopener noreferrer"`.

## Required completion declaration

- Application files modified: NONE.
- Only file created/modified: `/Users/chirag/dsa-spaced-repetition/_subagent-logs/phase-0-frontend-discovery.md`.
- No build run (read-only discovery; no build required).
- File content verified: YES (re-read after writing).
