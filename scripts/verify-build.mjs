// Static application builds must not perform database writes.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { splitSchemaStatements } from '../lib/schema-statements.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const schema = readFileSync(join(root, 'schema.sql'), 'utf8');
const indexHtml = readFileSync(join(root, 'index.html'), 'utf8');
const statements = splitSchemaStatements(schema);

if (!statements.length) {
  throw new Error('schema.sql produced no statements');
}
if (!indexHtml.includes('<script')) {
  throw new Error('index.html has no application script');
}

console.log(`[verify-build] static source verified; ${statements.length} schema statements parsed.`);
console.log('[verify-build] database migrations are explicit and are not run during builds.');
