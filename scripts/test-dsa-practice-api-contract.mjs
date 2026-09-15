#!/usr/bin/env node
/**
 * Database-free source contract for the authenticated DSA practice API boundary.
 * It reads only api/practice.js and dev-server.js. It does not import the route,
 * initialize the database, start a server, contact Clerk, or claim live behavior.
 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const routePath = path.join(root, 'api', 'practice.js');
const devServerPath = path.join(root, 'dev-server.js');
const [route, devServer] = await Promise.all([
  readFile(routePath, 'utf8'),
  readFile(devServerPath, 'utf8'),
]);

function section(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.ok(start >= 0, `missing source marker: ${startMarker}`);
  const end = endMarker ? source.indexOf(endMarker, start) : source.length;
  assert.ok(!endMarker || end > start, `missing source end marker: ${endMarker}`);
  return source.slice(start, end < 0 ? source.length : end);
}

const getBranch = section(route, "if (req.method === 'GET')", "if (req.method === 'POST')");
const postBranch = section(route, "if (req.method === 'POST')", "if (req.method === 'PUT')");
const putBranch = section(route, "if (req.method === 'PUT')", "sendJSON(res, 405");

// Authentication and preflight are the only boundary entry points. The owner
// passed below must come from the authenticated Clerk result, never the request.
assert.match(route, /import\s*\{\s*requireAuth\s*\}\s*from ['"]\.\.\/lib\/auth\.js['"]/);
assert.match(route, /if \(handleOptions\(req, res\)\) return;/);
assert.match(route, /auth\s*=\s*await requireAuth\(req\)/);
assert.match(route, /sendAuthError\(res, error\)/);
assert.match(route, /(?:const|var|let)\s+userId\s*=\s*auth\.userId/);
assert.doesNotMatch(route, /(?:req\.(?:query|body)|body)\.(?:ownerId|userId|clerkId)/,
  'owner identity must not come from request data');
assert.match(route, /function queryValue\(req, key\)/);
assert.match(route, /req\.query/);
assert.match(route, /new URL\(req\.url \|\| '', 'http:\/\/localhost'\)/);

// Every read view is explicit and delegates with the authenticated owner.
assert.match(getBranch, /(?:const|var|let)\s+view\s*=\s*queryValue\(req, 'view'\)/);
assert.match(getBranch, /view === 'summary'/);
assert.match(getBranch, /getPracticeSummary\(userId\)/);
assert.match(getBranch, /view === 'queue'/);
assert.match(getBranch, /listPracticeQueue\(userId,\s*\{[\s\S]*bucket[\s\S]*limit[\s\S]*cursor[\s\S]*q[\s\S]*difficulty/);
assert.match(getBranch, /view === 'session'/);
assert.match(getBranch, /getPracticeSession\(userId,\s*\{[\s\S]*limit[\s\S]*cursor/);
assert.match(getBranch, /view === 'card'/);
assert.match(getBranch, /getPracticeCard\(cardId, userId\)/);
assert.match(getBranch, /view === 'history'/);
assert.match(getBranch, /listPracticeHistory\(userId, (?:cardId|historyCardId),\s*\{[\s\S]*limit[\s\S]*cursor/);
assert.match(getBranch, /view === 'attempt'/);
assert.match(getBranch, /getPracticeAttempt\(attemptId, userId\)/);
assert.match(getBranch, /view === 'timezone'/);
assert.match(getBranch, /getPracticeTimeZone\(userId\)/);
assert.match(getBranch, /timeZone:\s*timeZone/);
assert.match(getBranch, /required:\s*timeZone === null/);
assert.match(getBranch, /throw new PracticeValidationError\([^\n]*view/);

// Queue/session/history limits are validated for positivity here; their hard
// caps remain in the database layer and are not reimplemented by this route.
assert.match(route, /function positiveLimit\(req\)/);
assert.match(route, /Number\.isInteger\(limit\)/);
assert.match(route, /limit <= 0/);
assert.match(getBranch, /(?:const|var|let)\s+\w+Limit\s*=\s*positiveLimit\(req\)/);
assert.doesNotMatch(getBranch, /Math\.min\(|PRACTICE_PAGE_LIMITS/);
assert.match(getBranch, /\w+Cursor\s*=\s*queryValue\(req, 'cursor'\) \|\| undefined/);

// Missing card/attempt records are explicit 404s, not successful null DTOs.
assert.match(getBranch, /getPracticeCard\(cardId, userId\)[\s\S]*?if \(!card\)[\s\S]*?sendNotFound/);
assert.match(getBranch, /getPracticeAttempt\(attemptId, userId\)[\s\S]*?if \(!attempt\)[\s\S]*?sendNotFound/);
assert.match(route, /function sendNotFound[\s\S]*?sendJSON\(res, 404/);
assert.match(getBranch, /cardId is required|requireQueryValue\(req, 'cardId'\)/);
assert.match(getBranch, /attemptId is required|requireQueryValue\(req, 'attemptId'\)/);

// Write boundary: only the authenticated owner is supplied, and POST does not
// elevate a one-off client timezone into scheduling authority.
assert.match(postBranch, /(?:const|var|let)\s+body\s*=\s*getBody\(req\)/);
assert.match(postBranch, /recordPracticeAttempt\(\{\s*ownerId:\s*userId,\s*cardId:\s*(?:postCardId|cardId),\s*body(?::\s*body)?\s*\}\)/);
assert.match(postBranch, /replayed[\s,}]/);
assert.match(postBranch, /attempt[\s,}]/);
assert.match(postBranch, /practice[\s,}]/);
assert.doesNotMatch(postBranch, /body\.timeZone|timeZone\s*:/,
  'POST must not accept a one-off timezone');
assert.match(putBranch, /timezoneView !== 'timezone'/);
assert.match(putBranch, /(?:const|var|let)\s+\w*Body\s*=\s*getBody\(req\)/);
assert.match(putBranch, /(?:body|timezoneBody)\.timeZone/);
assert.match(putBranch, /setPracticeTimeZone\(userId, (?:body|timezoneBody)\.timeZone\)/);
assert.match(putBranch, /timeZone:\s*saved\.timeZone/);

// Typed practice errors preserve their status; body parsing is safe; unknown
// database failures return a generic 500 without raw messages or bodies.
assert.match(route, /isPracticeError/);
assert.match(route, /practiceErrorBody/);
assert.match(route, /(?:const|var|let)\s+status\s*=\s*Number\.isInteger\(payload\.status\)/);
assert.match(route, /sendJSON\(res, status, body\)/);
assert.match(route, /sendJSON\(res, 400,\s*\{\s*ok:\s*false/);
assert.match(route, /sendJSON\(res, 500,\s*\{\s*ok:\s*false/);
assert.match(route, /code:\s*['"]internal_error['"]/);
assert.doesNotMatch(route, /badBodyError/);
assert.match(route, /function practiceErrorDetails\(error\)/);
assert.match(route, /console\.error\('\[practice\] internal error',\s*practiceErrorDetails\(error\)\)/);
assert.doesNotMatch(route, /console\.error\(error/);

// The route must use the shared private/no-store response helpers everywhere.
assert.match(route, /sendJSON/);
assert.match(route, /sendAuthError/);
assert.doesNotMatch(route, /sendConditionalJSON|public\s*,\s*max-age/i);
assert.doesNotMatch(route, /res\.(?:json|send|end)\(/,
  'practice responses must go through sendJSON or handleOptions');

// No solution/reference bodies may cross this boundary, including the compact
// queue, card, session, and history response paths.
for (const field of ['answer', 'actual_code', 'my_thinking', 'right_thinking', 'notes']) {
  assert.doesNotMatch(route, new RegExp(`\\b${field}\\b`, 'i'),
    `practice API must not mention solution body field ${field}`);
}
assert.match(getBranch, /listPracticeHistory/);
assert.doesNotMatch(section(getBranch, "if (view === 'history')", "if (view === 'attempt')"),
  /blocker|reflection|challenge/i, 'history response must remain summaries only');

// Unsupported methods and unknown views are client errors at this boundary.
assert.match(getBranch, /unknown|unsupported|view must be one|invalid view/i);
assert.match(route, /sendJSON\(res, 405,\s*\{\s*ok:\s*false/);
assert.match(route, /method_not_allowed|Method not allowed/i);

// Local parity is a single registration and does not alter other routes.
assert.match(devServer, /const practiceHandler\s*=\s*\(await import\(['"]\.\/api\/practice\.js['"]\)\)\.default/);
assert.match(devServer, /app\.all\(['"]\/api\/practice['"]\s*,\s*practiceHandler\)/);

console.log('DSA practice API source contract: PASS (database-free; source assertions only).');
