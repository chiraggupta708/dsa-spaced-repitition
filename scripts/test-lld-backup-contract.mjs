#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { normalizeLldDesign } from '../lib/lld-contract.js';

const exportSource = readFileSync(new URL('../api/export.js', import.meta.url), 'utf8');
const importSource = readFileSync(new URL('../api/import.js', import.meta.url), 'utf8');

const source = {
  id: 'lld_backup_demo',
  title: 'Backup demo',
  problemStatementMd: 'Keep source content and safe external references.',
  sections: [{ sectionKey: 'scope', contentMd: 'Scope' }],
  diagrams: [{ type: 'class', source: 'classDiagram\n  A --> B' }],
  resources: [{ title: 'Reference', url: 'https://example.com/reference', type: 'reference' }],
  code: {
    language: 'java',
    filename: 'Main.java',
    backgroundMd: 'Starter class context.',
    source: 'public class Main {}',
  },
  review: {
    dimensions: [{ key: 'scope', level: 'partial', notesMd: 'Clarify assumptions.' }],
    readinessStatus: 'practicing',
    nextAction: 'Redo scope.',
  },
};
const roundTrip = normalizeLldDesign(JSON.parse(JSON.stringify(source)));
assert.equal(roundTrip.id, source.id);
assert.equal(roundTrip.resources[0].url, source.resources[0].url);
assert.equal(roundTrip.review.dimensions[0].level, 'partial');
assert.equal(roundTrip.code.language, 'java');
assert.equal(roundTrip.code.source, source.code.source);
assert.throws(() => normalizeLldDesign({ ...source, owner_id: 'attacker' }), /must not be supplied|identity field/i);

assert.match(exportSource, /listLldDesigns/);
assert.match(exportSource, /getLldDesign/);
assert.match(exportSource, /schemaVersion: 1/);
assert.match(exportSource, /Cache-Control', 'no-store'/);
assert.match(importSource, /validateLldDesignImports/);
assert.match(importSource, /for \(var i = 0; i < lldDesigns.length; i \+= 1\)/);
assert.match(importSource, /replaceCardsForOwner\(body\.cards, userId\)/);
assert.match(importSource, /lldCount/);

console.log('LLD backup contract tests passed.');
