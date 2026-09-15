// Applies only the bounded DSA practice Phase 0 portion of schema.sql.
// Usage: DATABASE_URL="postgresql://..." node scripts/apply-dsa-practice-schema.mjs
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { splitSchemaStatements } from '../lib/schema-statements.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const DSA_PRACTICE_MARKER = '-- DSA Practice Phase 0 — additive owner-scoped practice attempts.';
export const DSA_PRACTICE_END_MARKER = '-- END DSA Practice Phase 0';

export function extractDsaPracticeSchema(schemaSource) {
  const markerIndex = schemaSource.indexOf(DSA_PRACTICE_MARKER);
  if (markerIndex === -1) {
    throw new Error('DSA Practice Phase 0 marker not found; refusing to apply schema.');
  }

  const endMarkerIndex = schemaSource.indexOf(
    DSA_PRACTICE_END_MARKER,
    markerIndex + DSA_PRACTICE_MARKER.length,
  );
  if (endMarkerIndex === -1) {
    throw new Error('DSA Practice Phase 0 end marker not found; refusing to apply unbounded schema.');
  }

  const duplicateMarkerIndex = schemaSource.indexOf(
    DSA_PRACTICE_MARKER,
    markerIndex + DSA_PRACTICE_MARKER.length,
  );
  if (duplicateMarkerIndex !== -1 && duplicateMarkerIndex < endMarkerIndex) {
    throw new Error('Duplicate DSA Practice Phase 0 marker found; refusing to apply schema.');
  }

  return schemaSource.slice(markerIndex, endMarkerIndex);
}

export async function applyDsaPracticeSchema({
  connectionString = process.env.DATABASE_URL || process.env.POSTGRES_URL,
  schemaSource = readFileSync(join(__dirname, '..', 'schema.sql'), 'utf8'),
} = {}) {
  if (!connectionString) {
    throw new Error('DATABASE_URL (or POSTGRES_URL) is required.');
  }

  const statements = splitSchemaStatements(extractDsaPracticeSchema(schemaSource));
  if (!statements.length) {
    throw new Error('DSA Practice Phase 0 block contains no executable statements.');
  }

  const { neon } = await import('@neondatabase/serverless');
  const sql = neon(connectionString);
  console.log(`Applying ${statements.length} DSA practice statements...`);
  for (const statement of statements) {
    await sql.query(statement);
  }
  console.log(`Applied ${statements.length} DSA practice statements.`);
  return statements.length;
}

const isDirectInvocation = process.argv[1]
  && fileURLToPath(import.meta.url) === process.argv[1];
if (isDirectInvocation) {
  try {
    await applyDsaPracticeSchema();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
