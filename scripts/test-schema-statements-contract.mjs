import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { splitSchemaStatements } from '../lib/schema-statements.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const fixture = `
CREATE TABLE "semi;colon" (note TEXT DEFAULT 'single;quote');
-- A line comment with a semicolon; must not split the statement.
INSERT INTO "semi;colon" VALUES ('line;value');
/* A block comment with a semicolon; must not split the statement. */
CREATE FUNCTION tagged() RETURNS void AS $name$
BEGIN
  PERFORM 'tagged;body';
END;
$name$ LANGUAGE plpgsql;
DO $$
BEGIN
  PERFORM 'dollar;body';
END;
$$;
`;

assert.deepEqual(splitSchemaStatements(fixture), [
  `CREATE TABLE "semi;colon" (note TEXT DEFAULT 'single;quote')`,
  `-- A line comment with a semicolon; must not split the statement.\nINSERT INTO "semi;colon" VALUES ('line;value')`,
  `/* A block comment with a semicolon; must not split the statement. */\nCREATE FUNCTION tagged() RETURNS void AS $name$\nBEGIN\n  PERFORM 'tagged;body';\nEND;\n$name$ LANGUAGE plpgsql`,
  `DO $$\nBEGIN\n  PERFORM 'dollar;body';\nEND;\n$$`,
]);

const schema = readFileSync(join(__dirname, '..', 'schema.sql'), 'utf8');
const statements = splitSchemaStatements(schema);
const functionStatement = statements.find((statement) =>
  statement.includes('CREATE OR REPLACE FUNCTION prevent_fsrs_review_event_mutation()'),
);
const triggerStatement = statements.find((statement) => statement.trimStart().startsWith('DO $$'));

assert.ok(functionStatement, 'FSRS mutation-prevention function must be one statement');
assert.ok(functionStatement.includes("RAISE EXCEPTION 'fsrs_review_events are immutable';"));
assert.match(functionStatement, /\$\$\s*$/);
assert.ok(triggerStatement, 'FSRS trigger DO block must be one statement');
assert.ok(triggerStatement.includes('FOR EACH ROW EXECUTE FUNCTION prevent_fsrs_review_event_mutation();'));
assert.match(triggerStatement, /\$\$\s*$/);
assert.equal(
  statements.filter((statement) => statement.includes('prevent_fsrs_review_event_mutation()')).length,
  2,
  'the function and following trigger block must remain separate whole statements',
);

console.log('schema statement splitter contract: PASS');
