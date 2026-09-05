// Applies only the additive FSRS Phase 0 portion of schema.sql.
// Usage: DATABASE_URL="postgresql://..." node scripts/apply-fsrs-schema.mjs
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { splitSchemaStatements } from '../lib/schema-statements.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const FSRS_PHASE0_MARKER = '-- FSRS Phase 0 — additive scheduler records.';

export function extractFsrsPhase0Schema(schemaSource) {
  const markerIndex = schemaSource.indexOf(FSRS_PHASE0_MARKER);
  if (markerIndex === -1) {
    throw new Error('FSRS Phase 0 marker not found; refusing to apply schema.');
  }
  return schemaSource.slice(markerIndex);
}

export async function applyFsrsSchema({
  connectionString = process.env.DATABASE_URL || process.env.POSTGRES_URL,
  schemaSource = readFileSync(join(__dirname, '..', 'schema.sql'), 'utf8'),
} = {}) {
  if (!connectionString) {
    throw new Error('DATABASE_URL (or POSTGRES_URL) is required.');
  }

  const statements = splitSchemaStatements(extractFsrsPhase0Schema(schemaSource));
  const { neon } = await import('@neondatabase/serverless');
  const sql = neon(connectionString);
  console.log(`Applying ${statements.length} FSRS Phase 0 statements...`);
  for (const statement of statements) {
    await sql.query(statement);
  }
  console.log(`Applied ${statements.length} FSRS Phase 0 statements.`);
}

const isDirectInvocation = process.argv[1]
  && fileURLToPath(import.meta.url) === process.argv[1];
if (isDirectInvocation) {
  try {
    await applyFsrsSchema();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
