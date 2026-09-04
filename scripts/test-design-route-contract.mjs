#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { getPathParts } from '../api/designs/[...path].js';

const handler = readFileSync(new URL('../api/designs/[...path].js', import.meta.url), 'utf8');
const vercel = readFileSync(new URL('../vercel.json', import.meta.url), 'utf8');

assert.match(vercel, /"source":\s*"\/api\/designs\/lld\/:id"/);
assert.match(vercel, /"destination":\s*"\/api\/designs\/lld\?lldId=:id"/);
assert.match(handler, /const nestedId = req\.query\?\.lldId \|\| req\.query\?\.designId/);
assert.match(handler, /parts\[0\] === 'lld' && parts\.length === 1/);
assert.match(handler, /parts\.push\(String\(nestedId\)\)/);
assert.match(handler, /coachLldAttempt/);
assert.match(handler, /action === 'ai'/);
assert.match(handler, /saveLldCode/);
assert.match(handler, /action === 'code'/);
assert.match(handler, /getLldCodeVersions/);
assert.match(handler, /action === 'code-versions'/);

assert.deepEqual(
  getPathParts({ query: { path: ['lld'], lldId: 'lld_query' }, url: '/api/designs/lld?lldId=lld_query' }),
  ['lld', 'lld_query']
);
assert.deepEqual(
  getPathParts({ query: { lldId: 'lld_local' }, originalUrl: '/api/designs/lld?lldId=lld_local', url: '/api/designs/lld?lldId=lld_local' }),
  ['lld', 'lld_local']
);
assert.deepEqual(
  getPathParts({ query: { path: ['lld', 'lld_direct'] }, url: '/api/designs/lld/lld_direct' }),
  ['lld', 'lld_direct']
);

console.log('Design route contract tests passed.');
