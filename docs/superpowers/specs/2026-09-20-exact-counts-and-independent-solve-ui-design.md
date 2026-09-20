# Exact Counts and Independent Solve UI Design

## Goal

Make the DSA practice UI report exact recall and pagination totals while keeping data transfer small, and make the recommended Independent Solve action explain which problem will start. After an Independent Solve is saved, its reference material should be collapsible.

## Scope

- Replace approximate recall text such as `5+` with the exact number of due recall problems.
- Replace cursor-only pagination copy such as `Page 1 · more available` with `Page X of Y`.
- Calculate Library page totals from the active search, difficulty, and practice-state filters.
- Give the Today Independent Solve button a problem-specific label.
- Preserve the existing priority: a due scheduled checkpoint before a first independent check.
- Put the revealed Independent Solve reference material in one disclosure that opens automatically and can be closed and reopened locally.

The FSRS shadow-to-active cutover is explicitly out of scope. Recall continues to use the current SM-2-compatible `cards.next_review` projection.

## Data design

Existing list responses will gain a `totalCount` integer. No endpoint or database table is added.

- The due-card summary query counts cards matching the same owner, due-date, and snapshot conditions as the visible recall page.
- The saved-card query counts cards matching the same owner, search, difficulty, and snapshot conditions as the Library page.
- The practice queue query counts cards matching the same owner, bucket, search, difficulty, and snapshot conditions as the Scheduled or First Check page.
- Cursor predicates are excluded from the count so `totalCount` describes the complete filtered result, not only the rows after the current cursor.
- Row payloads remain lightweight. Prompts, explanations, code, and notes are not added to list responses.

The existing cursor and snapshot behavior remains authoritative for pagination. The browser retains `totalCount` in the page state and derives `totalPages = ceil(totalCount / pageSize)`.

## UI behavior

### Exact recall count

The Today summary, sidebar badge, recall call-to-action, and review progress use the exact due-card `totalCount`. A count of zero remains `0`; the UI never appends `+`.

### Exact pagination

Paged DSA lists render `Page X of Y`. `Y` changes with active Library filters and search. Previous and Next remain cursor-based and are disabled at the beginning or end of the result set.

### Recommended Independent Solve action

The summary continues to select one lightweight `nextItem`:

1. Earliest due scheduled checkpoint.
2. If none is due, the first problem without an Independent Solve.

The Today button identifies that item:

- `Retry {problem title}` for a due scheduled checkpoint.
- `Solve {problem title} independently` for a first check.

Clicking it keeps the existing one-click behavior and opens that problem directly. The Independent page continues to expose both queues so the user can choose a different problem.

### Collapsible reference material

After an Independent Solve outcome is saved, reference material is fetched once and the `Reference solution` disclosure opens automatically. Closing and reopening it does not refetch data and does not alter the saved outcome or optional reflection. The disclosure contains the available approach, explanation, code, key insight, recurring trap, and saved notes.

## Failure and loading behavior

- Until an exact count is available, count surfaces show an existing neutral loading value instead of an approximate `+` value.
- A failed count/list request uses the existing inline error and retry behavior.
- If the recommended item is unavailable, the generic `Start an independent solve` action continues to open the Independent page.
- Reveal failure leaves the saved attempt intact and keeps the existing retryable status message.

## Constraints

- Keep exactly 12 Vercel serverless API entry files.
- Do not add a database migration.
- Do not add new tests, per user direction.
- Do not load full solution bodies for counts, lists, or summary cards.
- Do not activate FSRS as the recall queue authority in this change.

## Verification

- Run the existing relevant checks and production build without creating new test files.
- Confirm an unfiltered 44-item Library with a page size of 10 renders `Page 1 of 5`.
- Confirm search and difficulty filters recalculate `Y` from the matching result count.
- Confirm recall displays the exact count when more than five cards are due.
- Confirm the Today Independent Solve button names the selected scheduled retry or first-check problem.
- Confirm the Independent Solve reference opens after save, then closes and reopens without another reveal request.
- Confirm the API entry-file count remains 12.
