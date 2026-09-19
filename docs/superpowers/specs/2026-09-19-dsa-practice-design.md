# Low-Friction DSA Practice Experience

## Goal

Make the DSA workspace answer one question immediately: **what should I practice now?** The experience should minimize decisions and keep recall, independent solving, and knowledge editing as separate activities.

The primary success criterion is that a returning learner can start the correct practice session with one click and complete it without navigating through implementation details or editing forms.

## Product principles

- Show one obvious next action instead of a scheduler dashboard.
- Keep practice read-only and focused; editing belongs in the Problem Library.
- Separate quick recall from full independent implementation.
- Use plain learning language. Scheduler and server terminology must not appear in the daily workflow.
- Preserve the existing scheduling and persistence behavior unless this specification explicitly changes presentation.

## Information architecture

The DSA workspace has three destinations:

1. **Today** — the daily starting point and recall queue.
2. **Independent Solve** — longer, from-scratch practice.
3. **Problem Library** — the canonical place to add, find, inspect, and edit saved knowledge.

Desktop may use the existing sidebar and mobile may use bottom navigation, but both must expose the same three destinations with the same names. Only the approved DSA surface may be visible when DSA is active; the legacy review panel and card browser must not reappear below it after workspace switches.

## Today

Today leads with one prominent action whose label includes the current queue size, for example **Review 4 due problems**. The button opens the recall session; opening the application itself does not force the learner into a problem.

Supporting information is intentionally limited:

- Daily progress, such as **0 of 4 reviewed today**.
- A secondary **Start an independent solve** action when an eligible problem exists.
- A compact list of due problems below the primary action for orientation, not as competing primary actions.

Implementation copy such as “server-owned data,” “server-ordered,” “bounded server pages,” and “private · owner-scoped” is removed from the learner-facing interface. Successful background loads do not leave a status banner behind; the banner is reserved for loading, actionable errors, or retry states.

## Recall Review

Recall Review is a short session for reconstructing the approach and reasoning, not reimplementing the solution.

Each item follows the same sequence:

1. Show the problem title, statement, difficulty, and a restrained set of useful tags.
2. Ask the learner to recall the approach before revealing saved material.
3. On **Reveal answer**, show the saved approach, explanation, complexity, code, mistakes, and insight when those fields exist.
4. Ask for one semantic rating: **Again**, **Hard**, **Good**, or **Easy**.
5. Submit the rating and advance automatically to the next due problem.

The problem statement and saved explanation render sanitized Markdown. Long examples, constraints, and reference code are collapsed by default where that materially shortens the page. The reveal and rating actions remain reachable on mobile without being covered by navigation.

All saved fields are read-only in this session. The existing **Solved from scratch** checkbox is removed because independent solving has its own workflow and signal. Ending early is allowed and must preserve already-submitted ratings.

On completion, show a concise summary containing the reviewed count, rating distribution, and a simple next-review message. Do not expose raw scheduler calculations.

## Independent Solve

“Cold review” is renamed **Independent Solve**. It means solving a previously solved problem again without first seeing the saved approach, code, or explanation.

The default action opens the first problem in the server-provided eligible order, so the learner does not need to choose from another queue and the client does not invent a second ranking policy. The Problem Library also offers **Solve independently** on an individual problem.

The solve view shows only the problem statement and optional source link before submission. After the attempt, the learner records one outcome:

- **Solved**
- **Needed a hint**
- **Couldn’t solve**

The saved solution is revealed only after the outcome is recorded. The result is stored through the existing practice path and determines when independent practice becomes useful again. The interface distinguishes **ready for first independent solve** from **scheduled independent solves**, so a state such as “0 scheduled · 10 ready for first solve” is not contradictory.

Independent Solve remains secondary to the daily Recall Review action.

## Problem Library

The Problem Library is the learner’s durable DSA knowledge base and the only editing surface. It supports search, opening a problem, starting an independent solve, and editing:

- title, source link, difficulty, and tags;
- problem statement;
- approach and complexity;
- reference code and explanation;
- notes, mistakes, insight, and recurring traps.

Review and Independent Solve consume this data but never modify it inline.

Adding a problem is genuinely progressive. The initial form contains only title, link, difficulty, and tags, with **Save for later** and **Save and solve now** actions. An explicit **Add details** section reveals the longer knowledge fields. On mobile the dialog occupies the available width, scrolls independently, and stays above fixed navigation.

## Scheduler boundary

The scheduler behavior is preserved:

- SM-2 remains authoritative for the Recall Review due queue.
- FSRS continues to run in shadow mode and record comparison transitions.
- Again, Hard, Good, and Easy continue feeding both paths through the existing review API.
- This work does not activate FSRS, migrate schedules, change retention parameters, or alter database schemas.

Scheduler terminology stays out of daily practice. Settings may show the compact status **Scheduler: SM-2 · FSRS comparison running** for transparency.

## Component and state boundaries

The implementation should keep four responsibilities distinct even if the existing single-page structure remains:

- **Workspace ownership** decides which DSA, LLD, HLD, or legacy surface may be visible. It must be the only code that hides or reveals whole surfaces, eliminating the current competing timeout/listener behavior.
- **Today queue** fetches and presents due summaries, progress, and the session entry point.
- **Recall session** owns reveal state, rating submission, pagination, and completion.
- **Independent Solve and Library** own their respective practice outcome and editing flows.

Existing APIs remain the source of truth. UI state may optimistically advance only after a successful submission; failed writes keep the current problem and chosen response available for retry.

## Error and empty states

- A failed queue load shows a concise explanation and **Try again** without replacing the rest of the workspace.
- A failed rating or independent-solve submission keeps the current attempt intact and enables retry without creating a duplicate event.
- With no recall items due, Today says the learner is caught up and promotes Independent Solve only when one is eligible.
- With no eligible independent problem, explain that completed problems will appear when ready and provide a route to the Library.
- Empty Library state leads directly to **Add your first problem**.

## Accessibility and responsive behavior

- Dialogs trap focus, have labelled headings, close predictably, and restore focus to their opener.
- Primary actions and rating controls are keyboard reachable and have visible focus states.
- Mobile fixed navigation never covers dialog content or actions.
- Touch targets remain comfortably sized, while long content uses disclosure rather than forcing excessive scrolling.
- Loading and error announcements use appropriate live-region behavior without repeatedly announcing successful refreshes.

## Verification

No new automated regression tests are added in this iteration, following the user’s earlier instruction. Verification consists of:

- Running the existing build and test suite.
- Exercising Today → Recall Review → completion with multiple due problems.
- Confirming recall submissions keep `solvedFromScratch` false and preserve SM-2 authority plus FSRS shadow recording.
- Exercising automatic and Library-initiated Independent Solve flows.
- Checking empty, loading, failure, and retry states.
- Switching between workspaces and confirming no legacy DSA interface appears.
- Inspecting Recall Review, Independent Solve, Add Problem, and Library editing at desktop and narrow mobile widths.
- Confirming Markdown renders safely and mobile navigation does not cover any modal.

## Non-goals

- Activating or tuning FSRS.
- Changing scheduling APIs, database schema, or review history.
- Redesigning unfinished LLD or HLD features.
- Adding analytics, streak mechanics, achievements, or other engagement systems.
- Editing problem knowledge during a practice session.
