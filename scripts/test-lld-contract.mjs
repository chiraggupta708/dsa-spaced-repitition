#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  LLD_BACKUP_VERSION,
  normalizeLldBackup,
  normalizeLldDesign,
  standardLldSections,
  validateMermaidSource,
} from '../lib/lld-contract.js';

function check(name, callback) {
  try {
    callback();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

check('standard template separates functional requirements and NFR sections', () => {
  const sections = standardLldSections();
  assert.equal(sections.length, 6);
  assert.deepEqual(sections.map((section) => section.sectionKey), [
    'functional_requirements',
    'nfr',
    'model',
    'diagram',
    'flow_tradeoffs',
    'review',
  ]);
  assert.deepEqual(sections.map((section) => section.position), [0, 1, 2, 3, 4, 5]);
});

check('valid LLD design normalizes source-first content', () => {
  const design = normalizeLldDesign({
    title: 'Parking Lot',
    sections: [{ sectionKey: 'scope', contentMd: 'Park and unpark vehicles.' }],
    diagrams: [{
      title: 'Domain model',
      type: 'class',
      source: 'classDiagram\n  ParkingLot --> ParkingSpot',
      description: 'Parking lot domain relationships',
    }],
    resources: [{
      title: 'Strategy pattern reference',
      url: 'https://refactoring.guru/design-patterns/strategy',
      placement: 'after_attempt',
    }],
    tags: ['ownership'],
  });
  assert.equal(design.schemaVersion, 1);
  assert.equal(design.title, 'Parking Lot');
  assert.equal(design.sections[0].contentMd, 'Park and unpark vehicles.');
  assert.equal(design.diagrams[0].source, 'classDiagram\n  ParkingLot --> ParkingSpot');
  assert.equal(design.resources[0].host, 'refactoring.guru');
  assert.equal(design.lifecycleState, 'draft');
});

check('Mermaid validation identifies only supported diagram types', () => {
  assert.deepEqual(validateMermaidSource('classDiagram\n  A --> B', 'source', 'class'), {
    source: 'classDiagram\n  A --> B',
    type: 'class',
  });
  assert.throws(
    () => validateMermaidSource('stateDiagram-v2\n  A --> B'),
    /must begin with classDiagram or sequenceDiagram/
  );
  assert.throws(
    () => validateMermaidSource('classDiagram\n  click A "javascript:alert(1)"'),
    /unsupported directive, link, callback, or HTML construct/
  );
  assert.throws(
    () => validateMermaidSource('%%{init: {"securityLevel":"loose"}}\nclassDiagram\n  A --> B'),
    /unsupported directive, link, callback, or HTML construct/
  );
});

check('resource URLs are credential-free http(s)', () => {
  assert.throws(
    () => normalizeLldDesign({ title: 'Bad resource', resources: [{ title: 'Bad', url: 'javascript:alert(1)' }] }),
    /must use a credential-free http or https URL/
  );
  assert.throws(
    () => normalizeLldDesign({ title: 'Bad resource', resources: [{ title: 'Bad', url: 'https://user:pass@example.com' }] }),
    /must use a credential-free http or https URL/
  );
});

check('client identity fields are rejected recursively', () => {
  assert.throws(
    () => normalizeLldDesign({ title: 'Foreign', owner_id: 'user_a' }),
    /owner_id: must not be supplied by the client/
  );
  assert.throws(
    () => normalizeLldDesign({ title: 'Foreign', sections: [{ sectionKey: 'scope', contentMd: 'x', userId: 'user_a' }] }),
    /userId: must not be supplied by the client/
  );
});

check('review dimensions and lifecycle values are constrained', () => {
  const design = normalizeLldDesign({
    title: 'Vending Machine',
    lifecycleState: 'practicing',
    review: {
      readinessStatus: 'needs_review',
      dimensions: [{ key: 'pattern_edge_case', level: 'partial', notesMd: 'State transitions need a drill.' }],
    },
  });
  assert.equal(design.lifecycleState, 'practicing');
  assert.equal(design.review.readinessStatus, 'needs_review');
  assert.equal(design.review.dimensions[0].level, 'partial');
  assert.throws(
    () => normalizeLldDesign({ title: 'Bad state', lifecycleState: 'ready' }),
    /design.lifecycleState: is not supported/
  );
  assert.throws(
    () => normalizeLldDesign({ title: 'Bad review', review: { dimensions: [{ key: 'scope', level: 'score-5' }] } }),
    /review.dimensions\[0\].level: is not supported/
  );
});

check('legacy cards-only backup remains accepted without LLD mutation', () => {
  const backup = normalizeLldBackup({ cards: [] });
  assert.equal(backup.format, 'coding-journal-backup');
  assert.equal(backup.schemaVersion, 1);
  assert.deepEqual(backup.cards, []);
  assert.deepEqual(backup.lldDesigns, []);
});

check('versioned backup preserves LLD source and excludes identity fields', () => {
  const source = 'sequenceDiagram\n  Client->>Service: create';
  const backup = normalizeLldBackup({
    format: 'coding-journal-backup',
    schemaVersion: LLD_BACKUP_VERSION,
    cards: [],
    lldDesigns: [{
      id: 'design_1',
      title: 'Library Management',
      diagrams: [{ type: 'sequence', title: 'Borrow flow', source }],
    }],
  });
  assert.equal(backup.schemaVersion, LLD_BACKUP_VERSION);
  assert.equal(backup.lldDesigns[0].id, 'design_1');
  assert.equal(backup.lldDesigns[0].diagrams[0].source, source);
  assert.equal('owner_id' in backup.lldDesigns[0], false);
  assert.equal('userId' in backup.lldDesigns[0], false);
});

check('versioned backup rejects foreign identity fields before normalization', () => {
  assert.throws(
    () => normalizeLldBackup({
      format: 'coding-journal-backup',
      schemaVersion: LLD_BACKUP_VERSION,
      lldDesigns: [{ title: 'Foreign', ownerId: 'user_b' }],
    }),
    /ownerId: must not be supplied by the client/
  );
});

console.log('LLD contract tests passed.');
