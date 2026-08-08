#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dbSource = readFileSync(resolve(repoRoot, 'lib/db.js'), 'utf8');
const importSource = readFileSync(resolve(repoRoot, 'api/import.js'), 'utf8');

function section(source, startMarker, endMarker, label) {
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, `${label}: missing start marker ${startMarker}`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(end, -1, `${label}: missing end marker ${endMarker}`);
  return source.slice(start, end);
}

function check(name, callback) {
  try {
    callback();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

const normalUpsert = section(
  dbSource,
  'export async function upsertCard(',
  '/** Import a card only when it already belongs to the owner or is an unowned legacy row. */',
  'normal upsert'
);
const legacyImportUpsert = section(
  dbSource,
  'async function upsertImportedCard(',
  '/** Delete only the card identified by id that belongs to ownerId. */',
  'legacy import upsert'
);
const replaceForOwner = section(
  dbSource,
  'export async function replaceCardsForOwner(',
  'const DESIGN_COLS = [',
  'owner replacement'
);

check('normal upsert cannot claim unowned legacy rows', () => {
  assert.match(normalUpsert, /WHERE cards\.owner_id = EXCLUDED\.owner_id/);
  assert.doesNotMatch(normalUpsert, /cards\.owner_id IS NULL/);
  assert.doesNotMatch(normalUpsert, /DO UPDATE SET\s+owner_id\s*=/s);
});

check('legacy import upsert claims only an exact unowned collision and assigns owner', () => {
  assert.match(legacyImportUpsert, /ON CONFLICT \(id\) DO UPDATE SET/);
  assert.match(legacyImportUpsert, /owner_id = EXCLUDED\.owner_id/);
  assert.match(
    legacyImportUpsert,
    /WHERE \(cards\.owner_id = EXCLUDED\.owner_id OR cards\.owner_id IS NULL\)/
  );
  const ownershipWrite = legacyImportUpsert.indexOf('const rows = await db.query(');
  const tagReplacement = legacyImportUpsert.indexOf('await replaceCardTags(card, owner);');
  assert.ok(ownershipWrite !== -1 && tagReplacement > ownershipWrite, 'tags must be replaced after ownership update');
});

check('owner replacement uses the import-only upsert and preserves owner-scoped deletion/no-op guard', () => {
  assert.match(replaceForOwner, /await upsertImportedCard\(card, owner\);/);
  assert.doesNotMatch(replaceForOwner, /await upsertCard\(card, owner\);/);
  assert.match(replaceForOwner, /if \(validated\.length > 0\)/);
  assert.match(replaceForOwner, /DELETE FROM cards WHERE owner_id = \$1 AND id <> ALL\(\$2\)/);
});

check('authenticated import provisions the verified owner before replacing cards', () => {
  assert.match(importSource, /import \{ replaceCardsForOwner, upsertUser \} from '..\/lib\/db\.js';/);
  assert.match(
    importSource,
    /if \(body\.cards\.length > 0\) \{\s*await upsertUser\(\{ clerkId: userId \}\);\s*\}/
  );
  const authIndex = importSource.indexOf('auth = await requireAuth(req);');
  const postCheckIndex = importSource.indexOf("if (req.method !== 'POST')");
  const provisionIndex = importSource.indexOf('await upsertUser({ clerkId: userId });');
  const replaceIndex = importSource.indexOf('await replaceCardsForOwner(body.cards, userId);');
  assert.ok(authIndex !== -1 && provisionIndex > authIndex, 'provisioning must follow JWT authentication');
  assert.ok(postCheckIndex !== -1 && provisionIndex > postCheckIndex, 'provisioning must be limited to POST imports');
  assert.ok(replaceIndex !== -1 && provisionIndex < replaceIndex, 'provisioning must precede replacement');
});

console.log('Legacy import collision source contract passed.');
