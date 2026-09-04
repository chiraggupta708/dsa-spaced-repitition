#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../lib/lld-db.js', import.meta.url), 'utf8');

function check(name, callback) {
  try {
    callback();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

check('LLD persistence requires an owner and fails closed without a database', () => {
  assert.match(source, /function requireOwner\(ownerId\)/);
  assert.match(source, /if \(!sql\) return \{ designs: \[\] \};/);
  assert.match(source, /requireDatabase\('save LLD design'\)/);
  assert.match(source, /requireDatabase\('delete LLD design'\)/);
});

check('all parent and child reads are owner-scoped', () => {
  const ownerPredicates = (source.match(/owner_id = \$[0-9]/g) || []).length;
  assert.ok(ownerPredicates >= 8, `expected owner predicates, found ${ownerPredicates}`);
  assert.match(source, /WHERE d\.owner_id = \$1/);
  assert.match(source, /FROM lld_designs WHERE id = \$1 AND owner_id = \$2/);
  assert.match(source, /WHERE design_id = \$1 AND owner_id = \$2/);
  assert.match(source, /FROM lld_code_artifacts WHERE design_id = \$1 AND owner_id = \$2/);
  assert.match(source, /skeleton_md, method_signatures_md/);
});

check('normal LLD save never adopts a null-owner legacy row', () => {
  assert.doesNotMatch(source, /owner_id\s+IS\s+NULL/i);
  assert.match(source, /WHERE lld_designs\.owner_id = EXCLUDED\.owner_id/);
  assert.match(source, /WHERE lld_readiness\.owner_id = EXCLUDED\.owner_id/);
});

check('aggregate child replacement is transactional', () => {
  assert.match(source, /const result = await db\.transaction\(queries\);/);
  assert.match(source, /DELETE FROM lld_sections/);
  assert.match(source, /DELETE FROM lld_diagrams/);
  assert.match(source, /DELETE FROM lld_resources/);
  assert.match(source, /DELETE FROM lld_review_dimensions/);
  assert.match(source, /DELETE FROM lld_readiness/);
  assert.match(source, /INSERT INTO lld_code_artifacts/);
  assert.match(source, /WHERE lld_code_artifacts\.owner_id = EXCLUDED\.owner_id/);
  assert.match(source, /compile_status = 'not_run'/);
  assert.match(source, /INSERT INTO lld_code_artifact_versions/);
  assert.match(source, /version_no/);
});

check('code-only updates are owner-scoped and versioned', () => {
  assert.match(source, /export async function saveLldCode/);
  assert.match(source, /INSERT INTO lld_code_artifacts/);
  assert.match(source, /WHERE id = \$1 AND owner_id = \$2/);
  assert.match(source, /INSERT INTO lld_code_artifact_versions/);
});

check('code history reads are owner-scoped and bounded', () => {
  assert.match(source, /export async function getLldCodeVersions/);
  assert.match(source, /FROM lld_code_artifact_versions WHERE design_id = \$1 AND owner_id = \$2/);
  assert.match(source, /LIMIT 20/);
});

check('Mermaid source is persisted as source text and not rendered HTML', () => {
  assert.match(source, /normalized\.source|diagram\.source/);
  assert.match(source, /\$\{diagram\.source\}/);
  assert.doesNotMatch(source, /innerHTML|render\(/);
});

console.log('LLD persistence source contract tests passed.');
