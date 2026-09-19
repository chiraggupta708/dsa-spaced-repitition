/**
 * Owner-scoped Neon SQL data layer.
 * All card and design access requires the authenticated Clerk owner ID.
 */

import { neon } from '@neondatabase/serverless';
import crypto from 'node:crypto';
import {
  ACTIVE_SCHEDULER_MODE,
  createFsrsTransition,
  FSRS_PARAMETER_RECORD,
  fsrsStateName,
  isSerializedFsrsCard,
  normalizeRating,
  scheduleNextDue,
} from './fsrs.js';
import {
  PRACTICE_PAGE_LIMITS,
  PRACTICE_CURSOR_MAX_AGE_MS,
  PracticeCursorError,
  PracticeIdempotencyConflictError,
  PracticeNotFoundError,
  PracticeTimezoneRequiredError,
  decodePracticeCursor,
  encodePracticeCursor,
  fingerprintPracticeCaptureInput,
  fingerprintPracticeInput,
  normalizePracticeCaptureInput,
  normalizePracticeInput,
  normalizePracticeTimeZone,
  practiceCaptureIdentity,
  schedulePracticeOutcome,
  toPracticeAttemptDetail,
  toPracticeAttemptSummary,
  toPracticeCardDto,
  toPracticeQueueItem,
  toPracticeRevealDto,
  toPracticeSummary,
} from './dsa-practice.js';
import { sm2Calc } from './sm2.js';

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

/** Load one bounded, owner-scoped page of lightweight card summaries. */
export async function loadCardSummaries(ownerId, options = {}) {
  const owner = requireOwner(ownerId);
  const limit = normalizePracticeLimit(options.limit, PRACTICE_PAGE_LIMITS.cards, PRACTICE_PAGE_LIMITS.cards);
  const queryValue = options.q ?? options.query;
  const difficultyValue = options.difficulty;
  const filters = normalizeCardListFilters({ q: queryValue, difficulty: difficultyValue });
  const sort = 'created_at_desc_id_desc';
  const hasCursor = options.cursor !== undefined && options.cursor !== null;
  const serverNow = new Date();
  const cursor = hasCursor
    ? decodePracticeCursor(options.cursor, {
      ownerId: owner,
      view: 'cards',
      filter: filters,
      sort,
      maxAgeMs: PRACTICE_CURSOR_MAX_AGE_MS,
      now: serverNow,
    })
    : null;
  if (cursor && !cursor.key.id) throw new PracticeCursorError('cards cursor key is invalid');
  const snapshotAt = cursor?.snapshotAt || serverNow.toISOString();
  const params = [owner, snapshotAt];
  const where = [
    'c.owner_id = $1',
    'c.created_at <= $2::timestamptz',
  ];
  addQueueFilterSql(where, params, filters);
  if (cursor) addCardAfterKeySql(where, params, cursor.key);
  const pageParams = [...params, limit];
  const limitParameter = pageParams.length;
  const db = sql;
  if (!db) return { cards: [], nextCursor: null, hasMore: false, version: snapshotAt };
  const rows = await db.query(
    `SELECT c.id, c.created_at, c.updated_at, c.question, c.link, c.difficulty,
            c.easiness_factor, c.interval, c.repetitions, c.next_review,
            c.last_review, c.last_quality,
            COALESCE(json_agg(json_build_object('id', t.id, 'name', t.name))
              FILTER (WHERE t.id IS NOT NULL), '[]'::json) AS tags
     FROM cards c
     LEFT JOIN cards_tags ct ON ct.card_id = c.id
     LEFT JOIN tags t ON t.id = ct.tag_id
     WHERE ${where.join(' AND ')}
     GROUP BY c.id
     ORDER BY c.created_at DESC, c.id DESC
     LIMIT $${limitParameter}`,
    pageParams
  );
  const last = rows[rows.length - 1];
  let hasMore = false;
  if (last) {
    const moreWhere = [...where];
    const moreParams = [...params];
    addCardAfterKeySql(moreWhere, moreParams, {
      createdAt: dbIso(last.created_at),
      id: last.id,
    });
    const moreRows = await db.query(
      `SELECT EXISTS (
         SELECT 1
         FROM cards c
         WHERE ${moreWhere.join(' AND ')}
       ) AS has_more`,
      moreParams
    );
    hasMore = Boolean(moreRows[0]?.has_more);
  }
  const cards = rows.map(rowToCardSummary);
  const nextCursor = hasMore
    ? encodePracticeCursor({
      ownerId: owner,
      view: 'cards',
      filter: filters,
      sort,
      snapshotAt,
      key: { createdAt: dbIso(last.created_at), id: last.id },
    })
    : null;
  return { cards, nextCursor, hasMore, version: snapshotAt };
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

/** Load one bounded, owner-scoped page of lightweight due summaries. */
export async function loadDueCardSummaries(ownerId, options = {}) {
  const owner = requireOwner(ownerId);
  const limit = normalizePracticeLimit(options.limit, PRACTICE_PAGE_LIMITS.due, PRACTICE_PAGE_LIMITS.due);
  const filters = normalizeCardListFilters(options);
  const sort = 'next_review_asc_nulls_first_easiness_factor_asc_id_asc';
  const hasCursor = options.cursor !== undefined && options.cursor !== null;
  const serverNow = new Date();
  const cursor = hasCursor
    ? decodePracticeCursor(options.cursor, {
      ownerId: owner,
      view: 'due',
      filter: filters,
      sort,
      maxAgeMs: PRACTICE_CURSOR_MAX_AGE_MS,
      now: serverNow,
    })
    : null;
  if (cursor && !cursor.key.cardId) throw new PracticeCursorError('due cursor key is invalid');
  const snapshotAt = cursor?.snapshotAt || serverNow.toISOString();
  const params = [owner, todayISO(), snapshotAt];
  const where = [
    'c.owner_id = $1',
    '(c.next_review IS NULL OR c.next_review <= $2::date)',
    'c.updated_at <= $3::timestamptz',
  ];
  addQueueFilterSql(where, params, filters);
  if (cursor) addDueAfterKeySql(where, params, cursor.key);
  const pageParams = [...params, limit];
  const limitParameter = pageParams.length;
  const db = sql;
  if (!db) return { cards: [], nextCursor: null, hasMore: false, version: snapshotAt };
  const rows = await db.query(
    `SELECT c.id, c.created_at, c.updated_at, c.question, c.link, c.difficulty,
            c.easiness_factor, c.interval, c.repetitions, c.next_review,
            c.last_review, c.last_quality,
            COALESCE(json_agg(json_build_object('id', t.id, 'name', t.name))
              FILTER (WHERE t.id IS NOT NULL), '[]'::json) AS tags
     FROM cards c
     LEFT JOIN cards_tags ct ON ct.card_id = c.id
     LEFT JOIN tags t ON t.id = ct.tag_id
     WHERE ${where.join(' AND ')}
     GROUP BY c.id
     ORDER BY CASE WHEN c.next_review IS NULL THEN 0 ELSE 1 END,
              c.next_review ASC,
              COALESCE(c.easiness_factor, 2.5) ASC,
              c.id ASC
     LIMIT $${limitParameter}`,
    pageParams
  );
  const last = rows[rows.length - 1];
  let hasMore = false;
  if (last) {
    const moreWhere = [...where];
    const moreParams = [...params];
    addDueAfterKeySql(moreWhere, moreParams, {
      nextReview: dbIso(last.next_review),
      easinessFactor: Number(last.easiness_factor ?? 2.5),
      cardId: last.id,
    });
    const moreRows = await db.query(
      `SELECT EXISTS (
         SELECT 1
         FROM cards c
         WHERE ${moreWhere.join(' AND ')}
       ) AS has_more`,
      moreParams
    );
    hasMore = Boolean(moreRows[0]?.has_more);
  }
  const cards = rows.map(rowToCardSummary);
  const nextCursor = hasMore
    ? encodePracticeCursor({
      ownerId: owner,
      view: 'due',
      filter: filters,
      sort,
      snapshotAt,
      key: {
        nextReview: dbIso(last.next_review),
        easinessFactor: Number(last.easiness_factor ?? 2.5),
        cardId: last.id,
      },
    })
    : null;
  return { cards, nextCursor, hasMore, version: snapshotAt };
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

const RATING_TO_LEGACY_QUALITY = Object.freeze({
  again: 1,
  hard: 2,
  good: 4,
  easy: 5,
});

function requireIdempotencyKey(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > 200) {
    throw new Error('idempotencyKey must be a nonempty string of at most 200 characters');
  }
  return value.trim();
}

function rowToReviewEvent(row) {
  return {
    id: row.id,
    cardId: row.card_id,
    rating: row.rating,
    solvedFromScratch: row.solved,
    occurredAt: new Date(row.occurred_at).toISOString(),
    scheduledAt: row.scheduled_at ? new Date(row.scheduled_at).toISOString() : null,
    algorithm: row.algorithm ?? null,
    algorithmVersion: row.algorithm_version,
    parameterVersion: row.parameter_version,
    stateBefore: row.state_before ?? null,
    stateAfter: row.state_after ?? null,
    actualElapsedDays: row.actual_elapsed_days ?? null,
    overdueDays: row.overdue_days ?? null,
    scheduledIntervalDays: row.scheduled_interval_days ?? null,
    idempotencyKey: row.idempotency_key,
  };
}

export function buildShadowReviewMutation({
  parameterRecord,
  eventId,
  owner,
  cardId,
  rating,
  solvedFromScratch,
  now,
  key,
  transition,
  compatibilitySm2,
  cardUpdatedAt,
  stateName,
  practiceDueAt,
  legacyTimeZone,
  legacyFingerprint,
} = {}) {
  return {
    text: `WITH seeded_parameter AS (
       INSERT INTO fsrs_scheduler_parameters (version, data)
       VALUES ($1, $2::jsonb)
       ON CONFLICT (version) DO NOTHING
       RETURNING version
     ),
     event_claim AS (
       INSERT INTO fsrs_review_events
         (id, owner_id, card_id, rating, solved, occurred_at, scheduled_at,
          algorithm, algorithm_version, parameter_version, state_before, state_after,
          actual_elapsed_days, overdue_days, scheduled_interval_days, idempotency_key)
       SELECT $3, $4, $5, $6, $7, $8, $9, $10, $11, parameter_source.version,
              $12::jsonb, $13::jsonb, $14, $15, $16, $17
       FROM (
         SELECT version FROM seeded_parameter
         UNION ALL
         SELECT version FROM fsrs_scheduler_parameters WHERE version = $1
       ) AS parameter_source
       LIMIT 1
       ON CONFLICT (owner_id, idempotency_key) DO NOTHING
       RETURNING id, card_id, rating, solved, occurred_at, scheduled_at, algorithm,
                 algorithm_version, parameter_version, state_before, state_after,
                 actual_elapsed_days, overdue_days, scheduled_interval_days, idempotency_key
     ),
     card_update AS (
       UPDATE cards c
       SET easiness_factor = $18, interval = $19, repetitions = $20,
           next_review = $21, last_review = $22, last_quality = $23, updated_at = $8
       FROM event_claim e
       WHERE c.id = $5 AND c.owner_id = $4
         AND c.updated_at = $24::timestamptz
         AND e.parameter_version = $1
       RETURNING c.id, c.owner_id
     ),
     schedule_write AS (
       INSERT INTO fsrs_card_schedules
         (owner_id, card_id, due_at, stability, difficulty, state, card_state, schedule_version, updated_at)
       SELECT c.owner_id, c.id, $9, $25, $26, $27, $28::jsonb, $1, $8
       FROM card_update c
       ON CONFLICT (owner_id, card_id) DO UPDATE SET
         due_at = EXCLUDED.due_at, stability = EXCLUDED.stability,
         difficulty = EXCLUDED.difficulty, state = EXCLUDED.state,
         card_state = EXCLUDED.card_state, schedule_version = EXCLUDED.schedule_version,
         updated_at = EXCLUDED.updated_at
     ),
     practice_write AS (
       INSERT INTO fsrs_practice_states
         (owner_id, card_id, practice_state, last_practiced_at, next_practice_at, updated_at,
          last_attempt_at, last_outcome, last_independent_solve_at, due_reason, last_attempt_id, revision)
       SELECT c.owner_id, c.id, 'active', $8, $29, $8,
              $8, 'independent', $8, 'monthly_checkpoint', ('legacy-review:' || $3), 1
       FROM card_update c
       WHERE $30::boolean AND $31::text IS NOT NULL
       ON CONFLICT (owner_id, card_id) DO UPDATE SET
         last_practiced_at = EXCLUDED.last_practiced_at,
         next_practice_at = EXCLUDED.next_practice_at,
         updated_at = EXCLUDED.updated_at,
         last_attempt_at = EXCLUDED.last_attempt_at,
         last_outcome = EXCLUDED.last_outcome,
         last_independent_solve_at = EXCLUDED.last_independent_solve_at,
         due_reason = EXCLUDED.due_reason,
         last_attempt_id = EXCLUDED.last_attempt_id,
         revision = fsrs_practice_states.revision + 1
       WHERE fsrs_practice_states.last_attempt_at IS NULL
          OR EXCLUDED.last_attempt_at >= fsrs_practice_states.last_attempt_at
     ),
     legacy_practice_bridge AS (
       INSERT INTO dsa_practice_attempts
         (id, owner_id, card_id, occurred_at, time_zone, outcome, blocker, reflection,
          challenge_approach, challenge_invariant, challenge_complexity, next_practice_at,
          due_reason, source, source_event_id, idempotency_key, request_fingerprint, created_at)
       SELECT ('legacy-review:' || $3), c.owner_id, c.id, $8, $31, 'independent',
              NULL, NULL, NULL, NULL, NULL, $29, 'monthly_checkpoint', 'legacy_review' AS source,
              $3 AS source_event_id, ('legacy-review:' || $3), $32, $8
       FROM card_update c
       WHERE $30::boolean AND $31::text IS NOT NULL
       ON CONFLICT (source_event_id) DO NOTHING
       RETURNING id
     ),
     claim_guard AS (
       SELECT 1 / CASE
         WHEN EXISTS (SELECT 1 FROM event_claim)
          AND NOT EXISTS (SELECT 1 FROM card_update)
         THEN 0 ELSE 1
       END AS ok
     )
     SELECT e.id, e.card_id, e.rating, e.solved, e.occurred_at, e.scheduled_at, e.algorithm,
            e.algorithm_version, e.parameter_version, e.state_before, e.state_after,
            e.actual_elapsed_days, e.overdue_days, e.scheduled_interval_days, e.idempotency_key
     FROM event_claim e
     CROSS JOIN claim_guard`,
    params: [
      transition.parameterVersion,
      parameterRecord,
      eventId, owner, cardId, rating, solvedFromScratch, now, transition.dueAt,
      transition.algorithm, transition.algorithmVersion,
      JSON.stringify(transition.stateBefore), JSON.stringify(transition.stateAfter),
      transition.actualElapsedDays, transition.overdueDays, transition.scheduledIntervalDays, key,
      compatibilitySm2.easinessFactor, compatibilitySm2.interval, compatibilitySm2.repetitions,
      compatibilitySm2.nextReview, compatibilitySm2.lastReview, compatibilitySm2.lastQuality,
      cardUpdatedAt,
      transition.stateAfter.stability, transition.stateAfter.difficulty,
      stateName, JSON.stringify(transition.stateAfter),
      practiceDueAt ?? null, solvedFromScratch,
      legacyTimeZone ?? null, legacyFingerprint ?? null,
    ],
  };
}

/**
 * Record a semantic review while FSRS remains an inactive compatibility shadow.
 * The legacy SM-2 card fields are updated only here so existing card consumers
 * continue to receive their expected projection; the route never owns SM-2.
 */
export async function recordReview({ cardId, userId, rating, idempotencyKey, solvedFromScratch } = {}) {
  const owner = requireOwner(userId);
  const id = requireId(cardId, 'cardId');
  const normalizedRating = normalizeRating(rating);
  const key = requireIdempotencyKey(idempotencyKey);
  if (typeof solvedFromScratch !== 'boolean') {
    throw new Error('solvedFromScratch must be a boolean');
  }

  const db = requireDatabase('record review');
  const existingRows = await db.query(
    `SELECT id, card_id, rating, solved, occurred_at, scheduled_at, algorithm,
            algorithm_version, parameter_version, state_before, state_after,
            actual_elapsed_days, overdue_days, scheduled_interval_days, idempotency_key
     FROM fsrs_review_events
     WHERE owner_id = $1 AND idempotency_key = $2`,
    [owner, key]
  );
  if (existingRows.length) {
    await bridgeLegacyReviewEvent({ owner, event: existingRows[0] });
    const card = await getCard(existingRows[0].card_id, owner);
    return { missing: !card, event: rowToReviewEvent(existingRows[0]), card };
  }

  // This narrow pre-read gives the SM-2 projection and exact CAS token the same source row.
  const preReadRows = await db.query(
    `SELECT easiness_factor, interval, repetitions, next_review, last_review, last_quality, updated_at
     FROM cards WHERE id = $1 AND owner_id = $2`,
    [id, owner]
  );
  if (!preReadRows.length) return { missing: true };
  const preRead = preReadRows[0];

  const scheduleRows = await db.query(
    `SELECT card_state FROM fsrs_card_schedules
     WHERE owner_id = $1 AND card_id = $2`,
    [owner, id]
  );
  let previousFsrsCard;
  if (scheduleRows.length && scheduleRows[0].card_state !== null && scheduleRows[0].card_state !== undefined) {
    let candidate = scheduleRows[0].card_state;
    if (typeof candidate === 'string') {
      try {
        candidate = JSON.parse(candidate);
      } catch {
        throw new Error('Stored FSRS schedule state is invalid; refusing to reset it');
      }
    }
    if (!isSerializedFsrsCard(candidate)) {
      throw new Error('Stored FSRS schedule state is invalid; refusing to reset it');
    }
    previousFsrsCard = candidate;
  }

  const preferenceRows = await db.query(
    'SELECT timezone FROM learner_preferences WHERE owner_id = $1',
    [owner]
  );
  let persistedPracticeTimeZone = null;
  if (preferenceRows.length) {
    try {
      persistedPracticeTimeZone = normalizePracticeTimeZone(preferenceRows[0].timezone);
    } catch {
      // An invalid stored preference is not usable as DSA practice authority.
      persistedPracticeTimeZone = null;
    }
  }
  // UTC preserves the existing non-DSA FSRS/SM-2 transition only. The DSA
  // bridge receives persistedPracticeTimeZone and is gated when it is absent.
  const fsrsTimeZone = persistedPracticeTimeZone || 'UTC';
  const now = new Date();
  const fsrsTransition = createFsrsTransition({
    card: previousFsrsCard,
    rating: normalizedRating,
    timeZone: fsrsTimeZone,
    now,
  });
  let practiceScheduled = null;
  if (solvedFromScratch) {
    if (persistedPracticeTimeZone) {
      practiceScheduled = scheduleNextDue({
        mode: 'practice',
        rating: normalizedRating,
        timeZone: persistedPracticeTimeZone,
        now,
      });
    }
  }

  const legacyQuality = RATING_TO_LEGACY_QUALITY[normalizedRating];
  const compatibilitySm2 = sm2Calc(legacyQuality, {
    easinessFactor: preRead.easiness_factor,
    interval: preRead.interval,
    repetitions: preRead.repetitions,
  });
  // Legacy SM-2 schedules Again for today; the shadow boundary must not.
  if (normalizedRating === 'again') {
    compatibilitySm2.nextReview = fsrsTransition.dueAt.slice(0, 10);
  }
  const parameterRecord = JSON.stringify({
    ...FSRS_PARAMETER_RECORD,
    schedulerMode: ACTIVE_SCHEDULER_MODE,
    activeScheduler: false,
  });

  const eventId = crypto.randomUUID();
  const legacyFingerprint = persistedPracticeTimeZone
    ? crypto.createHash('sha256')
      .update(JSON.stringify({
        cardId: id,
        outcome: 'independent',
        source: 'legacy_review',
        sourceEventId: eventId,
      }))
      .digest('hex')
    : null;
  const mutation = buildShadowReviewMutation({
    parameterRecord,
    eventId: eventId, // eventId: crypto.randomUUID() is generated once above for bridge consistency
    owner,
    cardId: id,
    rating: normalizedRating,
    solvedFromScratch,
    now,
    key,
    transition: fsrsTransition,
    compatibilitySm2,
    cardUpdatedAt: preRead.updated_at,
    stateName: fsrsStateName(fsrsTransition.stateAfter.state),
    practiceDueAt: practiceScheduled?.dueAt,
    legacyTimeZone: persistedPracticeTimeZone,
    legacyFingerprint,
  });
  let eventRows;
  try {
    eventRows = await db.query(mutation.text, mutation.params);
  } catch (error) {
    if (!isMissingDsaPracticeSchema(error)) throw error;
    const compatibilityMutation = withoutLegacyPracticeBridge(mutation);
    eventRows = await db.query(compatibilityMutation.text, compatibilityMutation.params);
  }
  const event = eventRows[0] || (await db.query(
    `SELECT id, card_id, rating, solved, occurred_at, scheduled_at, algorithm,
            algorithm_version, parameter_version, state_before, state_after,
            actual_elapsed_days, overdue_days, scheduled_interval_days, idempotency_key
     FROM fsrs_review_events
     WHERE owner_id = $1 AND idempotency_key = $2`,
    [owner, key]
  ))[0];
  await bridgeLegacyReviewEvent({ owner, event });
  const updatedCard = await getCard(id, owner);
  return { missing: !updatedCard, event: rowToReviewEvent(event), card: updatedCard };
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

function isMissingDsaPracticeTable(error) {
  const message = String(error?.message || error || '').toLowerCase();
  return message.includes('dsa_practice_attempts')
    && (message.includes('does not exist') || message.includes('undefined table'));
}

function isMissingDsaPracticeSchema(error) {
  const message = String(error?.message || error || '').toLowerCase();
  if (isMissingDsaPracticeTable(error)) return true;
  return message.includes('fsrs_practice_states')
    && message.includes('column')
    && ['last_attempt_at', 'last_outcome', 'last_independent_solve_at', 'due_reason', 'last_attempt_id', 'revision']
      .some((column) => message.includes(column));
}

function withoutLegacyPracticeBridge(mutation) {
  let text = mutation.text.replace(
    /,\n     practice_write AS \([\s\S]*?\n     \),\n     legacy_practice_bridge AS/,
    `,
     practice_write AS (
       INSERT INTO fsrs_practice_states
         (owner_id, card_id, practice_state, last_practiced_at, next_practice_at, updated_at)
       SELECT c.owner_id, c.id, 'active', $8, $29, $8
       FROM card_update c
       -- $29 is populated only after persisted timezone validation.
       WHERE $30::boolean AND $29::timestamptz IS NOT NULL
       ON CONFLICT (owner_id, card_id) DO UPDATE SET
         last_practiced_at = EXCLUDED.last_practiced_at,
         next_practice_at = EXCLUDED.next_practice_at,
         updated_at = EXCLUDED.updated_at
     ),
     legacy_practice_bridge AS`,
  );
  text = text.replace(
    /,\n     legacy_practice_bridge AS \([\s\S]*?\n     \),\n     claim_guard AS/,
    ',\n     claim_guard AS',
  );
  return { text, params: mutation.params.slice(0, 30) };
}

/**
 * Materialize one solved legacy review as one immutable DSA attempt. The
 * source event ID is the idempotency boundary, so retries are no-ops.
 */
async function bridgeLegacyReviewEvent({ owner, event } = {}) {
  if (!event || event.solved !== true || !sql) return { inserted: false };
  const ownerId = requireOwner(owner ?? event.owner_id);
  const cardId = requireId(event.card_id, 'cardId');
  const sourceEventId = requireId(event.id, 'sourceEventId');
  let zone;
  try {
    try {
      zone = await getPracticeTimeZone(ownerId);
    } catch (error) {
      if (error?.code === 'invalid_practice_timezone' || error?.code === 'practice_timezone_required') {
        return { inserted: false, unknown: true };
      }
      throw error;
    }
    if (!zone) return { inserted: false, unknown: true };
    zone = normalizePracticeTimeZone(zone);
    const occurredAt = new Date(event.occurred_at);
    if (Number.isNaN(occurredAt.getTime())) throw new Error('legacy review occurred_at is invalid');
    const scheduled = schedulePracticeOutcome({ outcome: 'independent', timeZone: zone, now: occurredAt });
    const attemptId = `legacy-review:${sourceEventId}`;
    const fingerprint = crypto.createHash('sha256')
      .update(JSON.stringify({ cardId, outcome: 'independent', source: 'legacy_review', sourceEventId }))
      .digest('hex');
    const rows = await sql.query(
      `WITH bridge AS (
         INSERT INTO dsa_practice_attempts
           (id, owner_id, card_id, occurred_at, time_zone, outcome, blocker, reflection,
            challenge_approach, challenge_invariant, challenge_complexity, next_practice_at,
            due_reason, source, source_event_id, idempotency_key, request_fingerprint, created_at)
         SELECT $1, $2, c.id, $5, $6, 'independent', NULL, NULL, NULL, NULL, NULL,
                $7, 'monthly_checkpoint', 'legacy_review', $3, $1, $8, $5
         FROM cards c
         WHERE c.id = $4::text AND c.owner_id = $2
         ON CONFLICT (source_event_id) DO NOTHING
         RETURNING id, card_id, occurred_at, time_zone, outcome, next_practice_at, due_reason, source
       ), projection AS (
         INSERT INTO fsrs_practice_states
           (owner_id, card_id, practice_state, last_practiced_at, next_practice_at, updated_at,
            last_attempt_at, last_outcome, last_independent_solve_at, due_reason, last_attempt_id, revision)
         SELECT $2, $4, 'active', $5, $7, $5, $5, 'independent', $5,
                'monthly_checkpoint', $1, 1
         FROM bridge
         ON CONFLICT (owner_id, card_id) DO UPDATE SET
           last_practiced_at = EXCLUDED.last_practiced_at,
           next_practice_at = EXCLUDED.next_practice_at,
           updated_at = EXCLUDED.updated_at,
           last_attempt_at = EXCLUDED.last_attempt_at,
           last_outcome = EXCLUDED.last_outcome,
           last_independent_solve_at = EXCLUDED.last_independent_solve_at,
           due_reason = EXCLUDED.due_reason,
           last_attempt_id = EXCLUDED.last_attempt_id,
           revision = fsrs_practice_states.revision + 1
         WHERE EXCLUDED.last_attempt_at >= COALESCE(fsrs_practice_states.last_attempt_at, '-infinity'::timestamptz)
         RETURNING owner_id, card_id
       )
       SELECT b.* FROM bridge b`,
      [attemptId, ownerId, sourceEventId, cardId, occurredAt, zone, scheduled.dueAt, fingerprint]
    );
    return { inserted: rows.length > 0, attemptId };
  } catch (error) {
    if (isMissingDsaPracticeSchema(error)) return { inserted: false, unavailable: true };
    throw error;
  }
}

function normalizePracticeLimit(value, maximum, fallback = maximum) {
  if (value === undefined || value === null || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new PracticeCursorError('limit must be a positive integer');
  }
  return Math.min(parsed, maximum);
}

function dbIso(value) {
  if (value === null || value === undefined) return null;
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function queueFilters(options) {
  const query = typeof options.q === 'string' ? options.q.trim().slice(0, 200) : '';
  const difficulty = typeof options.difficulty === 'string' ? options.difficulty.trim() : '';
  if (difficulty && !['easy', 'medium', 'hard'].includes(difficulty)) {
    throw new PracticeCursorError('difficulty filter is invalid');
  }
  return { q: query || null, difficulty: difficulty || null };
}

function normalizeCardListFilters(options = {}) {
  const rawQuery = options.q ?? options.query;
  if (rawQuery !== undefined && rawQuery !== null && typeof rawQuery !== 'string') {
    throw new PracticeCursorError('q filter is invalid');
  }
  const query = typeof rawQuery === 'string' ? rawQuery.trim().slice(0, 200) : '';
  const rawDifficulty = options.difficulty;
  if (rawDifficulty !== undefined && rawDifficulty !== null && typeof rawDifficulty !== 'string') {
    throw new PracticeCursorError('difficulty filter is invalid');
  }
  const difficulty = typeof rawDifficulty === 'string' ? rawDifficulty.trim().toLowerCase() : '';
  if (difficulty && !['easy', 'medium', 'hard'].includes(difficulty)) {
    throw new PracticeCursorError('difficulty filter is invalid');
  }
  return { q: query || null, difficulty: difficulty || null };
}

function recognitionTrapSql({ ownerParameter = '$1', nowParameter = '$2' } = {}) {
  const latestGoodOrEasy = `(SELECT COUNT(*) FROM (
      SELECT re.rating
      FROM fsrs_review_events re
      WHERE re.owner_id = ${ownerParameter}
        AND re.card_id = c.id
        AND re.solved = FALSE
      ORDER BY re.occurred_at DESC, re.id DESC
      LIMIT 2
    ) AS latest_recall
    WHERE latest_recall.rating IN ('good', 'easy')) = 2`;
  const staleIndependent = `(s.last_independent_solve_at IS NULL
    OR s.last_independent_solve_at < (${nowParameter}::timestamptz - INTERVAL '30 days'))`;
  return {
    suggested: `(${staleIndependent} AND ${latestGoodOrEasy})`,
    reason: `CASE WHEN ${staleIndependent} AND ${latestGoodOrEasy}
      THEN 'Two latest recall ratings were Good/Easy without a recent independent solve.'
      ELSE NULL END`,
  };
}

function addQueueFilterSql(where, params, filters) {
  let next = params.length + 1;
  if (filters.q) {
    params.push(`%${filters.q.replace(/[!%_]/g, '!$&')}%`);
    where.push(`(c.question ILIKE $${next} ESCAPE '!' OR c.link ILIKE $${next} ESCAPE '!' OR EXISTS (
      SELECT 1 FROM cards_tags queue_ct
      JOIN tags queue_t ON queue_t.id = queue_ct.tag_id
      WHERE queue_ct.card_id = c.id AND queue_t.name ILIKE $${next} ESCAPE '!'
    ))`);
    next += 1;
  }
  if (filters.difficulty) {
    params.push(filters.difficulty);
    where.push(`c.difficulty = $${next}`);
  }
  return params.length + 1;
}

function addCardAfterKeySql(where, params, key) {
  const createdParameter = params.length + 1;
  params.push(key.createdAt);
  const idParameter = params.length + 1;
  params.push(key.id);
  where.push(`(c.created_at < $${createdParameter}::timestamptz
    OR (c.created_at = $${createdParameter}::timestamptz AND c.id < $${idParameter}))`);
}

function addDueAfterKeySql(where, params, key) {
  const nextReviewParameter = params.length + 1;
  params.push(key.nextReview ?? null);
  const easinessParameter = params.length + 1;
  params.push(Number(key.easinessFactor));
  const cardParameter = params.length + 1;
  params.push(key.cardId);
  where.push(`(
    ($${nextReviewParameter}::timestamptz IS NULL AND (
      c.next_review IS NOT NULL
      OR (c.next_review IS NULL
        AND COALESCE(c.easiness_factor, 2.5) > $${easinessParameter}::real)
      OR (c.next_review IS NULL
        AND COALESCE(c.easiness_factor, 2.5) = $${easinessParameter}::real
        AND c.id > $${cardParameter})
    ))
    OR
    ($${nextReviewParameter}::timestamptz IS NOT NULL
      AND c.next_review IS NOT NULL
      AND (
        c.next_review > $${nextReviewParameter}::timestamptz
        OR (c.next_review = $${nextReviewParameter}::timestamptz
          AND COALESCE(c.easiness_factor, 2.5) > $${easinessParameter}::real)
        OR (c.next_review = $${nextReviewParameter}::timestamptz
          AND COALESCE(c.easiness_factor, 2.5) = $${easinessParameter}::real
          AND c.id > $${cardParameter})
      )
    )
  )`);
}

function addQueueAfterKeySql(where, params, key) {
  const dueKeyParameter = params.length + 1;
  params.push(key.nextPracticeAt ?? null);
  const cardKeyParameter = params.length + 1;
  params.push(key.cardId);
  where.push(`(
    ($${dueKeyParameter}::timestamptz IS NULL AND
      (s.next_practice_at IS NOT NULL
       OR (s.next_practice_at IS NULL AND c.id > $${cardKeyParameter})))
    OR
    ($${dueKeyParameter}::timestamptz IS NOT NULL AND
      (s.next_practice_at > $${dueKeyParameter}::timestamptz
       OR (s.next_practice_at = $${dueKeyParameter}::timestamptz
           AND c.id > $${cardKeyParameter})))
  )`);
}

function addHistoryAfterKeySql(where, params, key) {
  const occurredParameter = params.length + 1;
  params.push(key.occurredAt);
  const idParameter = params.length + 1;
  params.push(key.id);
  where.push(`(a.occurred_at < $${occurredParameter}::timestamptz
    OR (a.occurred_at = $${occurredParameter}::timestamptz AND a.id < $${idParameter}))`);
}

function practiceStateDto(row, cardId) {
  if (!row) return null;
  return {
    cardId,
    lastIndependentSolveAt: dbIso(row.last_independent_solve_at),
    latestAttemptAt: dbIso(row.last_attempt_at),
    latestOutcome: row.last_outcome || null,
    nextPracticeAt: dbIso(row.next_practice_at),
    dueReason: row.due_reason || null,
    historyStatus: row.last_independent_solve_at ? 'has_independent_solve' : 'no_independent_solve_recorded',
  };
}

async function findPracticeAttemptByKey(db, owner, key) {
  const rows = await db.query(
    `SELECT a.id, a.card_id, a.occurred_at, a.time_zone, a.outcome,
            a.next_practice_at, a.due_reason, a.source, a.blocker, a.reflection,
            a.challenge_approach, a.challenge_invariant, a.challenge_complexity,
            a.request_fingerprint
     FROM dsa_practice_attempts a
     JOIN cards c ON c.id = a.card_id AND c.owner_id = a.owner_id
     WHERE a.owner_id = $1 AND a.idempotency_key = $2`,
    [owner, key]
  );
  return rows[0] || null;
}

/** Return the persisted practice timezone without choosing a fallback. */
export async function getPracticeTimeZone(ownerId) {
  const owner = requireOwner(ownerId);
  if (!sql) return null;
  const rows = await sql.query(
    `SELECT timezone
     FROM learner_preferences
     WHERE owner_id = $1`,
    [owner]
  );
  return rows.length ? normalizePracticeTimeZone(rows[0].timezone) : null;
}

/** Persist an explicit validated practice timezone preference. */
export async function setPracticeTimeZone(ownerId, timeZone) {
  const owner = requireOwner(ownerId);
  const zone = normalizePracticeTimeZone(timeZone);
  const db = requireDatabase('set practice timezone');
  const rows = await db.query(
    `INSERT INTO learner_preferences (owner_id, timezone, updated_at)
     VALUES ($1, $2, NOW())
     ON CONFLICT (owner_id) DO UPDATE SET timezone = EXCLUDED.timezone, updated_at = NOW()
     RETURNING owner_id, timezone, updated_at`,
    [owner, zone]
  );
  return { ownerId: rows[0].owner_id, timeZone: rows[0].timezone };
}

/** Return indexed aggregate practice counts plus at most one lightweight next item. */
export async function getPracticeSummary(ownerId) {
  const owner = requireOwner(ownerId);
  if (!sql) return toPracticeSummary({ due_count: 0, first_check_count: 0, recognition_trap_count: 0, version: null });
  const now = new Date().toISOString();
  const recognition = recognitionTrapSql({ ownerParameter: '$1::text', nowParameter: '$2' });
  const rows = await sql.query(
    `WITH summary_rows AS (
       SELECT c.id AS card_id,
              s.next_practice_at,
              s.last_independent_solve_at,
              s.revision,
              ${recognition.suggested} AS recognition_trap_suggested
       FROM cards c
       LEFT JOIN fsrs_practice_states s ON s.owner_id = $1::text AND s.card_id = c.id
       WHERE c.owner_id = $1::text
     )
     SELECT
       COUNT(*) AS total_count,
       COUNT(*) FILTER (WHERE next_practice_at IS NOT NULL AND next_practice_at <= $2::timestamptz) AS due_count,
       COUNT(*) FILTER (WHERE last_independent_solve_at IS NULL) AS first_check_count,
       COUNT(*) FILTER (WHERE recognition_trap_suggested) AS recognition_trap_count,
       COALESCE(MAX(revision), 0) AS version
     FROM summary_rows`,
    [owner, now]
  );
  const duePage = await listPracticeQueue(owner, { bucket: 'due', limit: 1 });
  const nextPage = duePage.items.length
    ? duePage
    : await listPracticeQueue(owner, { bucket: 'first-check', limit: 1 });
  return toPracticeSummary({
    ...(rows[0] || {}),
    next_item: nextPage.items[0] || null,
    version: rows[0]?.version ?? now,
  });
}

/** List at most ten lightweight due or first-check rows using a bound keyset cursor. */
export async function listPracticeQueue(ownerId, options = {}) {
  const owner = requireOwner(ownerId);
  const sessionMode = options._session === true;
  const view = sessionMode ? 'session' : 'queue';
  const maximum = sessionMode ? PRACTICE_PAGE_LIMITS.session : PRACTICE_PAGE_LIMITS.queue;
  const limit = normalizePracticeLimit(options.limit, maximum, maximum);
  const bucket = options.bucket || 'due';
  if (!['due', 'first-check'].includes(bucket)) throw new PracticeCursorError('queue bucket is invalid');
  const filters = queueFilters(options);
  const sort = 'next_practice_at_asc_card_id_asc';
  const hasCursor = options.cursor !== undefined && options.cursor !== null;
  const serverNow = new Date();
  const cursor = hasCursor
    ? decodePracticeCursor(options.cursor, {
      ownerId: owner,
      view,
      bucket,
      filter: filters,
      sort,
      maxAgeMs: PRACTICE_CURSOR_MAX_AGE_MS,
      now: serverNow,
    })
    : null;
  if (cursor && !cursor.key.cardId) throw new PracticeCursorError('queue cursor key is invalid');
  const snapshotAt = cursor?.snapshotAt || serverNow.toISOString();
  const params = [owner, snapshotAt];
  const where = [
    'c.owner_id = $1',
    'COALESCE(s.updated_at, c.updated_at) <= $2',
  ];
  if (bucket === 'due') {
    where.push('s.next_practice_at IS NOT NULL AND s.next_practice_at <= $2');
  } else {
    where.push('s.last_independent_solve_at IS NULL');
  }
  addQueueFilterSql(where, params, filters);
  if (cursor) addQueueAfterKeySql(where, params, cursor.key);
  const pageParams = [...params, limit];
  const limitParameter = pageParams.length;
  const db = sql;
  if (!db) return { items: [], nextCursor: null, hasMore: false, version: snapshotAt };
  const recognition = recognitionTrapSql({ ownerParameter: '$1', nowParameter: '$2' });
  const rows = await db.query(
    `SELECT c.id AS card_id, c.question AS title, c.link, c.difficulty,
            COALESCE(json_agg(json_build_object('name', t.name))
              FILTER (WHERE t.id IS NOT NULL), '[]'::json) AS tags,
            s.last_independent_solve_at, s.last_attempt_at, s.last_outcome,
            s.next_practice_at, s.due_reason,
            ${recognition.suggested} AS recognition_trap_suggested,
            ${recognition.reason} AS recognition_trap_reason
     FROM cards c
     LEFT JOIN fsrs_practice_states s ON s.owner_id = $1 AND s.card_id = c.id
     LEFT JOIN cards_tags ct ON ct.card_id = c.id
     LEFT JOIN tags t ON t.id = ct.tag_id
     WHERE ${where.join(' AND ')}
     GROUP BY c.id, c.question, c.link, c.difficulty,
              s.last_independent_solve_at, s.last_attempt_at, s.last_outcome,
              s.next_practice_at, s.due_reason
     ORDER BY s.next_practice_at ASC NULLS FIRST, c.id ASC
     LIMIT $${limitParameter}`,
    pageParams
  );
  const last = rows[rows.length - 1];
  let hasMore = false;
  if (last) {
    const moreWhere = [...where];
    const moreParams = [...params];
    addQueueAfterKeySql(moreWhere, moreParams, {
      nextPracticeAt: dbIso(last.next_practice_at),
      cardId: last.card_id,
    });
    const moreRows = await db.query(
      `SELECT EXISTS (
         SELECT 1
         FROM cards c
         LEFT JOIN fsrs_practice_states s ON s.owner_id = $1 AND s.card_id = c.id
         WHERE ${moreWhere.join(' AND ')}
       ) AS has_more`,
      moreParams
    );
    hasMore = Boolean(moreRows[0]?.has_more);
  }
  const items = rows.map(toPracticeQueueItem);
  const nextCursor = hasMore
    ? encodePracticeCursor({
      ownerId: owner,
      view,
      bucket,
      filter: filters,
      sort,
      snapshotAt,
      key: { nextPracticeAt: dbIso(last.next_practice_at), cardId: last.card_id },
    })
    : null;
  return { items, nextCursor, hasMore, version: snapshotAt };
}

/** Return a cold-solve batch capped at five lightweight queue rows. */
export async function getPracticeSession(ownerId, options = {}) {
  const owner = requireOwner(ownerId);
  const selectedCardId = options.cardId === undefined || options.cardId === null
    ? null
    : requireId(options.cardId, 'cardId');
  const limit = normalizePracticeLimit(options.limit, PRACTICE_PAGE_LIMITS.session, PRACTICE_PAGE_LIMITS.session);

  if (selectedCardId) {
    if (options.cursor !== undefined && options.cursor !== null && options.cursor !== '') {
      throw new PracticeCursorError('selected practice sessions do not support cursors');
    }
    const serverNow = new Date().toISOString();
    if (!sql) return { items: [], nextCursor: null, hasMore: false, version: serverNow };
    const recognition = recognitionTrapSql({ ownerParameter: '$2', nowParameter: '$3' });
    const rows = await sql.query(
      `SELECT c.id AS card_id, c.question AS title, c.link, c.difficulty,
              COALESCE(json_agg(json_build_object('name', t.name))
                FILTER (WHERE t.id IS NOT NULL), '[]'::json) AS tags,
              s.last_independent_solve_at, s.last_attempt_at, s.last_outcome,
              s.next_practice_at, s.due_reason,
              ${recognition.suggested} AS recognition_trap_suggested,
              ${recognition.reason} AS recognition_trap_reason
       FROM cards c
       LEFT JOIN fsrs_practice_states s ON s.owner_id = $2 AND s.card_id = c.id
       LEFT JOIN cards_tags ct ON ct.card_id = c.id
       LEFT JOIN tags t ON t.id = ct.tag_id
       WHERE c.id = $1 AND c.owner_id = $2
       GROUP BY c.id, c.question, c.link, c.difficulty,
                s.last_independent_solve_at, s.last_attempt_at, s.last_outcome,
                s.next_practice_at, s.due_reason
       ORDER BY c.id ASC
       LIMIT $4`,
      [selectedCardId, owner, serverNow, Math.min(limit, 1)]
    );
    return {
      items: rows.map(toPracticeQueueItem),
      nextCursor: null,
      hasMore: false,
      version: serverNow,
    };
  }

  // owner_id remains bound by listPracticeQueue for every normal session query.
  return listPracticeQueue(owner, { ...options, limit, _session: true });
}

/** Fetch one prompt/link and its practice summary without loading solution bodies. */
export async function getPracticeCard(cardId, ownerId) {
  const id = requireId(cardId, 'cardId');
  const owner = requireOwner(ownerId);
  if (!sql) return null;
  const now = new Date().toISOString();
  const recognition = recognitionTrapSql({ ownerParameter: '$2', nowParameter: '$3' });
  const rows = await sql.query(
    `SELECT c.id AS card_id, c.question AS title, c.question_description AS prompt,
            c.link, c.difficulty,
            COALESCE(json_agg(json_build_object('name', t.name))
              FILTER (WHERE t.id IS NOT NULL), '[]'::json) AS tags,
            s.last_independent_solve_at, s.last_attempt_at, s.last_outcome,
            s.next_practice_at, s.due_reason,
            ${recognition.suggested} AS recognition_trap_suggested,
            ${recognition.reason} AS recognition_trap_reason
     FROM cards c
     LEFT JOIN fsrs_practice_states s ON s.owner_id = $2 AND s.card_id = c.id
     LEFT JOIN cards_tags ct ON ct.card_id = c.id
     LEFT JOIN tags t ON t.id = ct.tag_id
     WHERE c.id = $1 AND c.owner_id = $2
     GROUP BY c.id, c.question, c.question_description, c.link, c.difficulty,
              s.last_independent_solve_at, s.last_attempt_at, s.last_outcome,
              s.next_practice_at, s.due_reason`,
    [id, owner, now]
  );
  return rows.length ? toPracticeCardDto(rows[0]) : null;
}

/** Return solution content and learning metadata only for an explicit owner-bound request. */
export async function getPracticeReveal(cardId, ownerId) {
  const id = requireId(cardId, 'cardId');
  const owner = requireOwner(ownerId);
  if (!sql) return null;
  const rows = await sql.query(
    `SELECT c.id AS card_id, c.question_description AS prompt, c.link,
            c.right_thinking AS reference, c.my_thinking AS approach,
            c.actual_code AS code, c.notes,
            n.key_insight, n.recurring_trap
     FROM cards c
     LEFT JOIN dsa_practice_learning_notes n
       ON n.owner_id = c.owner_id AND n.card_id = c.id
     WHERE c.id = $1 AND c.owner_id = $2`,
    [id, owner]
  );
  return rows.length ? toPracticeRevealDto(rows[0]) : null;
}

/** List at most ten immutable attempt summaries for one owner/card. */
export async function listPracticeHistory(ownerId, cardId, options = {}) {
  const owner = requireOwner(ownerId);
  const id = requireId(cardId, 'cardId');
  const limit = normalizePracticeLimit(options.limit, PRACTICE_PAGE_LIMITS.history, PRACTICE_PAGE_LIMITS.history);
  const filter = { cardId: id };
  const sort = 'occurred_at_desc_id_desc';
  const hasCursor = options.cursor !== undefined && options.cursor !== null;
  const serverNow = new Date();
  const cursor = hasCursor
    ? decodePracticeCursor(options.cursor, {
      ownerId: owner,
      view: 'history',
      filter,
      sort,
      maxAgeMs: PRACTICE_CURSOR_MAX_AGE_MS,
      now: serverNow,
    })
    : null;
  if (cursor && !cursor.key.id) throw new PracticeCursorError('history cursor key is invalid');
  const snapshotAt = cursor?.snapshotAt || serverNow.toISOString();
  const params = [owner, id, snapshotAt];
  const where = [
    'a.owner_id = $1',
    'a.card_id = $2',
    'a.occurred_at <= $3',
  ];
  if (cursor) addHistoryAfterKeySql(where, params, cursor.key);
  const pageParams = [...params, limit];
  const limitParameter = pageParams.length;
  if (!sql) return { items: [], nextCursor: null, hasMore: false, version: snapshotAt };
  const rows = await sql.query(
    `SELECT a.id, a.card_id, a.occurred_at, a.time_zone, a.outcome,
            a.next_practice_at, a.due_reason, a.source
     FROM dsa_practice_attempts a
     JOIN cards c ON c.id = a.card_id AND c.owner_id = a.owner_id
     WHERE ${where.join(' AND ')}
     ORDER BY a.occurred_at DESC, a.id DESC
     LIMIT $${limitParameter}`,
    pageParams
  );
  const last = rows[rows.length - 1];
  let hasMore = false;
  if (last) {
    const moreWhere = [...where];
    const moreParams = [...params];
    addHistoryAfterKeySql(moreWhere, moreParams, {
      occurredAt: dbIso(last.occurred_at),
      id: last.id,
    });
    const moreRows = await sql.query(
      `SELECT EXISTS (
         SELECT 1
         FROM dsa_practice_attempts a
         JOIN cards c ON c.id = a.card_id AND c.owner_id = a.owner_id
         WHERE ${moreWhere.join(' AND ')}
       ) AS has_more`,
      moreParams
    );
    hasMore = Boolean(moreRows[0]?.has_more);
  }
  const items = rows.map(toPracticeAttemptSummary);
  const nextCursor = hasMore
    ? encodePracticeCursor({
      ownerId: owner,
      view: 'history',
      filter,
      sort,
      snapshotAt,
      key: { occurredAt: dbIso(last.occurred_at), id: last.id },
    })
    : null;
  return { items, nextCursor, hasMore, version: snapshotAt };
}

/** Fetch one owner/card-bound attempt detail, including bounded reflection fields. */
export async function getPracticeAttempt(attemptId, ownerId) {
  const id = requireId(attemptId, 'attemptId');
  const owner = requireOwner(ownerId);
  if (!sql) return null;
  const rows = await sql.query(
    `SELECT a.id, a.card_id, a.occurred_at, a.time_zone, a.outcome,
            a.next_practice_at, a.due_reason, a.source, a.blocker, a.reflection,
            a.challenge_approach, a.challenge_invariant, a.challenge_complexity
     FROM dsa_practice_attempts a
     JOIN cards c ON c.id = a.card_id AND c.owner_id = a.owner_id
     WHERE a.id = $1 AND a.owner_id = $2 AND a.card_id = c.id AND c.owner_id = $2`,
    [id, owner]
  );
  return rows.length ? toPracticeAttemptDetail(rows[0]) : null;
}

/**
 * Record a practice attempt as one owner/card-serialized data-modifying
 * statement: idempotency claim, immutable event and projection update commit
 * together. A persisted validated timezone is mandatory for this new path.
 */
export async function recordPracticeAttempt(input = {}) {
  const owner = requireOwner(input.ownerId ?? input.userId);
  const cardId = requireId(input.cardId, 'cardId');
  const nestedBody = input.body ?? input.input;
  const body = nestedBody === undefined
    ? Object.fromEntries(Object.entries(input).filter(([key]) => !['ownerId', 'userId', 'cardId'].includes(key)))
    : nestedBody;
  const normalized = normalizePracticeInput(body);
  const persistedTimeZone = await getPracticeTimeZone(owner);
  if (!persistedTimeZone) throw new PracticeTimezoneRequiredError();
  const timeZone = normalizePracticeTimeZone(persistedTimeZone);
  const occurredAt = new Date();
  const scheduled = schedulePracticeOutcome({ outcome: normalized.outcome, timeZone, now: occurredAt });
  const attemptId = crypto.randomUUID();
  const fingerprint = fingerprintPracticeInput(normalized, cardId);
  const db = requireDatabase('record practice attempt');
  const params = [
    attemptId,
    owner,
    cardId,
    occurredAt,
    timeZone,
    normalized.outcome,
    normalized.blocker,
    normalized.reflection,
    normalized.challenge?.approach ?? null,
    normalized.challenge?.invariant ?? null,
    normalized.challenge?.complexity ?? null,
    scheduled.dueAt,
    scheduled.dueReason,
    normalized.idempotencyKey,
    fingerprint,
    occurredAt,
  ];
  const mutation = `WITH card_guard AS (
       SELECT c.id
       FROM cards c
       WHERE c.id = $3 AND c.owner_id = $2
       FOR UPDATE
     ), existing AS (
       SELECT a.id, a.card_id, a.occurred_at, a.time_zone, a.outcome,
              a.next_practice_at, a.due_reason, a.source, a.blocker, a.reflection,
              a.challenge_approach, a.challenge_invariant, a.challenge_complexity,
              a.request_fingerprint
       FROM dsa_practice_attempts a
       JOIN cards c ON c.id = a.card_id AND c.owner_id = a.owner_id
       WHERE a.owner_id = $2 AND a.idempotency_key = $14
     ), claimed AS (
       INSERT INTO dsa_practice_attempts
         (id, owner_id, card_id, occurred_at, time_zone, outcome, blocker, reflection,
          challenge_approach, challenge_invariant, challenge_complexity, next_practice_at,
          due_reason, source, source_event_id, idempotency_key, request_fingerprint, created_at)
       SELECT $1, $2, g.id, $4, $5, $6, $7, $8, $9, $10, $11, $12,
              $13, 'practice', NULL, $14, $15, $16
       FROM card_guard g
       WHERE NOT EXISTS (SELECT 1 FROM existing)
       ON CONFLICT (owner_id, idempotency_key) DO NOTHING
       RETURNING id, card_id, occurred_at, time_zone, outcome, next_practice_at,
                 due_reason, source, blocker, reflection, challenge_approach,
                 challenge_invariant, challenge_complexity, request_fingerprint
     ), projection AS (
       INSERT INTO fsrs_practice_states
         (owner_id, card_id, practice_state, last_practiced_at, next_practice_at, updated_at,
          last_attempt_at, last_outcome, last_independent_solve_at, due_reason, last_attempt_id, revision)
       SELECT $2, $3, 'active', $4, $12, $16, $4, $6,
              CASE WHEN $6 = 'independent' THEN $4 ELSE NULL END, $13, $1, 1
       FROM claimed
       ON CONFLICT (owner_id, card_id) DO UPDATE SET
         practice_state = EXCLUDED.practice_state,
         last_practiced_at = CASE WHEN EXCLUDED.last_attempt_at >= COALESCE(fsrs_practice_states.last_attempt_at, '-infinity'::timestamptz)
                                  THEN EXCLUDED.last_practiced_at ELSE fsrs_practice_states.last_practiced_at END,
         next_practice_at = CASE WHEN EXCLUDED.last_attempt_at >= COALESCE(fsrs_practice_states.last_attempt_at, '-infinity'::timestamptz)
                                 THEN EXCLUDED.next_practice_at ELSE fsrs_practice_states.next_practice_at END,
         updated_at = GREATEST(fsrs_practice_states.updated_at, EXCLUDED.updated_at),
         last_attempt_at = CASE WHEN EXCLUDED.last_attempt_at >= COALESCE(fsrs_practice_states.last_attempt_at, '-infinity'::timestamptz)
                                THEN EXCLUDED.last_attempt_at ELSE fsrs_practice_states.last_attempt_at END,
         last_outcome = CASE WHEN EXCLUDED.last_attempt_at >= COALESCE(fsrs_practice_states.last_attempt_at, '-infinity'::timestamptz)
                             THEN EXCLUDED.last_outcome ELSE fsrs_practice_states.last_outcome END,
         last_independent_solve_at = CASE
           WHEN EXCLUDED.last_outcome = 'independent'
            AND EXCLUDED.last_attempt_at >= COALESCE(fsrs_practice_states.last_independent_solve_at, '-infinity'::timestamptz)
           THEN EXCLUDED.last_independent_solve_at ELSE fsrs_practice_states.last_independent_solve_at END,
         due_reason = CASE WHEN EXCLUDED.last_attempt_at >= COALESCE(fsrs_practice_states.last_attempt_at, '-infinity'::timestamptz)
                           THEN EXCLUDED.due_reason ELSE fsrs_practice_states.due_reason END,
         last_attempt_id = CASE WHEN EXCLUDED.last_attempt_at >= COALESCE(fsrs_practice_states.last_attempt_at, '-infinity'::timestamptz)
                                THEN EXCLUDED.last_attempt_id ELSE fsrs_practice_states.last_attempt_id END,
         revision = fsrs_practice_states.revision + 1
       WHERE EXCLUDED.last_attempt_at >= COALESCE(fsrs_practice_states.last_attempt_at, '-infinity'::timestamptz)
       RETURNING owner_id, card_id, revision
     ), projection_guard AS (
       SELECT COUNT(*) AS written FROM projection
     ), selected AS (
       SELECT e.id, e.card_id, e.occurred_at, e.time_zone, e.outcome,
              e.next_practice_at, e.due_reason, e.source, e.blocker, e.reflection,
              e.challenge_approach, e.challenge_invariant, e.challenge_complexity,
              e.request_fingerprint, TRUE AS replayed
       FROM existing e
       UNION ALL
       SELECT c.id, c.card_id, c.occurred_at, c.time_zone, c.outcome,
              c.next_practice_at, c.due_reason, c.source, c.blocker, c.reflection,
              c.challenge_approach, c.challenge_invariant, c.challenge_complexity,
              c.request_fingerprint, FALSE AS replayed
       FROM claimed c
     )
     SELECT s.* FROM selected s CROSS JOIN projection_guard`;
  let rows = await db.query(mutation, params);
  if (!rows.length) {
    const concurrent = await findPracticeAttemptByKey(db, owner, normalized.idempotencyKey);
    if (concurrent) rows = [{ ...concurrent, replayed: true }];
  }
  if (!rows.length) throw new PracticeNotFoundError('practice card was not found for this owner');
  const row = rows[0];
  if (String(row.request_fingerprint) !== fingerprint) {
    throw new PracticeIdempotencyConflictError(undefined, { idempotencyKey: normalized.idempotencyKey });
  }
  const stateRows = await db.query(
    `SELECT card_id, last_attempt_at, last_outcome, last_independent_solve_at,
            next_practice_at, due_reason, revision
     FROM fsrs_practice_states
     WHERE owner_id = $1 AND card_id = $2`,
    [owner, cardId]
  );
  return {
    replayed: Boolean(row.replayed),
    attempt: toPracticeAttemptSummary(row),
    practice: practiceStateDto(stateRows[0], cardId),
  };
}

async function findPracticeCaptureByKey(db, owner, key) {
  const rows = await db.query(
    `SELECT id AS capture_id, owner_id, card_id, idempotency_key,
            request_fingerprint, status, created_at
     FROM dsa_practice_captures
     WHERE owner_id = $1 AND idempotency_key = $2`,
    [owner, key]
  );
  return rows[0] || null;
}

/**
 * Capture a problem, notes, tags, and an optional practice outcome in one
 * owner-serialized data-modifying statement. The advisory lock is the first
 * capture-identity claim; the unique capture row is inserted only after all
 * dependent writes have been produced by the same CTE statement.
 */
export async function recordPracticeCapture({ ownerId, body } = {}) {
  const owner = requireOwner(ownerId);
  const normalized = normalizePracticeCaptureInput(body);
  const captureIdentity = practiceCaptureIdentity(normalized);
  const captureIdentityKey = `${captureIdentity.type}:${captureIdentity.value}`;
  const ownerIdentityLockKey = `${owner}:capture-identity:${captureIdentityKey}`;
  const ownerIdempotencyLockKey = `${owner}:idempotency:${normalized.idempotencyKey}`;
  const capturedAt = new Date();
  let timeZone = null;
  let scheduled = null;
  if (normalized.outcome) {
    const persistedTimeZone = await getPracticeTimeZone(owner);
    if (!persistedTimeZone) throw new PracticeTimezoneRequiredError();
    timeZone = normalizePracticeTimeZone(persistedTimeZone);
    scheduled = schedulePracticeOutcome({
      outcome: normalized.outcome,
      timeZone,
      now: capturedAt,
    });
  }
  const fingerprint = fingerprintPracticeCaptureInput(normalized);
  const captureId = crypto.randomUUID();
  const cardId = crypto.randomUUID();
  const attemptId = normalized.outcome ? crypto.randomUUID() : null;
  const db = requireDatabase('record practice capture');
  const params = [
    captureId,
    owner,
    normalized.idempotencyKey,
    fingerprint,
    cardId,
    normalized.title,
    normalized.link,
    normalized.description,
    normalized.reference,
    normalized.approach,
    normalized.code,
    normalized.notes,
    normalized.insight,
    normalized.trap,
    normalized.difficulty,
    normalized.tags,
    normalized.outcome,
    timeZone,
    capturedAt,
    scheduled?.dueAt ?? null,
    scheduled?.dueReason ?? null,
    attemptId,
    ownerIdentityLockKey,
    ownerIdempotencyLockKey,
  ];
  const mutation = `WITH capture_lock_keys AS MATERIALIZED (
       SELECT hashtextextended($23::text, 0) AS identity_lock,
              hashtextextended($24::text, 0) AS idempotency_lock
     ), capture_lock AS MATERIALIZED (
       SELECT pg_advisory_xact_lock(LEAST(k.identity_lock, k.idempotency_lock)) AS first_lock,
              pg_advisory_xact_lock(GREATEST(k.identity_lock, k.idempotency_lock)) AS second_lock
       FROM capture_lock_keys k
     ), capture_claim_existing AS MATERIALIZED (
       SELECT c.id AS capture_id, c.owner_id, c.card_id, c.idempotency_key,
              c.request_fingerprint, c.status, c.created_at, FALSE AS claimed_new
       FROM capture_lock l
       JOIN dsa_practice_captures c
         ON c.owner_id = $2 AND c.idempotency_key = $3
       FOR UPDATE
     ), capture_claim AS MATERIALIZED (
       SELECT e.*
       FROM capture_claim_existing e
       UNION ALL
       SELECT NULL::text AS capture_id, $2::text AS owner_id, NULL::text AS card_id,
              $3::text AS idempotency_key, $4::text AS request_fingerprint,
              'pending'::text AS status, $19::timestamptz AS created_at,
              TRUE AS claimed_new
       FROM capture_lock l
       WHERE NOT EXISTS (SELECT 1 FROM capture_claim_existing)
     ), existing AS (
       SELECT * FROM capture_claim WHERE capture_id IS NOT NULL
     ), claimed AS (
       SELECT * FROM capture_claim
     ), duplicate_card AS (
       SELECT c.id
       FROM claimed claim
       JOIN cards c ON c.owner_id = $2
       WHERE claim.claimed_new
         AND (
           ($7::text IS NOT NULL AND BTRIM(c.link) = $7::text)
           OR ($7::text IS NULL
             AND LOWER(regexp_replace(BTRIM(c.question), '\\s+', ' ', 'g'))
                 = LOWER(regexp_replace(BTRIM($6::text), '\\s+', ' ', 'g')))
         )
       ORDER BY c.id ASC
       LIMIT 1
     ), created_card AS (
       INSERT INTO cards
         (id, owner_id, created_at, updated_at, question, answer, link, difficulty,
          actual_code, my_thinking, right_thinking, notes, question_description)
       SELECT $5, $2, $19, $19, $6, COALESCE($9::text, ''), COALESCE($7::text, ''),
              $15, COALESCE($11::text, ''), COALESCE($10::text, ''),
              COALESCE($9::text, ''), COALESCE($12::text, ''), COALESCE($8::text, '')
       FROM claimed claim
       WHERE claim.claimed_new
         AND NOT EXISTS (SELECT 1 FROM duplicate_card)
       RETURNING id
     ), tag_rows AS (
       INSERT INTO tags (id, name)
       SELECT md5($2::text || ':' || input_tag.tag), input_tag.tag
       FROM created_card card
       CROSS JOIN unnest($16::text[]) AS input_tag(tag)
       ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name
       RETURNING id, name
     ), card_tags AS (
       INSERT INTO cards_tags (card_id, tag_id)
       SELECT card.id, tag.id
       FROM created_card card
       CROSS JOIN tag_rows tag
       ON CONFLICT DO NOTHING
       RETURNING card_id
     ), learning_notes AS (
       INSERT INTO dsa_practice_learning_notes
         (owner_id, card_id, key_insight, recurring_trap, created_at, updated_at)
       SELECT $2, card.id, $13, $14, $19, $19
       FROM created_card card
       ON CONFLICT (owner_id, card_id) DO NOTHING
       RETURNING owner_id, card_id
     ), capture_attempt AS (
       INSERT INTO dsa_practice_attempts
         (id, owner_id, card_id, occurred_at, time_zone, outcome, blocker, reflection,
          challenge_approach, challenge_invariant, challenge_complexity, next_practice_at,
          due_reason, source, source_event_id, idempotency_key, request_fingerprint, created_at)
       SELECT $22, $2, card.id, $19, $18, $17, NULL, NULL, NULL, NULL, NULL,
              $20, $21, 'practice', NULL, $3, $4, $19
       FROM created_card card
       WHERE $17::text IS NOT NULL
       RETURNING id, card_id, occurred_at, time_zone, outcome, next_practice_at,
                 due_reason, source, request_fingerprint
     ), projection AS (
       INSERT INTO fsrs_practice_states
         (owner_id, card_id, practice_state, last_practiced_at, next_practice_at, updated_at,
          last_attempt_at, last_outcome, last_independent_solve_at, due_reason, last_attempt_id, revision)
       SELECT $2, a.card_id, 'active', a.occurred_at, a.next_practice_at, a.occurred_at,
              a.occurred_at, a.outcome,
              CASE WHEN a.outcome = 'independent' THEN a.occurred_at ELSE NULL END,
              a.due_reason, a.id, 1
       FROM capture_attempt a
       ON CONFLICT (owner_id, card_id) DO UPDATE SET
         practice_state = EXCLUDED.practice_state,
         last_practiced_at = CASE
           WHEN EXCLUDED.last_attempt_at >= COALESCE(fsrs_practice_states.last_attempt_at, '-infinity'::timestamptz)
           THEN EXCLUDED.last_practiced_at ELSE fsrs_practice_states.last_practiced_at END,
         next_practice_at = CASE
           WHEN EXCLUDED.last_attempt_at >= COALESCE(fsrs_practice_states.last_attempt_at, '-infinity'::timestamptz)
           THEN EXCLUDED.next_practice_at ELSE fsrs_practice_states.next_practice_at END,
         updated_at = GREATEST(fsrs_practice_states.updated_at, EXCLUDED.updated_at),
         last_attempt_at = CASE
           WHEN EXCLUDED.last_attempt_at >= COALESCE(fsrs_practice_states.last_attempt_at, '-infinity'::timestamptz)
           THEN EXCLUDED.last_attempt_at ELSE fsrs_practice_states.last_attempt_at END,
         last_outcome = CASE
           WHEN EXCLUDED.last_attempt_at >= COALESCE(fsrs_practice_states.last_attempt_at, '-infinity'::timestamptz)
           THEN EXCLUDED.last_outcome ELSE fsrs_practice_states.last_outcome END,
         last_independent_solve_at = CASE
           WHEN EXCLUDED.last_outcome = 'independent'
            AND EXCLUDED.last_attempt_at >= COALESCE(fsrs_practice_states.last_independent_solve_at, '-infinity'::timestamptz)
           THEN EXCLUDED.last_independent_solve_at ELSE fsrs_practice_states.last_independent_solve_at END,
         due_reason = CASE
           WHEN EXCLUDED.last_attempt_at >= COALESCE(fsrs_practice_states.last_attempt_at, '-infinity'::timestamptz)
           THEN EXCLUDED.due_reason ELSE fsrs_practice_states.due_reason END,
         last_attempt_id = CASE
           WHEN EXCLUDED.last_attempt_at >= COALESCE(fsrs_practice_states.last_attempt_at, '-infinity'::timestamptz)
           THEN EXCLUDED.last_attempt_id ELSE fsrs_practice_states.last_attempt_id END,
         revision = fsrs_practice_states.revision + 1
       WHERE EXCLUDED.last_attempt_at >= COALESCE(fsrs_practice_states.last_attempt_at, '-infinity'::timestamptz)
       RETURNING owner_id, card_id, last_attempt_at, last_outcome,
                 last_independent_solve_at, next_practice_at, due_reason, revision
     ), projection_guard AS (
       SELECT COUNT(*) AS written FROM projection
     ), capture_record AS (
       INSERT INTO dsa_practice_captures
         (id, owner_id, card_id, idempotency_key, request_fingerprint, status, created_at, updated_at)
       SELECT $1, $2, COALESCE(card.id, duplicate.id), $3, $4,
              CASE WHEN card.id IS NOT NULL THEN 'created'
                   WHEN duplicate.id IS NOT NULL THEN 'duplicate'
                   ELSE 'pending' END,
              $19, $19
       FROM claimed claim
       LEFT JOIN created_card card ON TRUE
       LEFT JOIN duplicate_card duplicate ON TRUE
       CROSS JOIN projection_guard guard
       WHERE claim.claimed_new
       ON CONFLICT (owner_id, idempotency_key) DO NOTHING
       RETURNING id AS capture_id, owner_id, card_id, idempotency_key,
                 request_fingerprint, status, created_at, FALSE AS replayed
     ), selected_capture AS (
       SELECT e.capture_id, e.owner_id, e.card_id, e.idempotency_key,
              e.request_fingerprint, e.status, TRUE AS replayed
       FROM existing e
       UNION ALL
       SELECT r.capture_id, r.owner_id, r.card_id, r.idempotency_key,
              r.request_fingerprint, r.status, r.replayed
       FROM capture_record r
     ), attempt_existing AS (
       SELECT a.id, a.card_id, a.occurred_at, a.time_zone, a.outcome,
              a.next_practice_at, a.due_reason, a.source, a.request_fingerprint
       FROM dsa_practice_attempts a
       JOIN selected_capture sc ON sc.card_id = a.card_id AND sc.replayed
       WHERE a.owner_id = $2 AND a.idempotency_key = $3
         AND a.request_fingerprint = $4
     ), attempt_rows AS (
       SELECT a.* FROM capture_attempt a
       UNION ALL
       SELECT e.* FROM attempt_existing e
       WHERE NOT EXISTS (SELECT 1 FROM capture_attempt)
     ), state_existing AS (
       SELECT s.owner_id, s.card_id, s.last_attempt_at, s.last_outcome,
              s.last_independent_solve_at, s.next_practice_at, s.due_reason, s.revision
       FROM fsrs_practice_states s
       JOIN selected_capture sc ON sc.owner_id = s.owner_id AND sc.card_id = s.card_id
       WHERE NOT EXISTS (
         SELECT 1 FROM projection p
         WHERE p.owner_id = s.owner_id AND p.card_id = s.card_id
       )
     ), state_rows AS (
       SELECT p.* FROM projection p
       UNION ALL
       SELECT e.* FROM state_existing e
     ), selected AS (
       SELECT sc.capture_id, sc.owner_id, sc.card_id, sc.idempotency_key,
              sc.request_fingerprint, sc.status, sc.replayed,
              (sc.status = 'duplicate') AS duplicate,
              ar.id AS attempt_id, ar.card_id AS attempt_card_id,
              ar.occurred_at AS attempt_occurred_at,
              ar.time_zone AS attempt_time_zone, ar.outcome AS attempt_outcome,
              ar.next_practice_at AS attempt_next_practice_at,
              ar.due_reason AS attempt_due_reason, ar.source AS attempt_source,
              sr.last_attempt_at AS practice_last_attempt_at,
              sr.last_outcome AS practice_last_outcome,
              sr.last_independent_solve_at AS practice_last_independent_solve_at,
              sr.next_practice_at AS practice_next_practice_at,
              sr.due_reason AS practice_due_reason,
              sr.revision AS practice_revision
       FROM selected_capture sc
       LEFT JOIN attempt_rows ar ON ar.card_id = sc.card_id
       LEFT JOIN state_rows sr ON sr.owner_id = sc.owner_id AND sr.card_id = sc.card_id
     )
     SELECT * FROM selected`;
  let rows = await db.query(mutation, params);
  if (!rows.length) {
    const concurrent = await findPracticeCaptureByKey(db, owner, normalized.idempotencyKey);
    if (concurrent) rows = [{ ...concurrent, replayed: true, duplicate: concurrent.status === 'duplicate' }];
  }
  if (!rows.length) throw new PracticeNotFoundError('practice capture could not be claimed');
  const row = rows[0];
  if (String(row.request_fingerprint) !== fingerprint) {
    throw new PracticeIdempotencyConflictError(undefined, { idempotencyKey: normalized.idempotencyKey });
  }
  const attempt = row.attempt_id
    ? toPracticeAttemptSummary({
      id: row.attempt_id,
      card_id: row.attempt_card_id,
      occurred_at: row.attempt_occurred_at,
      time_zone: row.attempt_time_zone,
      outcome: row.attempt_outcome,
      next_practice_at: row.attempt_next_practice_at,
      due_reason: row.attempt_due_reason,
      source: row.attempt_source,
    })
    : null;
  return {
    replayed: Boolean(row.replayed),
    duplicate: Boolean(row.duplicate || row.status === 'duplicate'),
    cardId: row.card_id || null,
    attempt,
    practice: practiceStateDto(
      row.practice_revision === undefined || row.practice_revision === null
        ? null
        : {
          last_attempt_at: row.practice_last_attempt_at,
          last_outcome: row.practice_last_outcome,
          last_independent_solve_at: row.practice_last_independent_solve_at,
          next_practice_at: row.practice_next_practice_at,
          due_reason: row.practice_due_reason,
          revision: row.practice_revision,
        },
      row.card_id
    ),
  };
}
