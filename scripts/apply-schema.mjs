// scripts/apply-schema.mjs
// Applies schema.sql to the Neon DB named in DATABASE_URL.
// Usage: DATABASE_URL="postgresql://..." node scripts/apply-schema.mjs
import { neon } from '@neondatabase/serverless';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const connectionString = process.env.DATABASE_URL || process.env.POSTGRES_URL;
if (!connectionString) {
  console.error('DATABASE_URL (or POSTGRES_URL) is required.');
  process.exit(1);
}
const sql = neon(connectionString);

// Strip -- comments, split into statements on ';'.
const raw = readFileSync(join(__dirname, '..', 'schema.sql'), 'utf-8');
const statements = raw
  .split('\n')
  .filter((l) => !l.trim().startsWith('--'))
  .join('\n')
  .split(';')
  .map((s) => s.trim())
  .filter(Boolean);

console.log(`Applying ${statements.length} statements...`);
for (const stmt of statements) {
  // neon's sql.query accepts (text, params); run each DDL statement.
  await sql.query(stmt);
  console.log('  ✓', stmt.slice(0, 70).replace(/\s+/g, ' '));
}
console.log('Schema applied.');
