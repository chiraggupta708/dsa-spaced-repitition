// scripts/apply-schema.mjs
// Applies schema.sql to the Neon DB named in DATABASE_URL.
// Usage: DATABASE_URL="postgresql://..." node scripts/apply-schema.mjs
import { neon } from '@neondatabase/serverless';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { splitSchemaStatements } from '../lib/schema-statements.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const connectionString = process.env.DATABASE_URL || process.env.POSTGRES_URL;
if (!connectionString) {
  console.error('DATABASE_URL (or POSTGRES_URL) is required.');
  process.exit(1);
}
const sql = neon(connectionString);

// Preserve existing behavior: omit comment-only -- lines, then split only at
// top-level statement terminators so function and DO bodies remain intact.
const raw = readFileSync(join(__dirname, '..', 'schema.sql'), 'utf-8');
const statements = splitSchemaStatements(
  raw
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n'),
);

console.log(`Applying ${statements.length} statements...`);
for (const stmt of statements) {
  // neon's sql.query accepts (text, params); run each DDL statement.
  await sql.query(stmt);
  console.log('  ✓', stmt.slice(0, 70).replace(/\s+/g, ' '));
}
console.log('Schema applied.');
