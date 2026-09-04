import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../lib/api.js', import.meta.url), 'utf8');

assert.match(source, /sendJSON[\s\S]*?setHeader\('Cache-Control', 'no-store'\)/);
assert.match(source, /handleOptions[\s\S]*?setHeader\('Cache-Control', 'no-store'\)/);
console.log('API cache contract tests passed.');
