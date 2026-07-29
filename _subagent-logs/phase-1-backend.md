# Phase 1 Backend Contract Build Log

- Log created before repository inspection, as required.

## Application file change

- Path: `/Users/chirag/dsa-spaced-repetition/api/cards.js`
- Behavior: POST card creation now rejects missing, blank, or whitespace-only `question` values with HTTP 400; accepts and returns the existing `answer` TEXT field while preserving existing Markdown-capable field mappings.
- File content verified: YES

## Application file change

- Path: `/Users/chirag/dsa-spaced-repetition/api/cards/[...cardId].js`
- Behavior: Card review ratings now require an integer from 1 through 5, returning HTTP 400 with the matching validation message for 0 or other invalid values.
- File content verified: YES

## Application file change

- Path: `/Users/chirag/dsa-spaced-repetition/api/cards/[...cardId].js`
- Behavior: PUT card updates now reject supplied blank, whitespace-only, or non-string `question` values with HTTP 400 before loading or saving data.
- File content verified: YES

## Application file change

- Path: `/Users/chirag/dsa-spaced-repetition/api/cards/[...cardId].js`
- Behavior: PUT card updates now accept and return `answer`, preserving the optional Markdown reference-answer/code field.
- File content verified: YES

## Verification

### Syntax checks

Command:
```sh
node --check api/cards.js && node --check 'api/cards/[...cardId].js'
```
Output:
```text
(exit code 0; no output)
```

### Safe validation-handler checks (no database access)

Command:
```sh
node --input-type=module -e "import createHandler from './api/cards.js'; import cardHandler from './api/cards/[...cardId].js'; const invoke = async (handler, req) => { let result; const res = { setHeader() {}, status(code) { this.code = code; return this; }, json(data) { result = { status: this.code, data }; } }; await handler(req, res); return result; }; const createBlank = await invoke(createHandler, { method: 'POST', body: { question: '   ' } }); const updateBlank = await invoke(cardHandler, { method: 'PUT', url: '/api/cards/card-1', query: { cardId: 'card-1' }, body: { question: '   ' } }); const reviewZero = await invoke(cardHandler, { method: 'POST', url: '/api/cards/card-1', query: { cardId: 'card-1', review: '1' }, body: { quality: 0 } }); for (const [name, actual, message] of [['createBlank', createBlank, 'question is required'], ['updateBlank', updateBlank, 'question is required'], ['reviewZero', reviewZero, 'quality must be an integer 1-5']]) { if (actual.status !== 400 || actual.data.error !== message) throw new Error(name + ': ' + JSON.stringify(actual)); console.log(name + ': 400 ' + actual.data.error); }"
```
Output:
```text
createBlank: 400 question is required
updateBlank: 400 question is required
reviewZero: 400 quality must be an integer 1-5
```

## Completion

- Application files modified: `/Users/chirag/dsa-spaced-repetition/api/cards.js`; `/Users/chirag/dsa-spaced-repetition/api/cards/[...cardId].js`.
- Full integration tests were intentionally not run because `test/api-test.js` includes destructive import behavior and local database credentials are stale.
