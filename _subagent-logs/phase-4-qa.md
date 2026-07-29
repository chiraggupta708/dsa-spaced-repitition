# Phase 4 — Isolated Dev Deployment QA

## Target

- Project: `dsa-spaced-repitition_dev` (isolated development project only)
- Deployment alias: `https://dsa-spaced-repititiondev.vercel.app`
- Deployed URL: `https://dsa-spaced-repitition-krkeqiww0-chiraggupta708-9132s-projects.vercel.app`
- Real production project/database: not targeted.

## Deployment

- Vercel deployment completed successfully and the isolated-dev alias updated.
- Vercel emitted a non-blocking Node 20 deprecation warning for deployments after 2026-10-01. The deployment built and reached Ready state.

## Browser lifecycle verification

1. Loaded the deployed app. It retrieved its existing isolated-dev cards and rendered the Quiet Study Desk queue.
2. Created an isolated QA card containing Markdown headings, fenced JavaScript code, a LeetCode link, and notes.
3. Confirmed the card appeared in the due queue.
4. Started review. Verified the sequence: Recall screen with external problem link → explicit Reveal notes → five ratings → enabled Continue.
5. Confirmed no review request occurred before rating/Continue; selected rating 5 and continued.
6. Fetched the QA card and verified `sm2.lastQuality === 5`.
7. Deleted QA cards and verified cleanup with HTTP 404 after deletion.

## Cleanup

- Two duplicate create-QA cards caused by a browser automation retry were both deleted and verified absent.
- The review-QA card was deleted and verified absent.
- No production endpoint, database, import route, or production backup was touched.

## Result

**PASS:** isolated dev create → Markdown persistence → review/reveal/rating → SM-2 persistence → delete lifecycle.
