#!/usr/bin/env node
/**
 * Explicit, opt-in backfill for verified solved review history.
 *
 * This module is inert when imported. Run it directly, outside schema/build,
 * only after the DSA schema has been deliberately applied to a verified target.
 */
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import {
  normalizePracticeTimeZone,
  schedulePracticeOutcome,
} from '../lib/dsa-practice.js';

export const DEFAULT_BATCH_SIZE = 100;
export const MAX_BATCH_SIZE = 100;
export const LEGACY_SOURCE = 'legacy_review';
export const LEGACY_OUTCOME = 'independent';

function normalizeBatchSize(value = DEFAULT_BATCH_SIZE) {
  const candidate = typeof value === 'string' && value.trim() ? Number(value) : value;
  if (!Number.isInteger(candidate) || candidate <= 0) {
    throw new Error('batchSize must be a positive integer');
  }
  return Math.min(candidate, MAX_BATCH_SIZE);
}

export function parseBackfillArgs(argv = []) {
  let batchSize = DEFAULT_BATCH_SIZE;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--batch-size') {
      batchSize = argv[index + 1];
      index += 1;
    } else if (argument.startsWith('--batch-size=')) {
      batchSize = argument.slice('--batch-size='.length);
    } else if (argument) {
      throw new Error('usage: node scripts/backfill-dsa-practice-history.mjs [--batch-size N]');
    }
  }
  return { batchSize: normalizeBatchSize(batchSize) };
}

function normalizeCursor(cursor) {
  if (!cursor) return { occurredAt: null, id: null };
  const occurredAt = cursor.occurredAt instanceof Date
    ? new Date(cursor.occurredAt.getTime())
    : new Date(cursor.occurredAt);
  if (Number.isNaN(occurredAt.getTime()) || typeof cursor.id !== 'string') {
    throw new Error('backfill cursor must contain a valid occurredAt and id');
  }
  return { occurredAt: occurredAt.toISOString(), id: cursor.id };
}

/** Build one bounded ascending historical-event page using a stable cursor. */
export function buildHistoricalReviewBatchQuery({ cursor = null, limit = DEFAULT_BATCH_SIZE } = {}) {
  const batchLimit = normalizeBatchSize(limit);
  const key = normalizeCursor(cursor);
  return {
    text: `SELECT re.id, re.owner_id, re.card_id, re.occurred_at,
            BTRIM(lp.timezone) AS time_zone
     FROM fsrs_review_events re
     JOIN cards c ON c.id = re.card_id AND c.owner_id = re.owner_id
     JOIN learner_preferences lp ON lp.owner_id = re.owner_id
     WHERE re.solved = TRUE
       AND lp.timezone IS NOT NULL
       AND NULLIF(BTRIM(lp.timezone), '') IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
         FROM dsa_practice_attempts existing
         WHERE existing.source_event_id = re.id
       )
       AND (
         $1::timestamptz IS NULL
         OR (re.occurred_at, re.id) > ($1::timestamptz, $2::text)
       )
     ORDER BY re.occurred_at ASC, re.id ASC
     LIMIT $3`,
    params: [key.occurredAt, key.id, batchLimit],
  };
}

function digest(value) {
  return createHash('sha256').update(value).digest('hex');
}

/** Return stable legacy identity values shared by retries and backfill runs. */
export function buildLegacyPracticeIdentity({ sourceEventId, cardId } = {}) {
  if (typeof sourceEventId !== 'string' || !sourceEventId) {
    throw new Error('sourceEventId is required');
  }
  if (typeof cardId !== 'string' || !cardId) {
    throw new Error('cardId is required');
  }
  const rawLegacyKey = `legacy-review:${sourceEventId}`;
  const idempotencyKey = rawLegacyKey.length <= 200
    ? rawLegacyKey
    : `legacy-review:${digest(sourceEventId)}`;
  const fingerprint = digest(JSON.stringify({
    cardId,
    outcome: LEGACY_OUTCOME,
    source: LEGACY_SOURCE,
    sourceEventId,
  }));
  return Object.freeze({
    attemptId: rawLegacyKey,
    idempotencyKey,
    fingerprint,
  });
}

function validInstant(value, field) {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error(`${field} must be a valid instant`);
  return date;
}

/**
 * Validate and schedule one selected row. Invalid/missing persisted time zones
 * return a skip result so the caller can advance the keyset without inventing a fallback.
 */
export function prepareLegacyPracticeRow(row) {
  try {
    const ownerId = typeof row?.owner_id === 'string' && row.owner_id ? row.owner_id : null;
    const cardId = typeof row?.card_id === 'string' && row.card_id ? row.card_id : null;
    const sourceEventId = typeof row?.id === 'string' && row.id ? row.id : null;
    if (!ownerId || !cardId || !sourceEventId) throw new Error('historical row identity is invalid');
    const occurredAt = validInstant(row.occurred_at, 'occurred_at');
    const timeZone = normalizePracticeTimeZone(row.time_zone);
    const scheduled = schedulePracticeOutcome({
      outcome: 'independent',
      timeZone,
      now: occurredAt,
    });
    const identity = buildLegacyPracticeIdentity({ sourceEventId, cardId });
    return {
      skipped: false,
      id: identity.attemptId,
      ownerId,
      cardId,
      occurredAt: occurredAt.toISOString(),
      timeZone,
      nextPracticeAt: scheduled.nextPracticeAt,
      dueReason: scheduled.dueReason,
      source: LEGACY_SOURCE,
      sourceEventId,
      idempotencyKey: identity.idempotencyKey,
      requestFingerprint: identity.fingerprint,
      createdAt: occurredAt.toISOString(),
    };
  } catch {
    return Object.freeze({ skipped: true, reason: 'invalid_or_missing_timezone_or_history' });
  }
}

function mutationPayload(rows) {
  return rows.map((row) => ({
    id: row.id,
    owner_id: row.ownerId,
    card_id: row.cardId,
    occurred_at: row.occurredAt,
    time_zone: row.timeZone,
    next_practice_at: row.nextPracticeAt,
    due_reason: row.dueReason,
    source_event_id: row.sourceEventId,
    idempotency_key: row.idempotencyKey,
    request_fingerprint: row.requestFingerprint,
    created_at: row.createdAt,
  }));
}

/**
 * Build one atomic insert/projection statement for a prepared batch. The
 * latest_per_card CTE prevents one-card multi-row ON CONFLICT cardinality
 * errors while retaining every inserted immutable attempt.
 */
export function buildLegacyPracticeMutation(rows = []) {
  if (!Array.isArray(rows)) throw new Error('prepared rows must be an array');
  return {
    text: `WITH verified_candidates AS (
       SELECT batch.id, batch.owner_id, batch.card_id, batch.occurred_at,
              batch.time_zone, batch.next_practice_at, batch.due_reason,
              batch.source_event_id, batch.idempotency_key,
              batch.request_fingerprint, batch.created_at
       FROM jsonb_to_recordset($1::jsonb) AS batch(
         id text,
         owner_id text,
         card_id text,
         occurred_at timestamptz,
         time_zone text,
         next_practice_at timestamptz,
         due_reason text,
         source_event_id text,
         idempotency_key text,
         request_fingerprint text,
         created_at timestamptz
       )
       JOIN fsrs_review_events re
         ON re.id = batch.source_event_id
        AND re.owner_id = batch.owner_id
        AND re.card_id = batch.card_id
        AND re.occurred_at = batch.occurred_at
        AND re.solved = TRUE
       JOIN cards c ON c.id = batch.card_id AND c.owner_id = batch.owner_id
       JOIN learner_preferences lp ON lp.owner_id = batch.owner_id
       WHERE batch.time_zone IS NOT NULL
         AND lp.timezone IS NOT NULL
         AND NULLIF(BTRIM(lp.timezone), '') IS NOT NULL
         AND BTRIM(lp.timezone) = batch.time_zone
         AND NOT EXISTS (
           SELECT 1
           FROM dsa_practice_attempts existing
           WHERE existing.source_event_id = batch.source_event_id
         )
     ), inserted AS (
       INSERT INTO dsa_practice_attempts
         (id, owner_id, card_id, occurred_at, time_zone, outcome, blocker, reflection,
          challenge_approach, challenge_invariant, challenge_complexity, next_practice_at,
          due_reason, source, source_event_id, idempotency_key, request_fingerprint, created_at)
       SELECT id, owner_id, card_id, occurred_at, time_zone, 'independent', NULL, NULL,
              NULL, NULL, NULL, next_practice_at, due_reason, 'legacy_review',
              source_event_id, idempotency_key, request_fingerprint, created_at
       FROM verified_candidates
       ON CONFLICT (source_event_id) DO NOTHING
       RETURNING id, owner_id, card_id, occurred_at, outcome, next_practice_at,
                 due_reason, source, source_event_id
     ), latest_per_card AS (
       SELECT DISTINCT ON (owner_id, card_id)
              id, owner_id, card_id, occurred_at, outcome, next_practice_at,
              due_reason, source, source_event_id
       FROM inserted
       ORDER BY owner_id, card_id, occurred_at DESC, source_event_id DESC
     ), projection AS (
       INSERT INTO fsrs_practice_states
         (owner_id, card_id, practice_state, last_practiced_at, next_practice_at, updated_at,
          last_attempt_at, last_outcome, last_independent_solve_at, due_reason, last_attempt_id, revision)
       SELECT owner_id, card_id, 'active', occurred_at, next_practice_at, occurred_at,
              occurred_at, outcome, occurred_at, due_reason, id, 1
       FROM latest_per_card
       ON CONFLICT (owner_id, card_id) DO UPDATE SET
         practice_state = CASE WHEN (
           EXCLUDED.last_attempt_at > COALESCE(fsrs_practice_states.last_attempt_at, '-infinity'::timestamptz)
           OR (EXCLUDED.last_attempt_at = fsrs_practice_states.last_attempt_at
               AND EXCLUDED.last_attempt_id > COALESCE(fsrs_practice_states.last_attempt_id, ''))
         ) THEN EXCLUDED.practice_state ELSE fsrs_practice_states.practice_state END,
         last_practiced_at = CASE WHEN (
           EXCLUDED.last_attempt_at > COALESCE(fsrs_practice_states.last_attempt_at, '-infinity'::timestamptz)
           OR (EXCLUDED.last_attempt_at = fsrs_practice_states.last_attempt_at
               AND EXCLUDED.last_attempt_id > COALESCE(fsrs_practice_states.last_attempt_id, ''))
         ) THEN EXCLUDED.last_practiced_at ELSE fsrs_practice_states.last_practiced_at END,
         next_practice_at = CASE WHEN (
           EXCLUDED.last_attempt_at > COALESCE(fsrs_practice_states.last_attempt_at, '-infinity'::timestamptz)
           OR (EXCLUDED.last_attempt_at = fsrs_practice_states.last_attempt_at
               AND EXCLUDED.last_attempt_id > COALESCE(fsrs_practice_states.last_attempt_id, ''))
         ) THEN EXCLUDED.next_practice_at ELSE fsrs_practice_states.next_practice_at END,
         updated_at = GREATEST(fsrs_practice_states.updated_at, EXCLUDED.updated_at),
         last_attempt_at = CASE WHEN (
           EXCLUDED.last_attempt_at > COALESCE(fsrs_practice_states.last_attempt_at, '-infinity'::timestamptz)
           OR (EXCLUDED.last_attempt_at = fsrs_practice_states.last_attempt_at
               AND EXCLUDED.last_attempt_id > COALESCE(fsrs_practice_states.last_attempt_id, ''))
         ) THEN EXCLUDED.last_attempt_at ELSE fsrs_practice_states.last_attempt_at END,
         last_outcome = CASE WHEN (
           EXCLUDED.last_attempt_at > COALESCE(fsrs_practice_states.last_attempt_at, '-infinity'::timestamptz)
           OR (EXCLUDED.last_attempt_at = fsrs_practice_states.last_attempt_at
               AND EXCLUDED.last_attempt_id > COALESCE(fsrs_practice_states.last_attempt_id, ''))
         ) THEN EXCLUDED.last_outcome ELSE fsrs_practice_states.last_outcome END,
         last_independent_solve_at = CASE WHEN (
           EXCLUDED.last_independent_solve_at > COALESCE(fsrs_practice_states.last_independent_solve_at, '-infinity'::timestamptz)
           OR (EXCLUDED.last_independent_solve_at = fsrs_practice_states.last_independent_solve_at
               AND EXCLUDED.last_attempt_id > COALESCE(fsrs_practice_states.last_attempt_id, ''))
         ) THEN EXCLUDED.last_independent_solve_at ELSE fsrs_practice_states.last_independent_solve_at END,
         due_reason = CASE WHEN (
           EXCLUDED.last_attempt_at > COALESCE(fsrs_practice_states.last_attempt_at, '-infinity'::timestamptz)
           OR (EXCLUDED.last_attempt_at = fsrs_practice_states.last_attempt_at
               AND EXCLUDED.last_attempt_id > COALESCE(fsrs_practice_states.last_attempt_id, ''))
         ) THEN EXCLUDED.due_reason ELSE fsrs_practice_states.due_reason END,
         last_attempt_id = CASE WHEN (
           EXCLUDED.last_attempt_at > COALESCE(fsrs_practice_states.last_attempt_at, '-infinity'::timestamptz)
           OR (EXCLUDED.last_attempt_at = fsrs_practice_states.last_attempt_at
               AND EXCLUDED.last_attempt_id > COALESCE(fsrs_practice_states.last_attempt_id, ''))
         ) THEN EXCLUDED.last_attempt_id ELSE fsrs_practice_states.last_attempt_id END,
         revision = fsrs_practice_states.revision + 1
       WHERE (
         EXCLUDED.last_attempt_at > COALESCE(fsrs_practice_states.last_attempt_at, '-infinity'::timestamptz)
         OR (EXCLUDED.last_attempt_at = fsrs_practice_states.last_attempt_at
             AND EXCLUDED.last_attempt_id > COALESCE(fsrs_practice_states.last_attempt_id, ''))
         OR EXCLUDED.last_independent_solve_at > COALESCE(fsrs_practice_states.last_independent_solve_at, '-infinity'::timestamptz)
         OR (EXCLUDED.last_independent_solve_at = fsrs_practice_states.last_independent_solve_at
             AND EXCLUDED.last_attempt_id > COALESCE(fsrs_practice_states.last_attempt_id, ''))
       )
       RETURNING owner_id, card_id, revision
     )
     SELECT
       (SELECT COUNT(*) FROM inserted)::integer AS inserted_count,
       (SELECT COUNT(*) FROM projection)::integer AS projected_count`,
    params: [JSON.stringify(mutationPayload(rows))],
  };
}

function cursorFromRow(row) {
  const occurredAt = validInstant(row.occurred_at, 'occurred_at');
  if (typeof row.id !== 'string' || !row.id) throw new Error('historical row id is invalid');
  return { occurredAt: occurredAt.toISOString(), id: row.id };
}

/** Run the bounded backfill only when explicitly called or directly invoked. */
export async function backfillDsaPracticeHistory({
  connectionString = process.env.DATABASE_URL || process.env.POSTGRES_URL,
  batchSize = DEFAULT_BATCH_SIZE,
  dbClient = null,
} = {}) {
  if (!connectionString) {
    throw new Error('DATABASE_URL (or POSTGRES_URL) is required.');
  }
  const limit = normalizeBatchSize(batchSize);
  const db = dbClient || (await import('@neondatabase/serverless')).neon(connectionString);
  const totals = {
    batches: 0,
    scanned: 0,
    prepared: 0,
    skipped: 0,
    inserted: 0,
    projected: 0,
  };
  let cursor = null;
  while (true) {
    const batchQuery = buildHistoricalReviewBatchQuery({ cursor, limit });
    const rows = await db.query(batchQuery.text, batchQuery.params);
    totals.batches += 1;
    if (!rows.length) break;
    totals.scanned += rows.length;
    const prepared = [];
    for (const row of rows) {
      const candidate = prepareLegacyPracticeRow(row);
      if (candidate.skipped) {
        totals.skipped += 1;
      } else {
        prepared.push(candidate);
      }
    }
    totals.prepared += prepared.length;
    if (prepared.length) {
      const mutation = buildLegacyPracticeMutation(prepared);
      const resultRows = await db.query(mutation.text, mutation.params);
      const result = resultRows[0] || {};
      totals.inserted += Number(result.inserted_count || 0);
      totals.projected += Number(result.projected_count || 0);
    }
    cursor = cursorFromRow(rows[rows.length - 1]);
  }
  return totals;
}

const isDirectInvocation = process.argv[1]
  && fileURLToPath(import.meta.url) === process.argv[1];
if (isDirectInvocation) {
  try {
    const { batchSize } = parseBackfillArgs(process.argv.slice(2));
    const result = await backfillDsaPracticeHistory({ batchSize });
    console.log(JSON.stringify(result));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
