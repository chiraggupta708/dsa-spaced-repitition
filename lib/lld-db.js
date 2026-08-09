import { neon } from '@neondatabase/serverless';
import crypto from 'node:crypto';
import { normalizeLldDesign } from './lld-contract.js';
import { upsertUser } from './db.js';

const connectionString =
  process.env.DATABASE_URL ||
  process.env.POSTGRES_URL ||
  process.env.POSTGRES_PRISMA_URL;
const sql = connectionString ? neon(connectionString) : null;

function requireOwner(ownerId) {
  if (typeof ownerId !== 'string' || !ownerId.trim()) throw new Error('ownerId is required');
  return ownerId.trim();
}

function requireId(id, label = 'id') {
  if (typeof id !== 'string' || !id.trim()) throw new Error(`${label} is required`);
  return id.trim();
}

function requireDatabase(action) {
  if (!sql) throw new Error(`DATABASE_URL not set — cannot ${action}`);
  return sql;
}

function generatedId(prefix) {
  return `${prefix}_${crypto.randomUUID()}`;
}

function iso(value) {
  return value ? new Date(value).toISOString() : null;
}

function scheduledReviewAt(readinessState, now) {
  const days = { needs_review: 1, practicing: 3, interview_ready: 7 }[readinessState];
  if (!days) return null;
  const next = new Date(now);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function rowToSection(row) {
  return {
    id: row.id,
    sectionKey: row.section_key,
    title: row.title,
    prompt: row.prompt || '',
    position: row.position,
    contentMd: row.content_md || '',
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

function rowToDiagram(row) {
  return {
    id: row.id,
    title: row.title,
    type: row.diagram_type,
    source: row.source,
    description: row.description || '',
    position: row.position,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

function rowToResource(row) {
  return {
    id: row.id,
    title: row.title,
    url: row.url,
    host: row.host || '',
    type: row.resource_type || 'reference',
    placement: row.placement,
    notesMd: row.notes_md || '',
    position: row.position,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

function emptyCode() {
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

function rowToCode(row) {
  return {
    language: row.language,
    filename: row.filename,
    backgroundMd: row.background_md || '',
    skeletonMd: row.skeleton_md || '',
    methodSignaturesMd: row.method_signatures_md || '',
    source: row.source || '',
    compileStatus: row.compile_status || 'not_run',
    compileOutput: row.compile_output || '',
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

function rowToDimension(row) {
  return {
    key: row.dimension_key,
    level: row.level,
    notesMd: row.notes_md || '',
    reviewedAt: iso(row.reviewed_at),
  };
}

function rowToParent(row) {
  return {
    id: row.id,
    schemaVersion: row.schema_version,
    title: row.title,
    problemStatementMd: row.problem_statement_md || '',
    lifecycleState: row.lifecycle_state,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

function rowToListItem(row) {
  return {
    ...rowToParent(row),
    readinessState: row.readiness_state || row.lifecycle_state,
    nextAction: row.next_action || '',
    nextReviewAt: iso(row.next_review_at),
  };
}

async function loadChildren(db, designId, ownerId) {
  const [sectionRows, diagramRows, resourceRows, dimensionRows, readinessRows, codeRows] = await Promise.all([
    db.query(
      `SELECT id, section_key, title, prompt, position, content_md, created_at, updated_at
       FROM lld_sections WHERE design_id = $1 AND owner_id = $2 ORDER BY position, created_at`,
      [designId, ownerId]
    ),
    db.query(
      `SELECT id, title, diagram_type, source, description, position, created_at, updated_at
       FROM lld_diagrams WHERE design_id = $1 AND owner_id = $2 ORDER BY position, created_at`,
      [designId, ownerId]
    ),
    db.query(
      `SELECT id, title, url, host, resource_type, placement, notes_md, position, created_at, updated_at
       FROM lld_resources WHERE design_id = $1 AND owner_id = $2 ORDER BY position, created_at`,
      [designId, ownerId]
    ),
    db.query(
      `SELECT dimension_key, level, notes_md, reviewed_at
       FROM lld_review_dimensions WHERE design_id = $1 AND owner_id = $2 ORDER BY dimension_key`,
      [designId, ownerId]
    ),
    db.query(
      `SELECT readiness_state, next_action, next_review_at, evaluated_at, updated_at
       FROM lld_readiness WHERE design_id = $1 AND owner_id = $2`,
      [designId, ownerId]
    ),
    db.query(
      `SELECT language, filename, background_md, skeleton_md, method_signatures_md, source, compile_status, compile_output, created_at, updated_at
       FROM lld_code_artifacts WHERE design_id = $1 AND owner_id = $2`,
      [designId, ownerId]
    ),
  ]);
  const readiness = readinessRows[0] || null;
  return {
    sections: sectionRows.map(rowToSection),
    diagrams: diagramRows.map(rowToDiagram),
    resources: resourceRows.map(rowToResource),
    code: codeRows[0] ? rowToCode(codeRows[0]) : emptyCode(),
    review: {
      dimensions: dimensionRows.map(rowToDimension),
      readinessStatus: readiness?.readiness_state || 'draft',
      nextAction: readiness?.next_action || '',
      nextReviewAt: iso(readiness?.next_review_at),
      evaluatedAt: iso(readiness?.evaluated_at),
      updatedAt: iso(readiness?.updated_at),
    },
  };
}

/** Return an owner-scoped LLD library without loading child records. */
export async function listLldDesigns(ownerId) {
  const owner = requireOwner(ownerId);
  if (!sql) return { designs: [] };
  const rows = await sql.query(
    `SELECT d.id, d.schema_version, d.title, d.problem_statement_md, d.lifecycle_state,
            d.created_at, d.updated_at, r.readiness_state, r.next_action, r.next_review_at
     FROM lld_designs d
     LEFT JOIN lld_readiness r ON r.design_id = d.id AND r.owner_id = d.owner_id
     WHERE d.owner_id = $1
     ORDER BY d.updated_at DESC, d.created_at DESC`,
    [owner]
  );
  return { designs: rows.map(rowToListItem) };
}

/** Return one owner-scoped LLD aggregate or null for a missing/foreign ID. */
export async function getLldDesign(id, ownerId) {
  const designId = requireId(id, 'design id');
  const owner = requireOwner(ownerId);
  if (!sql) return null;
  const rows = await sql.query(
    `SELECT id, schema_version, title, problem_statement_md, lifecycle_state, created_at, updated_at
     FROM lld_designs WHERE id = $1 AND owner_id = $2`,
    [designId, owner]
  );
  if (!rows.length) return null;
  const aggregate = await loadChildren(sql, designId, owner);
  return { ...rowToParent(rows[0]), ...aggregate };
}

/** Validate an LLD backup before any import mutation occurs. */
export async function validateLldDesignImports(inputs, ownerId) {
  const owner = requireOwner(ownerId);
  if (!Array.isArray(inputs)) throw new Error('lld.designs must be an array');
  const normalized = inputs.map((input) => normalizeLldDesign(input));
  const ids = normalized.map((design) => design.id).filter(Boolean);
  if (new Set(ids).size !== ids.length) throw new Error('LLD backup contains duplicate design IDs');
  if (!ids.length) return normalized;
  const db = requireDatabase('validate LLD import');
  const rows = await db.query('SELECT id, owner_id FROM lld_designs WHERE id = ANY($1)', [ids]);
  if (rows.some((row) => row.owner_id !== owner)) {
    throw new Error('LLD backup contains a design owned by another user');
  }
  return normalized;
}

/**
 * Save a complete owner-scoped LLD aggregate.
 * Child rows are replaced atomically after the parent owner check succeeds.
 */
export async function saveLldDesign(input, ownerId) {
  const owner = requireOwner(ownerId);
  const normalized = normalizeLldDesign(input);
  const db = requireDatabase('save LLD design');
  const designId = normalized.id || generatedId('lld');
  await upsertUser({ clerkId: owner });

  if (normalized.id) {
    const existing = await db.query('SELECT owner_id FROM lld_designs WHERE id = $1', [designId]);
    if (existing.length && existing[0].owner_id !== owner) {
      throw new Error('design not found or is owned by another user');
    }
  }

  const now = new Date();
  const parentQuery = db`
    INSERT INTO lld_designs
      (id, owner_id, title, problem_statement_md, lifecycle_state, schema_version, created_at, updated_at)
    VALUES
      (${designId}, ${owner}, ${normalized.title}, ${normalized.problemStatementMd},
       ${normalized.lifecycleState}, ${normalized.schemaVersion}, ${now}, ${now})
    ON CONFLICT (id) DO UPDATE SET
      title = EXCLUDED.title,
      problem_statement_md = EXCLUDED.problem_statement_md,
      lifecycle_state = EXCLUDED.lifecycle_state,
      schema_version = EXCLUDED.schema_version,
      updated_at = EXCLUDED.updated_at
    WHERE lld_designs.owner_id = EXCLUDED.owner_id
    RETURNING id
  `;

  const queries = [
    parentQuery,
    db`DELETE FROM lld_sections WHERE design_id = ${designId} AND owner_id = ${owner}`,
    db`DELETE FROM lld_diagrams WHERE design_id = ${designId} AND owner_id = ${owner}`,
    db`DELETE FROM lld_resources WHERE design_id = ${designId} AND owner_id = ${owner}`,
    db`DELETE FROM lld_review_dimensions WHERE design_id = ${designId} AND owner_id = ${owner}`,
    db`DELETE FROM lld_readiness WHERE design_id = ${designId} AND owner_id = ${owner}`,
  ];

  normalized.sections.forEach((section) => {
    queries.push(db`
      INSERT INTO lld_sections
        (id, design_id, owner_id, section_key, title, prompt, position, content_md, created_at, updated_at)
      VALUES
        (${generatedId('section')}, ${designId}, ${owner}, ${section.sectionKey}, ${section.title},
         ${section.prompt}, ${section.position}, ${section.contentMd}, ${now}, ${now})
    `);
  });

  normalized.diagrams.forEach((diagram) => {
    queries.push(db`
      INSERT INTO lld_diagrams
        (id, design_id, owner_id, title, diagram_type, source, description, position, created_at, updated_at)
      VALUES
        (${generatedId('diagram')}, ${designId}, ${owner}, ${diagram.title}, ${diagram.type},
         ${diagram.source}, ${diagram.description}, ${diagram.position}, ${now}, ${now})
    `);
  });

  normalized.resources.forEach((resource) => {
    queries.push(db`
      INSERT INTO lld_resources
        (id, design_id, owner_id, title, url, host, resource_type, placement, notes_md, position, created_at, updated_at)
      VALUES
        (${generatedId('resource')}, ${designId}, ${owner}, ${resource.title}, ${resource.url}, ${resource.host},
         ${resource.type}, ${resource.placement}, ${resource.notesMd}, ${resource.position}, ${now}, ${now})
    `);
  });

  normalized.review.dimensions.forEach((dimension) => {
    queries.push(db`
      INSERT INTO lld_review_dimensions
        (id, design_id, owner_id, dimension_key, level, notes_md, reviewed_at, updated_at)
      VALUES
        (${generatedId('review')}, ${designId}, ${owner}, ${dimension.key}, ${dimension.level},
         ${dimension.notesMd}, ${now}, ${now})
    `);
  });

  queries.push(db`
    INSERT INTO lld_readiness
      (design_id, owner_id, readiness_state, next_action, next_review_at, algorithm_version, evaluated_at, updated_at)
    VALUES
      (${designId}, ${owner}, ${normalized.review.readinessStatus}, ${normalized.review.nextAction}, ${scheduledReviewAt(normalized.review.readinessStatus, now)}, 1, ${now}, ${now})
    ON CONFLICT (design_id) DO UPDATE SET
      readiness_state = EXCLUDED.readiness_state,
      next_action = EXCLUDED.next_action,
      next_review_at = EXCLUDED.next_review_at,
      algorithm_version = EXCLUDED.algorithm_version,
      evaluated_at = EXCLUDED.evaluated_at,
      updated_at = EXCLUDED.updated_at
    WHERE lld_readiness.owner_id = EXCLUDED.owner_id
  `);

  queries.push(db`
    INSERT INTO lld_code_artifacts
      (id, design_id, owner_id, language, filename, background_md, skeleton_md, method_signatures_md, source, compile_status, compile_output, created_at, updated_at)
    VALUES
      (${generatedId('code')}, ${designId}, ${owner}, ${normalized.code.language}, ${normalized.code.filename},
       ${normalized.code.backgroundMd}, ${normalized.code.skeletonMd}, ${normalized.code.methodSignaturesMd},
       ${normalized.code.source}, 'not_run', '', ${now}, ${now})
    ON CONFLICT (design_id, owner_id) DO UPDATE SET
      language = EXCLUDED.language,
      filename = EXCLUDED.filename,
      background_md = EXCLUDED.background_md,
      skeleton_md = EXCLUDED.skeleton_md,
      method_signatures_md = EXCLUDED.method_signatures_md,
      source = EXCLUDED.source,
      compile_status = 'not_run',
      compile_output = '',
      updated_at = EXCLUDED.updated_at
    WHERE lld_code_artifacts.owner_id = EXCLUDED.owner_id
  `);

  queries.push(db`
    INSERT INTO lld_code_artifact_versions
      (id, design_id, owner_id, version_no, language, filename, background_md, skeleton_md, method_signatures_md, source, change_note, created_at)
    SELECT ${generatedId('code_version')}, ${designId}, ${owner}, COALESCE(MAX(version_no), 0) + 1,
           ${normalized.code.language}, ${normalized.code.filename}, ${normalized.code.backgroundMd},
           ${normalized.code.skeletonMd}, ${normalized.code.methodSignaturesMd}, ${normalized.code.source},
           'Notebook save', ${now}
    FROM lld_code_artifact_versions
    WHERE design_id = ${designId} AND owner_id = ${owner}
  `);

  const result = await db.transaction(queries);
  if (!result[0]?.length) throw new Error('design not found or is owned by another user');
  return { ok: true, id: designId };
}

/** Save only the Java design-to-code artifact while preserving the notebook. */
export async function saveLldCode(designId, ownerId, input) {
  const id = requireId(designId, 'design id');
  const owner = requireOwner(ownerId);
  const code = normalizeLldDesign({ title: 'code-update', code: input }).code;
  const db = requireDatabase('save LLD code');
  const designRows = await db.query(
    'SELECT id FROM lld_designs WHERE id = $1 AND owner_id = $2',
    [id, owner]
  );
  if (!designRows.length) throw new Error('Design not found');
  const now = new Date();
  await db.transaction([
    db`
      INSERT INTO lld_code_artifacts
        (id, design_id, owner_id, language, filename, background_md, skeleton_md, method_signatures_md, source, compile_status, compile_output, created_at, updated_at)
      VALUES
        (${generatedId('code')}, ${id}, ${owner}, ${code.language}, ${code.filename}, ${code.backgroundMd},
         ${code.skeletonMd}, ${code.methodSignaturesMd}, ${code.source}, 'not_run', '', ${now}, ${now})
      ON CONFLICT (design_id, owner_id) DO UPDATE SET
        language = EXCLUDED.language,
        filename = EXCLUDED.filename,
        background_md = EXCLUDED.background_md,
        skeleton_md = EXCLUDED.skeleton_md,
        method_signatures_md = EXCLUDED.method_signatures_md,
        source = EXCLUDED.source,
        compile_status = 'not_run',
        compile_output = '',
        updated_at = EXCLUDED.updated_at
      WHERE lld_code_artifacts.owner_id = EXCLUDED.owner_id
    `,
    db`
      INSERT INTO lld_code_artifact_versions
        (id, design_id, owner_id, version_no, language, filename, background_md, skeleton_md, method_signatures_md, source, change_note, created_at)
      SELECT ${generatedId('code_version')}, ${id}, ${owner}, COALESCE(MAX(version_no), 0) + 1,
             ${code.language}, ${code.filename}, ${code.backgroundMd}, ${code.skeletonMd},
             ${code.methodSignaturesMd}, ${code.source}, 'Design-to-code phase', ${now}
      FROM lld_code_artifact_versions
      WHERE design_id = ${id} AND owner_id = ${owner}
    `,
  ]);
  return { ok: true, code };
}

export async function getLldCodeVersions(designId, ownerId) {
  const id = requireId(designId, 'design id');
  const owner = requireOwner(ownerId);
  const db = requireDatabase('read LLD code history');
  const rows = await db.query(
    `SELECT version_no, language, filename, background_md, skeleton_md, method_signatures_md,
            source, change_note, created_at
     FROM lld_code_artifact_versions WHERE design_id = $1 AND owner_id = $2
     ORDER BY version_no DESC LIMIT 20`,
    [id, owner]
  );
  return {
    versions: rows.map((row) => ({
      versionNo: row.version_no,
      language: row.language,
      filename: row.filename,
      backgroundMd: row.background_md || '',
      skeletonMd: row.skeleton_md || '',
      methodSignaturesMd: row.method_signatures_md || '',
      source: row.source || '',
      changeNote: row.change_note || '',
      createdAt: iso(row.created_at),
    })),
  };
}

/** Delete only an LLD aggregate owned by ownerId. */
export async function deleteLldDesign(id, ownerId) {
  const designId = requireId(id, 'design id');
  const owner = requireOwner(ownerId);
  const db = requireDatabase('delete LLD design');
  const rows = await db.query(
    'DELETE FROM lld_designs WHERE id = $1 AND owner_id = $2 RETURNING id',
    [designId, owner]
  );
  return { ok: true, deleted: rows.length > 0 };
}
