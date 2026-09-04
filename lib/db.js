/**
 * Owner-scoped Neon SQL data layer.
 * All card and design access requires the authenticated Clerk owner ID.
 */

import { neon } from '@neondatabase/serverless';
import crypto from 'node:crypto';

const connectionString =
  process.env.DATABASE_URL ||
  process.env.POSTGRES_URL ||
  process.env.POSTGRES_PRISMA_URL;

const sql = connectionString ? neon(connectionString) : null;

function requireOwner(ownerId) {
  if (typeof ownerId !== 'string' || !ownerId.trim()) {
    throw new Error('ownerId is required');
  }
  return ownerId.trim();
}

function requireId(id, label = 'id') {
  if (typeof id !== 'string' || !id.trim()) {
    throw new Error(`${label} is required`);
  }
  return id.trim();
}

function requireDatabase(action) {
  if (!sql) throw new Error(`DATABASE_URL not set — cannot ${action}`);
  return sql;
}

export function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

export function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export function defaultSm2() {
  return {
    easinessFactor: 2.5,
    interval: 0,
    repetitions: 0,
    nextReview: null,
    lastReview: null,
    lastQuality: null,
  };
}

function rowToCard(row) {
  const tags = Array.isArray(row.tags) ? row.tags.map((tag) => tag.name || tag) : [];
  return {
    id: row.id,
    created: row.created_at ? new Date(row.created_at).toISOString().slice(0, 10) : todayISO(),
    updated: row.updated_at ? new Date(row.updated_at).toISOString().slice(0, 10) : todayISO(),
    question: row.question || '',
    answer: row.answer || '',
    link: row.link || '',
    tags,
    difficulty: row.difficulty || 'medium',
    actual_code: row.actual_code || '',
    my_thinking: row.my_thinking || '',
    right_thinking: row.right_thinking || '',
    notes: row.notes || '',
    questionDescription: row.question_description || '',
    sm2: {
      easinessFactor: row.easiness_factor ?? 2.5,
      interval: row.interval ?? 0,
      repetitions: row.repetitions ?? 0,
      nextReview: row.next_review ? new Date(row.next_review).toISOString().slice(0, 10) : null,
      lastReview: row.last_review ? new Date(row.last_review).toISOString().slice(0, 10) : null,
      lastQuality: row.last_quality ?? null,
    },
  };
}

function rowToCardSummary(row) {
  const tags = Array.isArray(row.tags) ? row.tags.map((tag) => tag.name || tag) : [];
  return {
    id: row.id,
    created: row.created_at ? new Date(row.created_at).toISOString().slice(0, 10) : todayISO(),
    updated: row.updated_at ? new Date(row.updated_at).toISOString().slice(0, 10) : todayISO(),
    question: row.question || '',
    link: row.link || '',
    tags,
    difficulty: row.difficulty || 'medium',
    sm2: {
      easinessFactor: row.easiness_factor ?? 2.5,
      interval: row.interval ?? 0,
      repetitions: row.repetitions ?? 0,
      nextReview: row.next_review ? new Date(row.next_review).toISOString().slice(0, 10) : null,
      lastReview: row.last_review ? new Date(row.last_review).toISOString().slice(0, 10) : null,
      lastQuality: row.last_quality ?? null,
    },
  };
}

function validateCard(card) {
  if (!card || typeof card !== 'object' || Array.isArray(card)) {
    throw new Error('card must be an object');
  }
  return { ...card, id: requireId(card.id, 'card.id') };
}

async function replaceCardTags(card, ownerId) {
  const db = requireDatabase('save');
  await db.query(
    `DELETE FROM cards_tags ct
     USING cards c
     WHERE ct.card_id = c.id AND c.id = $1 AND c.owner_id = $2`,
    [card.id, ownerId]
  );

  for (const tagName of Array.isArray(card.tags) ? card.tags : []) {
    const name = String(tagName).trim().toLowerCase();
    if (!name) continue;
    const tagRows = await db.query(
      `INSERT INTO tags (id, name) VALUES ($1, $2)
       ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name
       RETURNING id`,
      [crypto.randomUUID(), name]
    );
    await db.query(
      `INSERT INTO cards_tags (card_id, tag_id)
       SELECT c.id, $2 FROM cards c WHERE c.id = $1 AND c.owner_id = $3
       ON CONFLICT DO NOTHING`,
      [card.id, tagRows[0].id, ownerId]
    );
  }
}

/** Create or update the authenticated user profile by Clerk ID. */
export async function upsertUser({ clerkId, email, displayName } = {}) {
  const id = requireId(clerkId, 'clerkId');
  const db = requireDatabase('upsert user');
  const rows = await db.query(
    `INSERT INTO users (clerk_id, email, display_name)
     VALUES ($1, $2, $3)
     ON CONFLICT (clerk_id) DO UPDATE SET
       email = COALESCE(EXCLUDED.email, users.email),
       display_name = COALESCE(EXCLUDED.display_name, users.display_name),
       updated_at = NOW()
     RETURNING clerk_id, email, display_name`,
    [id, email ?? null, displayName ?? null]
  );
  return rows[0];
}

/** Load cards belonging only to ownerId. */
export async function load(ownerId) {
  const owner = requireOwner(ownerId);
  if (!sql) return { cards: [] };
  const rows = await sql.query(
    `SELECT c.*,
            COALESCE(json_agg(json_build_object('id', t.id, 'name', t.name))
              FILTER (WHERE t.id IS NOT NULL), '[]'::json) AS tags
     FROM cards c
     LEFT JOIN cards_tags ct ON ct.card_id = c.id
     LEFT JOIN tags t ON t.id = ct.tag_id
     WHERE c.owner_id = $1
     GROUP BY c.id
     ORDER BY c.created_at DESC`,
    [owner]
  );
  return { cards: rows.map(rowToCard) };
}

/** Fetch one full card without loading the owner's entire collection. */
export async function getCard(id, ownerId) {
  const cardId = requireId(id, 'card id');
  const owner = requireOwner(ownerId);
  if (!sql) return null;
  const rows = await sql.query(
    `SELECT c.*,
            COALESCE(json_agg(json_build_object('id', t.id, 'name', t.name))
              FILTER (WHERE t.id IS NOT NULL), '[]'::json) AS tags
     FROM cards c
     LEFT JOIN cards_tags ct ON ct.card_id = c.id
     LEFT JOIN tags t ON t.id = ct.tag_id
     WHERE c.id = $1 AND c.owner_id = $2
     GROUP BY c.id`,
    [cardId, owner]
  );
  return rows.length ? rowToCard(rows[0]) : null;
}

/** Load only list/review metadata, omitting large card body fields. */
export async function loadCardSummaries(ownerId, options = {}) {
  const owner = requireOwner(ownerId);
  if (!sql) return { cards: [] };

  const query = typeof options.query === 'string' ? options.query.trim().slice(0, 200) : '';
  const params = [owner];
  let where = 'WHERE c.owner_id = $1';
  if (query) {
    params.push(`%${query.replace(/[\\%_]/g, '\\$&')}%`);
    where += ` AND (
      c.question ILIKE $2 OR c.answer ILIKE $2 OR c.link ILIKE $2
      OR c.actual_code ILIKE $2 OR c.my_thinking ILIKE $2 OR c.right_thinking ILIKE $2
      OR c.notes ILIKE $2 OR c.question_description ILIKE $2
      OR EXISTS (
        SELECT 1 FROM cards_tags search_ct
        JOIN tags search_t ON search_t.id = search_ct.tag_id
        WHERE search_ct.card_id = c.id AND search_t.name ILIKE $2
      )
    )`;
  }

  const rows = await sql.query(
    `SELECT c.id, c.created_at, c.updated_at, c.question, c.link, c.difficulty,
            c.easiness_factor, c.interval, c.repetitions, c.next_review,
            c.last_review, c.last_quality,
            COALESCE(json_agg(json_build_object('id', t.id, 'name', t.name))
              FILTER (WHERE t.id IS NOT NULL), '[]'::json) AS tags
     FROM cards c
     LEFT JOIN cards_tags ct ON ct.card_id = c.id
     LEFT JOIN tags t ON t.id = ct.tag_id
     ${where}
     GROUP BY c.id
     ORDER BY c.created_at DESC`,
    params
  );
  return { cards: rows.map(rowToCardSummary) };
}

/** Load a bounded owner-scoped batch of full due cards. */
export async function loadDueCards(ownerId, options = {}) {
  const owner = requireOwner(ownerId);
  if (!sql) return { cards: [], hasMore: false };

  const opts = options || {};
  const requestedLimit = Number(opts.limit);
  const limit = Number.isInteger(requestedLimit) && requestedLimit > 0
    ? Math.min(requestedLimit, 50)
    : 5;
  const excludeIds = Array.isArray(opts.excludeIds)
    ? [...new Set(opts.excludeIds.map((id) => String(id).trim()).filter(Boolean))]
    : [];
  const rows = await sql.query(
    `SELECT c.*,
            COALESCE(json_agg(json_build_object('id', t.id, 'name', t.name))
              FILTER (WHERE t.id IS NOT NULL), '[]'::json) AS tags,
            COUNT(*) OVER () AS due_count
     FROM cards c
     LEFT JOIN cards_tags ct ON ct.card_id = c.id
     LEFT JOIN tags t ON t.id = ct.tag_id
     WHERE c.owner_id = $1
       AND (c.next_review IS NULL OR c.next_review <= $2)
       AND NOT (c.id = ANY($3::text[]))
     GROUP BY c.id
     ORDER BY CASE WHEN c.next_review IS NULL THEN 0 ELSE 1 END,
              c.next_review ASC,
              COALESCE(c.easiness_factor, 2.5) ASC,
              c.id ASC
     LIMIT $4`,
    [owner, todayISO(), excludeIds, limit]
  );
  const cards = rows.map(rowToCard);
  const dueCount = rows.length ? Number(rows[0].due_count) : 0;
  return { cards, hasMore: dueCount > cards.length };
}


export async function upsertCard(inputCard, ownerId) {
  const owner = requireOwner(ownerId);
  const card = validateCard(inputCard);
  const db = requireDatabase('save');
  const sm2 = card.sm2 || {};
  const createdAt = card.created ? new Date(card.created) : new Date();
  const updatedAt = card.updated ? new Date(card.updated) : new Date();
  const rows = await db.query(
    `INSERT INTO cards (id, owner_id, created_at, updated_at, question, answer, link,
       difficulty, actual_code, my_thinking, right_thinking, notes, question_description,
       easiness_factor, interval, repetitions, next_review, last_review, last_quality)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
     ON CONFLICT (id) DO UPDATE SET
       updated_at = EXCLUDED.updated_at, question = EXCLUDED.question, answer = EXCLUDED.answer,
       link = EXCLUDED.link, difficulty = EXCLUDED.difficulty, actual_code = EXCLUDED.actual_code,
       my_thinking = EXCLUDED.my_thinking, right_thinking = EXCLUDED.right_thinking,
       notes = EXCLUDED.notes, question_description = EXCLUDED.question_description,
       easiness_factor = EXCLUDED.easiness_factor, interval = EXCLUDED.interval,
       repetitions = EXCLUDED.repetitions, next_review = EXCLUDED.next_review,
       last_review = EXCLUDED.last_review, last_quality = EXCLUDED.last_quality
     WHERE cards.owner_id = EXCLUDED.owner_id
     RETURNING id`,
    [card.id, owner, createdAt, updatedAt, card.question || '', card.answer || '', card.link || '',
      card.difficulty || 'medium', card.actual_code || '', card.my_thinking || '',
      card.right_thinking || '', card.notes || '', card.questionDescription || '',
      sm2.easinessFactor ?? 2.5, sm2.interval ?? 0, sm2.repetitions ?? 0,
      sm2.nextReview ? new Date(sm2.nextReview) : null,
      sm2.lastReview ? new Date(sm2.lastReview) : null, sm2.lastQuality ?? null]
  );
  if (!rows.length) throw new Error('card not found or is owned by another user');
  await replaceCardTags(card, owner);
  return { ok: true, id: rows[0].id };
}

/** Import a card only when it already belongs to the owner or is an unowned legacy row. */
async function upsertImportedCard(inputCard, ownerId) {
  const owner = requireOwner(ownerId);
  const card = validateCard(inputCard);
  const db = requireDatabase('save');
  const sm2 = card.sm2 || {};
  const createdAt = card.created ? new Date(card.created) : new Date();
  const updatedAt = card.updated ? new Date(card.updated) : new Date();
  const rows = await db.query(
    `INSERT INTO cards (id, owner_id, created_at, updated_at, question, answer, link,
       difficulty, actual_code, my_thinking, right_thinking, notes, question_description,
       easiness_factor, interval, repetitions, next_review, last_review, last_quality)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
     ON CONFLICT (id) DO UPDATE SET
       owner_id = EXCLUDED.owner_id,
       updated_at = EXCLUDED.updated_at, question = EXCLUDED.question, answer = EXCLUDED.answer,
       link = EXCLUDED.link, difficulty = EXCLUDED.difficulty, actual_code = EXCLUDED.actual_code,
       my_thinking = EXCLUDED.my_thinking, right_thinking = EXCLUDED.right_thinking,
       notes = EXCLUDED.notes, question_description = EXCLUDED.question_description,
       easiness_factor = EXCLUDED.easiness_factor, interval = EXCLUDED.interval,
       repetitions = EXCLUDED.repetitions, next_review = EXCLUDED.next_review,
       last_review = EXCLUDED.last_review, last_quality = EXCLUDED.last_quality
     WHERE (cards.owner_id = EXCLUDED.owner_id OR cards.owner_id IS NULL)
     RETURNING id`,
    [card.id, owner, createdAt, updatedAt, card.question || '', card.answer || '', card.link || '',
      card.difficulty || 'medium', card.actual_code || '', card.my_thinking || '',
      card.right_thinking || '', card.notes || '', card.questionDescription || '',
      sm2.easinessFactor ?? 2.5, sm2.interval ?? 0, sm2.repetitions ?? 0,
      sm2.nextReview ? new Date(sm2.nextReview) : null,
      sm2.lastReview ? new Date(sm2.lastReview) : null, sm2.lastQuality ?? null]
  );
  if (!rows.length) throw new Error('card not found or is owned by another user');
  await replaceCardTags(card, owner);
  return { ok: true, id: rows[0].id };
}

/** Delete only the card identified by id that belongs to ownerId. */
export async function deleteCard(id, ownerId) {
  const cardId = requireId(id, 'card id');
  const owner = requireOwner(ownerId);
  const db = requireDatabase('delete');
  const rows = await db.query(
    'DELETE FROM cards WHERE id = $1 AND owner_id = $2 RETURNING id',
    [cardId, owner]
  );
  return { ok: true, deleted: rows.length > 0 };
}

/** Safely replace a single owner's non-empty card collection. */
export async function replaceCardsForOwner(cards, ownerId) {
  const owner = requireOwner(ownerId);
  if (!Array.isArray(cards)) throw new Error('replaceCardsForOwner() expects cards array');
  const validated = cards.map(validateCard);
  for (const card of validated) await upsertImportedCard(card, owner);
  if (validated.length > 0) {
    const db = requireDatabase('replace cards');
    await db.query(
      'DELETE FROM cards WHERE owner_id = $1 AND id <> ALL($2)',
      [owner, validated.map((card) => card.id)]
    );
  }
  return { ok: true, count: validated.length };
}

const DESIGN_COLS = [
  'id', 'kind', 'title', 'requirements', 'my_approach', 'canonical_approach',
  'components', 'relationships', 'patterns', 'api', 'estimations',
  'tradeoffs', 'notes', 'created_at', 'updated_at',
];

function rowToDesign(row) {
  const tags = Array.isArray(row.tags) ? row.tags.map((tag) => tag.name || tag) : [];
  const design = { tags };
  DESIGN_COLS.forEach((column) => { design[column] = row[column]; });
  return design;
}

/** Load designs owned only by ownerId; opts.kind and opts.tag remain supported. */
export async function loadDesigns(opts, ownerId) {
  const owner = requireOwner(ownerId);
  if (!sql) return { designs: [] };
  const options = opts || {};
  const params = [owner];
  let where = 'WHERE d.owner_id = $1';
  if (options.kind) {
    params.push(options.kind);
    where += ` AND d.kind = $${params.length}`;
  }
  const rows = await sql.query(
    `SELECT d.*,
            COALESCE(json_agg(json_build_object('id', t.id, 'name', t.name))
              FILTER (WHERE t.id IS NOT NULL), '[]'::json) AS tags
     FROM designs d
     LEFT JOIN designs_tags dt ON dt.design_id = d.id
     LEFT JOIN tags t ON t.id = dt.tag_id
     ${where}
     GROUP BY d.id
     ORDER BY d.created_at DESC`,
    params
  );
  let designs = rows.map(rowToDesign);
  if (options.tag) {
    const tag = String(options.tag).toLowerCase();
    designs = designs.filter((design) => design.tags.some((value) => String(value).toLowerCase() === tag));
  }
  return { designs };
}

async function replaceDesignTags(design, ownerId) {
  const db = requireDatabase('save');
  await db.query(
    `DELETE FROM designs_tags dt
     USING designs d
     WHERE dt.design_id = d.id AND d.id = $1 AND d.owner_id = $2`,
    [design.id, ownerId]
  );
  for (const tagName of Array.isArray(design.tags) ? design.tags : []) {
    const name = String(tagName).trim().toLowerCase();
    if (!name) continue;
    const tagRows = await db.query(
      `INSERT INTO tags (id, name) VALUES ($1, $2)
       ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name RETURNING id`,
      [crypto.randomUUID(), name]
    );
    await db.query(
      `INSERT INTO designs_tags (design_id, tag_id)
       SELECT d.id, $2 FROM designs d WHERE d.id = $1 AND d.owner_id = $3
       ON CONFLICT DO NOTHING`,
      [design.id, tagRows[0].id, ownerId]
    );
  }
}

/** Insert or update a design only when its existing row belongs to ownerId. */
export async function saveDesign(inputDesign, ownerId) {
  const owner = requireOwner(ownerId);
  if (!inputDesign || typeof inputDesign !== 'object') throw new Error('design must be an object');
  const db = requireDatabase('save');
  const id = inputDesign.id ? requireId(inputDesign.id, 'design.id') : generateId();
  const now = new Date();
  const rows = await db.query(
    `INSERT INTO designs (id, owner_id, kind, title, requirements, my_approach,
       canonical_approach, components, relationships, patterns, api, estimations,
       tradeoffs, notes, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
     ON CONFLICT (id) DO UPDATE SET kind = EXCLUDED.kind, title = EXCLUDED.title,
       requirements = EXCLUDED.requirements, my_approach = EXCLUDED.my_approach,
       canonical_approach = EXCLUDED.canonical_approach, components = EXCLUDED.components,
       relationships = EXCLUDED.relationships, patterns = EXCLUDED.patterns, api = EXCLUDED.api,
       estimations = EXCLUDED.estimations, tradeoffs = EXCLUDED.tradeoffs, notes = EXCLUDED.notes,
       updated_at = EXCLUDED.updated_at
     WHERE designs.owner_id = EXCLUDED.owner_id
     RETURNING id`,
    [id, owner, inputDesign.kind === 'hld' ? 'hld' : 'lld', inputDesign.title || '',
      inputDesign.requirements || '', inputDesign.my_approach || '', inputDesign.canonical_approach || '',
      inputDesign.components || '', inputDesign.relationships || '', inputDesign.patterns || '',
      inputDesign.api || '', inputDesign.estimations || '', inputDesign.tradeoffs || '',
      inputDesign.notes || '', inputDesign.created ? new Date(inputDesign.created) : now, now]
  );
  if (!rows.length) throw new Error('design not found or is owned by another user');
  await replaceDesignTags({ ...inputDesign, id }, owner);
  return { ok: true, id: rows[0].id };
}

/** Delete only a design belonging to ownerId. */
export async function deleteDesign(id, ownerId) {
  const designId = requireId(id, 'design id');
  const owner = requireOwner(ownerId);
  const db = requireDatabase('delete');
  const rows = await db.query(
    'DELETE FROM designs WHERE id = $1 AND owner_id = $2 RETURNING id',
    [designId, owner]
  );
  return { ok: true, deleted: rows.length > 0 };
}

/** Fetch one design only when it belongs to ownerId. */
export async function getDesign(id, ownerId) {
  const designId = requireId(id, 'design id');
  const owner = requireOwner(ownerId);
  if (!sql) return null;
  const rows = await sql.query(
    `SELECT d.*,
            COALESCE(json_agg(json_build_object('id', t.id, 'name', t.name))
              FILTER (WHERE t.id IS NOT NULL), '[]'::json) AS tags
     FROM designs d
     LEFT JOIN designs_tags dt ON dt.design_id = d.id
     LEFT JOIN tags t ON t.id = dt.tag_id
     WHERE d.id = $1 AND d.owner_id = $2
     GROUP BY d.id`,
    [designId, owner]
  );
  return rows.length ? rowToDesign(rows[0]) : null;
}

/** Count an owner's review streak, optionally from an already-owner-scoped cards array. */
export async function countStreak(ownerId, cards) {
  const owner = requireOwner(ownerId);
  if (Array.isArray(cards)) return _countStreakFromCards(cards);
  if (!sql) return 0;
  const rows = await sql.query(
    `SELECT DISTINCT last_review FROM cards
     WHERE owner_id = $1 AND last_review IS NOT NULL
     ORDER BY last_review DESC`,
    [owner]
  );
  return _countStreakFromDays(rows.map((row) => new Date(row.last_review).toISOString().slice(0, 10)));
}

function _countStreakFromCards(cards) {
  const streaks = {};
  (cards || []).forEach((card) => {
    if (card.sm2 && card.sm2.lastReview) streaks[card.sm2.lastReview] = true;
  });
  return _countStreakFromDays(Object.keys(streaks));
}

function _countStreakFromDays(days) {
  const sorted = [...new Set(days)].sort().reverse();
  let count = 0;
  const check = new Date();
  for (const day of sorted) {
    const expected = new Date(check);
    expected.setDate(expected.getDate() - count);
    if (day === expected.toISOString().slice(0, 10)) count++;
    else break;
  }
  return count;
}
