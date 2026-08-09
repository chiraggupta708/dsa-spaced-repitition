const MAX_ID_LENGTH = 128;
const MAX_TITLE_LENGTH = 200;
const MAX_MARKDOWN_LENGTH = 50_000;
const MAX_MERMAID_LENGTH = 20_000;
const MAX_SECTIONS = 7;
const MAX_DIAGRAMS = 2;
const MAX_RESOURCES = 20;
const MAX_TAGS = 12;

export const LLD_SCHEMA_VERSION = 1;
export const LLD_BACKUP_VERSION = 2;

export const LLD_LIFECYCLE_STATES = Object.freeze([
  'draft',
  'practicing',
  'needs_review',
  'interview_ready',
  'archived',
]);

export const LLD_DIAGRAM_TYPES = Object.freeze(['class', 'sequence']);
export const LLD_REVIEW_LEVELS = Object.freeze(['missed', 'partial', 'clear']);
export const LLD_REVIEW_DIMENSIONS = Object.freeze([
  'scope',
  'ownership',
  'flow',
  'pattern_edge_case',
]);
export const LLD_RESOURCE_PLACEMENTS = Object.freeze(['before_attempt', 'after_attempt']);
export const LLD_CODE_STATUSES = Object.freeze(['not_run', 'passed', 'failed']);

const MAX_CODE_FILENAME_LENGTH = 160;
const MAX_CODE_SOURCE_LENGTH = 200_000;
const MAX_CODE_BACKGROUND_LENGTH = 20_000;
const MAX_CODE_SKELETON_LENGTH = 20_000;
const MAX_CODE_METHOD_SIGNATURES_LENGTH = 20_000;

const SECTION_DEFINITIONS = Object.freeze([
  { key: 'functional_requirements', title: 'Functional requirements', prompt: 'Observable user and system behavior, outcomes, and explicit v1 scope.' },
  { key: 'nfr', title: 'Non-functional requirements', prompt: 'Measurable quality guarantees, constraints, and deliberate v1 tradeoffs.' },
  { key: 'model', title: 'Model', prompt: 'Classes, responsibilities, relationships, and ownership.' },
  { key: 'diagram', title: 'Diagram', prompt: 'One editable Mermaid diagram that makes the model visible.' },
  { key: 'flow_tradeoffs', title: 'Flow and tradeoffs', prompt: 'Primary flow, edge cases, patterns, and rejected alternatives.' },
  { key: 'review', title: 'Review', prompt: 'Weak dimensions, follow-up questions, and the next drill.' },
  { key: 'scope', title: 'Scope (legacy)', prompt: 'Legacy combined requirements, assumptions, constraints, and out of scope.', legacy: true },
]);

const FORBIDDEN_IDENTITY_KEYS = new Set([
  'owner_id',
  'ownerId',
  'clerk_id',
  'clerkId',
  'user_id',
  'userId',
  'email',
]);

const FORBIDDEN_MERMAID_PATTERNS = [
  /<\s*script\b/i,
  /<\s*iframe\b/i,
  /<\s*object\b/i,
  /<\s*embed\b/i,
  /javascript\s*:/i,
  /\bclick\b/i,
  /\bhref\s*:/i,
  /\bcallback\s*:/i,
  /%%\s*\{/i,
];

function fail(path, message) {
  throw new TypeError(`${path}: ${message}`);
}

function record(value, path) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail(path, 'expected an object');
  }
  return value;
}

function text(value, path, { defaultValue = '', maxLength = MAX_MARKDOWN_LENGTH, required = false } = {}) {
  if (value === undefined || value === null) {
    if (defaultValue !== '') return defaultValue;
    if (required) fail(path, 'is required');
    return defaultValue;
  }
  if (typeof value !== 'string') fail(path, 'must be a string');
  if (value.length > maxLength) fail(path, `must be at most ${maxLength} characters`);
  if (required && !value.trim()) fail(path, 'must not be blank');
  return value;
}

function boundedArray(value, path, maxLength) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) fail(path, 'must be an array');
  if (value.length > maxLength) fail(path, `must contain at most ${maxLength} items`);
  return value;
}

function id(value, path, { required = false } = {}) {
  const result = text(value, path, { defaultValue: '', maxLength: MAX_ID_LENGTH, required });
  if (result && !/^[A-Za-z0-9_-]+$/.test(result)) {
    fail(path, 'may contain only letters, numbers, underscore, and hyphen');
  }
  return result;
}

function integer(value, path, defaultValue) {
  if (value === undefined || value === null) return defaultValue;
  if (!Number.isInteger(value) || value < 0) fail(path, 'must be a non-negative integer');
  return value;
}

function uniqueStrings(values, path, maxLength, maxItems) {
  const list = boundedArray(values, path, maxItems);
  const result = [];
  const seen = new Set();
  list.forEach((value, index) => {
    const item = text(value, `${path}[${index}]`, { maxLength: maxLength, required: true }).trim();
    const key = item.toLowerCase();
    if (seen.has(key)) fail(`${path}[${index}]`, 'must be unique');
    seen.add(key);
    result.push(item);
  });
  return result;
}

export function assertNoClientIdentity(value, path = 'payload', seen = new Set()) {
  if (!value || typeof value !== 'object') return;
  if (seen.has(value)) fail(path, 'must not contain cyclic data');
  seen.add(value);
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoClientIdentity(item, `${path}[${index}]`, seen));
    seen.delete(value);
    return;
  }
  Object.entries(value).forEach(([key, child]) => {
    if (FORBIDDEN_IDENTITY_KEYS.has(key)) fail(`${path}.${key}`, 'must not be supplied by the client');
    assertNoClientIdentity(child, `${path}.${key}`, seen);
  });
  seen.delete(value);
}

export function normalizeLldCode(value) {
  if (value === undefined || value === null) {
    return {
      language: 'java',
      filename: 'Main.java',
      backgroundMd: '',
      skeletonMd: '',
      methodSignaturesMd: '',
      source: '',
      compileStatus: 'not_run',
      compileOutput: '',
    };
  }
  const code = record(value, 'code');
  assertNoClientIdentity(code, 'code');
  if (code.compileStatus !== undefined || code.compileOutput !== undefined) {
    fail('code.compileStatus', 'is server-managed and must not be supplied');
  }
  const language = text(code.language, 'code.language', { defaultValue: 'java', maxLength: 20 }).trim().toLowerCase();
  if (language !== 'java') fail('code.language', 'must be java in V1');
  const filename = text(code.filename, 'code.filename', {
    defaultValue: 'Main.java',
    maxLength: MAX_CODE_FILENAME_LENGTH,
    required: true,
  }).trim();
  if (!/^[A-Za-z][A-Za-z0-9_]*\.java$/.test(filename)) {
    fail('code.filename', 'must be a safe Java filename ending in .java');
  }
  return {
    language,
    filename,
    backgroundMd: text(code.backgroundMd, 'code.backgroundMd', { maxLength: MAX_CODE_BACKGROUND_LENGTH }),
    skeletonMd: text(code.skeletonMd, 'code.skeletonMd', { maxLength: MAX_CODE_SKELETON_LENGTH }),
    methodSignaturesMd: text(code.methodSignaturesMd, 'code.methodSignaturesMd', {
      maxLength: MAX_CODE_METHOD_SIGNATURES_LENGTH,
    }),
    source: text(code.source, 'code.source', { maxLength: MAX_CODE_SOURCE_LENGTH }),
    compileStatus: 'not_run',
    compileOutput: '',
  };
}

export function standardLldSections() {
  return SECTION_DEFINITIONS.filter((section) => !section.legacy).map((section, position) => ({
    sectionKey: section.key,
    title: section.title,
    prompt: section.prompt,
    position,
    contentMd: '',
  }));
}

export function validateMermaidSource(source, path = 'source', expectedType = null) {
  const value = text(source, path, { maxLength: MAX_MERMAID_LENGTH, required: true });
  const firstMeaningfulLine = value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line && !line.startsWith('%%'));
  const detectedType = firstMeaningfulLine?.startsWith('classDiagram')
    ? 'class'
    : firstMeaningfulLine?.startsWith('sequenceDiagram')
      ? 'sequence'
      : null;
  if (!detectedType) fail(path, 'must begin with classDiagram or sequenceDiagram');
  if (expectedType && detectedType !== expectedType) {
    fail(path, `must contain a ${expectedType} diagram`);
  }
  const forbidden = FORBIDDEN_MERMAID_PATTERNS.find((pattern) => pattern.test(value));
  if (forbidden) fail(path, 'contains an unsupported directive, link, callback, or HTML construct');
  return { source: value, type: detectedType };
}

function normalizeSections(value) {
  const sections = boundedArray(value, 'sections', MAX_SECTIONS);
  if (!sections.length) return standardLldSections();
  const allowed = new Set(SECTION_DEFINITIONS.map((section) => section.key));
  const seen = new Set();
  return sections.map((item, index) => {
    const section = record(item, `sections[${index}]`);
    const sectionKey = text(section.sectionKey, `sections[${index}].sectionKey`, {
      maxLength: 40,
      required: true,
    });
    if (!allowed.has(sectionKey)) fail(`sections[${index}].sectionKey`, 'is not a V1 section');
    if (seen.has(sectionKey)) fail(`sections[${index}].sectionKey`, 'must be unique');
    seen.add(sectionKey);
    const definition = SECTION_DEFINITIONS.find((candidate) => candidate.key === sectionKey);
    return {
      sectionKey,
      title: text(section.title, `sections[${index}].title`, {
        defaultValue: definition.title,
        maxLength: MAX_TITLE_LENGTH,
        required: true,
      }),
      prompt: text(section.prompt, `sections[${index}].prompt`, {
        defaultValue: definition.prompt,
        maxLength: 500,
      }),
      position: integer(section.position, `sections[${index}].position`, index),
      contentMd: text(section.contentMd, `sections[${index}].contentMd`),
    };
  }).sort((left, right) => left.position - right.position);
}

function normalizeDiagrams(value) {
  return boundedArray(value, 'diagrams', MAX_DIAGRAMS).map((item, index) => {
    const diagram = record(item, `diagrams[${index}]`);
    const type = text(diagram.type, `diagrams[${index}].type`, {
      maxLength: 20,
      required: true,
    });
    if (!LLD_DIAGRAM_TYPES.includes(type)) fail(`diagrams[${index}].type`, 'is not supported in V1');
    const validated = validateMermaidSource(diagram.source, `diagrams[${index}].source`, type);
    return {
      id: id(diagram.id, `diagrams[${index}].id`),
      title: text(diagram.title, `diagrams[${index}].title`, {
        defaultValue: type === 'class' ? 'Class diagram' : 'Sequence diagram',
        maxLength: MAX_TITLE_LENGTH,
        required: true,
      }),
      type,
      source: validated.source,
      description: text(diagram.description, `diagrams[${index}].description`, { maxLength: 1_000 }),
      position: integer(diagram.position, `diagrams[${index}].position`, index),
    };
  }).sort((left, right) => left.position - right.position);
}

function normalizeResources(value) {
  return boundedArray(value, 'resources', MAX_RESOURCES).map((item, index) => {
    const resource = record(item, `resources[${index}]`);
    const url = text(resource.url, `resources[${index}].url`, { maxLength: 2_048, required: true });
    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      fail(`resources[${index}].url`, 'must be a valid URL');
    }
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) {
      fail(`resources[${index}].url`, 'must use a credential-free http or https URL');
    }
    const placement = resource.placement || 'after_attempt';
    if (!LLD_RESOURCE_PLACEMENTS.includes(placement)) {
      fail(`resources[${index}].placement`, 'is not supported');
    }
    return {
      id: id(resource.id, `resources[${index}].id`),
      title: text(resource.title, `resources[${index}].title`, {
        maxLength: MAX_TITLE_LENGTH,
        required: true,
      }),
      url,
      host: parsed.host,
      type: text(resource.type, `resources[${index}].type`, { defaultValue: 'reference', maxLength: 40 }),
      placement,
      notesMd: text(resource.notesMd, `resources[${index}].notesMd`, { maxLength: 5_000 }),
      position: integer(resource.position, `resources[${index}].position`, index),
    };
  }).sort((left, right) => left.position - right.position);
}

function normalizeReview(value) {
  if (value === undefined || value === null) return { dimensions: [], readinessStatus: 'draft', nextAction: '' };
  const review = record(value, 'review');
  const dimensions = boundedArray(review.dimensions, 'review.dimensions', LLD_REVIEW_DIMENSIONS.length).map((item, index) => {
    const dimension = record(item, `review.dimensions[${index}]`);
    const key = text(dimension.key, `review.dimensions[${index}].key`, { maxLength: 40, required: true });
    if (!LLD_REVIEW_DIMENSIONS.includes(key)) fail(`review.dimensions[${index}].key`, 'is not supported');
    const level = text(dimension.level, `review.dimensions[${index}].level`, { maxLength: 20, required: true });
    if (!LLD_REVIEW_LEVELS.includes(level)) fail(`review.dimensions[${index}].level`, 'is not supported');
    return { key, level, notesMd: text(dimension.notesMd, `review.dimensions[${index}].notesMd`, { maxLength: 2_000 }) };
  });
  const readinessStatus = review.readinessStatus || 'draft';
  if (!LLD_LIFECYCLE_STATES.includes(readinessStatus)) fail('review.readinessStatus', 'is not supported');
  return {
    dimensions,
    readinessStatus,
    nextAction: text(review.nextAction, 'review.nextAction', { maxLength: 500 }),
  };
}

export function normalizeLldReview(input) {
  const source = record(input, 'review');
  assertNoClientIdentity(source, 'review');
  return normalizeReview(source);
}

export function normalizeLldDesign(input) {
  const source = record(input, 'design');
  assertNoClientIdentity(source, 'design');
  const lifecycleState = source.lifecycleState || 'draft';
  if (!LLD_LIFECYCLE_STATES.includes(lifecycleState)) fail('design.lifecycleState', 'is not supported');
  return {
    schemaVersion: LLD_SCHEMA_VERSION,
    id: id(source.id, 'design.id'),
    title: text(source.title, 'design.title', { maxLength: MAX_TITLE_LENGTH, required: true }).trim(),
    problemStatementMd: text(source.problemStatementMd, 'design.problemStatementMd'),
    sections: normalizeSections(source.sections),
    diagrams: normalizeDiagrams(source.diagrams),
    resources: normalizeResources(source.resources),
    code: normalizeLldCode(source.code),
    review: normalizeReview(source.review),
    lifecycleState,
    tags: uniqueStrings(source.tags, 'design.tags', 40, MAX_TAGS),
  };
}

export function normalizeLldBackup(input) {
  const source = record(input, 'backup');
  assertNoClientIdentity(source, 'backup');
  const isLegacyCardsOnly = source.format === undefined
    && source.schemaVersion === undefined
    && source.lldDesigns === undefined
    && Array.isArray(source.cards);
  if (isLegacyCardsOnly) {
    return {
      format: 'coding-journal-backup',
      schemaVersion: 1,
      cards: source.cards,
      lldDesigns: [],
    };
  }
  if (source.format !== 'coding-journal-backup') fail('backup.format', 'must be coding-journal-backup');
  if (![1, LLD_BACKUP_VERSION].includes(source.schemaVersion)) {
    fail('backup.schemaVersion', `must be 1 or ${LLD_BACKUP_VERSION}`);
  }
  if (source.cards !== undefined && !Array.isArray(source.cards)) fail('backup.cards', 'must be an array');
  const lldDesigns = boundedArray(source.lldDesigns, 'backup.lldDesigns', 500).map(normalizeLldDesign);
  return {
    format: source.format,
    schemaVersion: source.schemaVersion,
    cards: source.cards || [],
    lldDesigns,
  };
}
