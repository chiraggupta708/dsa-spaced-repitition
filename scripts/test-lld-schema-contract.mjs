#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const schema = readFileSync(new URL('../schema.sql', import.meta.url), 'utf8');
const lldStart = schema.indexOf('-- First-class LLD (V1)');
assert.notEqual(lldStart, -1, 'LLD schema section is missing');
const lldSchema = schema.slice(lldStart);

function check(name, callback) {
  try {
    callback();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

const tables = [
  'lld_designs',
  'lld_sections',
  'lld_diagrams',
  'lld_resources',
  'lld_attempts',
  'lld_attempt_answers',
  'lld_review_dimensions',
  'lld_readiness',
  'lld_code_artifacts',
  'lld_code_artifact_versions',
  'lld_ai_turns',
];

check('LLD schema is additive and has no destructive statements', () => {
  assert.doesNotMatch(lldSchema, /\bDROP\s+(TABLE|COLUMN|SCHEMA)\b/i);
  assert.doesNotMatch(lldSchema, /owner_id\s+IS\s+NULL/i);
  tables.forEach((table) => assert.match(lldSchema, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}\\b`)));
});

check('every LLD table carries a non-null owner boundary', () => {
  tables.forEach((table) => {
    const tableStart = lldSchema.indexOf(`CREATE TABLE IF NOT EXISTS ${table}`);
    const tableEnd = lldSchema.indexOf('\n);', tableStart);
    assert.notEqual(tableEnd, -1, `${table} closing marker is missing`);
    const definition = lldSchema.slice(tableStart, tableEnd);
    assert.match(definition, /owner_id\s+TEXT\s+NOT\s+NULL/);
  });
});

check('child records use composite parent-owner foreign keys', () => {
  ['lld_sections', 'lld_diagrams', 'lld_resources', 'lld_attempts', 'lld_review_dimensions', 'lld_readiness', 'lld_code_artifacts', 'lld_code_artifact_versions']
    .forEach((table) => {
      const tableStart = lldSchema.indexOf(`CREATE TABLE IF NOT EXISTS ${table}`);
      const tableEnd = lldSchema.indexOf('\n);', tableStart);
      const definition = lldSchema.slice(tableStart, tableEnd);
      assert.match(definition, /FOREIGN KEY \(design_id, owner_id\) REFERENCES lld_designs\(id, owner_id\)/);
    });
  const answersStart = lldSchema.indexOf('CREATE TABLE IF NOT EXISTS lld_attempt_answers');
  const answersEnd = lldSchema.indexOf('\n);', answersStart);
  assert.match(
    lldSchema.slice(answersStart, answersEnd),
    /FOREIGN KEY \(attempt_id, owner_id\) REFERENCES lld_attempts\(id, owner_id\)/
  );
});

check('attempt answers have a unique composite parent key', () => {
  const attemptIndex = lldSchema.indexOf('CREATE UNIQUE INDEX IF NOT EXISTS idx_lld_attempts_id_owner');
  const answersTable = lldSchema.indexOf('CREATE TABLE IF NOT EXISTS lld_attempt_answers');
  assert.ok(attemptIndex >= 0, 'attempt owner key index is missing');
  assert.ok(attemptIndex < answersTable, 'attempt owner key must exist before answer foreign key');
  assert.match(lldSchema.slice(attemptIndex, answersTable), /ON lld_attempts \(id, owner_id\)/);
});

check('V1 constraints cover diagrams, lifecycle, review, and timed attempts', () => {
  assert.match(lldSchema, /section_key IN \('functional_requirements', 'nfr', 'model', 'diagram', 'flow_tradeoffs', 'review', 'scope'\)/);
  assert.match(lldSchema, /phase_key IS NULL OR phase_key IN \('functional_requirements', 'nfr', 'model', 'code', 'diagram', 'flow_tradeoffs', 'review', 'scope'\)/);
  assert.match(lldSchema, /DROP CONSTRAINT IF EXISTS lld_sections_section_key_check/);
  assert.match(lldSchema, /DROP CONSTRAINT IF EXISTS lld_ai_turns_phase_key_check/);
  assert.match(lldSchema, /diagram_type\s+TEXT\s+NOT NULL CHECK \(diagram_type IN \('class', 'sequence'\)\)/);
  assert.match(lldSchema, /lifecycle_state\s+TEXT\s+NOT NULL DEFAULT 'draft'/);
  assert.match(lldSchema, /dimension_key\s+TEXT\s+NOT NULL/);
  assert.match(lldSchema, /level\s+TEXT\s+NOT NULL CHECK \(level IN \('missed', 'partial', 'clear'\)\)/);
  assert.match(lldSchema, /mode\s+TEXT\s+NOT NULL CHECK \(mode IN \('practice', 'timed'\)\)/);
  assert.match(lldSchema, /status\s+TEXT\s+NOT NULL DEFAULT 'started'/);
  assert.match(lldSchema, /next_review_at\s+TIMESTAMPTZ/);
  assert.match(lldSchema, /language\s+TEXT\s+NOT NULL DEFAULT 'java' CHECK \(language = 'java'\)/);
  assert.match(lldSchema, /compile_status\s+TEXT\s+NOT NULL DEFAULT 'not_run'/);
  assert.match(lldSchema, /skeleton_md\s+TEXT\s+NOT NULL DEFAULT ''/);
  assert.match(lldSchema, /method_signatures_md\s+TEXT\s+NOT NULL DEFAULT ''/);
  assert.match(lldSchema, /request_type\s+TEXT\s+NOT NULL CHECK/);
  assert.match(lldSchema, /missing_points\s+JSONB/);
  assert.match(lldSchema, /top_improvements\s+JSONB/);
  assert.match(lldSchema, /next_drill\s+TEXT/);
});

check('owner and parent indexes are present', () => {
  assert.match(lldSchema, /idx_lld_designs_owner_state/);
  assert.match(lldSchema, /idx_lld_sections_owner_design/);
  assert.match(lldSchema, /idx_lld_diagrams_owner_design/);
  assert.match(lldSchema, /idx_lld_attempts_owner_design/);
  assert.match(lldSchema, /idx_lld_readiness_owner_state/);
  assert.match(lldSchema, /idx_lld_readiness_owner_review/);
  assert.match(lldSchema, /idx_lld_code_owner_design/);
  assert.match(lldSchema, /idx_lld_code_versions_owner_design/);
  assert.match(lldSchema, /idx_lld_ai_owner_attempt/);
});

console.log('LLD schema contract tests passed.');
