// scripts/setup-db.mjs
// Runs at Vercel build time to ensure the schema exists.
// Each DDL statement is sent on its own driver call (the neon serverless
// driver issues one HTTP request per query) — this avoids the
// "cannot insert multiple commands into a prepared statement" error you get
// when batching statements in the Neon dashboard SQL editor.
import { neon } from '@neondatabase/serverless';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const connectionString = process.env.DATABASE_URL || process.env.POSTGRES_URL;

if (!connectionString) {
  console.warn('[setup-db] DATABASE_URL not set — skipping schema setup.');
  process.exit(0);
}

const sql = neon(connectionString);

// Strip -- comments, split into individual statements on ';'.
const raw = readFileSync(join(__dirname, '..', 'schema.sql'), 'utf-8');
const statements = raw
  .split('\n')
  .filter((l) => !l.trim().startsWith('--'))
  .join('\n')
  .split(';')
  .map((s) => s.trim())
  .filter(Boolean);

console.log(`[setup-db] applying ${statements.length} statements...`);
for (const stmt of statements) {
  await sql.query(stmt); // one statement per call
  console.log('  ✓', stmt.slice(0, 70).replace(/\s+/g, ' '));
}
console.log('[setup-db] schema ready.');
