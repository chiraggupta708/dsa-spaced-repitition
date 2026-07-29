# V1: Quiet Study Desk — Implementation Plan

## Scope locked

- Quiet, task-first UI and responsive layout
- LeetCode metadata fetch
- Markdown-first notes: My Approach, Reference Answer / Code, Notes
- Five-point SM-2 recall rating
- Direct problem link during review
- Recall → reveal → rate → next flow
- LLD/HLD textual design forms using the same Markdown rendering

**Explicitly V2:** UML editor for LLD and Excalidraw canvas for HLD.

## Working agreement

- No two sub-agents edit the same file at the same time.
- Every agent creates a unique `_subagent-logs/<phase>.md` file, re-reads each changed file, and records absolute paths plus verification.
- The parent verifies every log, actual file contents, `git diff`, and build/test output before the next phase starts.
- No agent may run `git checkout`, `git restore`, or `git reset`.
- Production DB is never used for write testing; only `dsa-spaced-repitition_dev` is used for disposable write QA.

## File ownership and execution order

| Phase | Owner | Files allowed to edit | Parallel? | Completion gate |
|---|---|---|---|---|
| 0 — Discovery | 2 read-only sub-agents | Only separate log files | Yes | Parent verifies logs and creates final contract |
| 1 — Persistence/API contract | Backend sub-agent | `api/cards.js`, `api/cards/[...cardId].js`, safe API test coverage if required | No | Parent checks row/card mapping, API payloads, schema remains untouched, and tests/build pass |
| 2 — Markdown rendering spike | Parent | Temporary `/tmp` validation file only | No | Completed: Marked + DOMPurify rendered headings/lists/fenced code and removed a `javascript:` link plus script payload |
| 3 — UI integration | Frontend sub-agent | `index.html` only | No, after phases 1–2 | Parent runs HTML/JS balance checks, local interactive flow checks, desktop/mobile checks |
| 4 — Integration and dev DB QA | Parent | Bug fixes only; one file at a time | No | Disposable create/fetch/update/review/delete cycle for cards and designs on isolated dev DB |
| 5 — Release gate | Parent + read-only reviewer sub-agent | Reviewer log only | Yes with no edits | Parent runs build, inspects diff, verifies production is read-only and backup remains valid |

## Phase 0 questions for discovery

1. Which exact card payload fields and database columns are needed for three independent Markdown documents without breaking old exports/imports?
2. Where does the current review flow transition from recall to reveal, and where can quality `5` be verified end-to-end?
3. What does the current LeetCode fetch endpoint return, and how should fetch failures/degraded metadata behave?
4. Which existing tests are safe to extend without invoking destructive import replacement behavior?

## Backend contract target

The backend must store Markdown source, not rendered HTML. Existing text columns can hold Markdown without a destructive migration. The API returns source Markdown; the UI sanitizes/renders it only at display time.

Minimum card fields:

```text
my_thinking       Markdown source
right_thinking    Markdown source / reference answer
actual_code       Markdown source with fenced code blocks permitted
notes             Markdown source
questionDescription Markdown source when fetched
link              source question URL
sm2.lastQuality   integer 1–5
```

## Verification gates

1. Schema changes are additive (`ALTER ... ADD COLUMN IF NOT EXISTS` only if needed); no card deletion migration.
2. API read/write checks verify each Markdown field survives round-trip unchanged.
3. HTML has balanced `<div>` tags and parses inline JavaScript.
4. UI checks: Fetch → edit → save; Start review → open LeetCode; Reveal → all Markdown sections visible; choose each rating 1–5; Continue.
5. Mobile check at 390px confirms no horizontal overflow and bottom navigation remains usable.
6. Run `npm run build` after each implementation phase; do not trust sub-agent self-reports.
