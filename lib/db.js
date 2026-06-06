/**
 * db.js — Neon SQL backend (HTTP mode, no Prisma/WebSocket needed)
 *
 * Uses @neondatabase/serverless tagged-template function directly.
 * Works on any serverless runtime (Vercel, Cloudflare, etc.).
 *
 * Exports the same interface as before:
 *   load(), save(data), todayISO(), generateId(), defaultSm2(), countStreak(cards?)
 */

import { neon } from '@neondatabase/serverless';
import crypto from 'node:crypto';

const connectionString =
  process.env.DATABASE_URL ||
  process.env.POSTGRES_URL ||
  process.env.POSTGRES_PRISMA_URL;

const sql = connectionString ? neon(connectionString) : null;

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

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

/* ------------------------------------------------------------------ */
/*  Row ↔ Card shape mappers                                          */
/* ------------------------------------------------------------------ */

/** Convert a DB row (snake_case columns + tags json) to the JSON card shape. */
function rowToCard(row) {
  const tags = Array.isArray(row.tags) ? row.tags.map((t) => t.name || t) : [];
  return {
    id: row.id,
    created: row.created_at
      ? new Date(row.created_at).toISOString().slice(0, 10)
      : todayISO(),
    updated: row.updated_at
      ? new Date(row.updated_at).toISOString().slice(0, 10)
      : todayISO(),
    question: row.question || '',
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
      nextReview: row.next_review
        ? new Date(row.next_review).toISOString().slice(0, 10)
        : null,
      lastReview: row.last_review
        ? new Date(row.last_review).toISOString().slice(0, 10)
        : null,
      lastQuality: row.last_quality ?? null,
    },
  };
}

/* ------------------------------------------------------------------ */
/*  Public API                                                         */
/* ------------------------------------------------------------------ */

/**
 * Load all cards from Postgres, returning { cards: [...] }.
 */
export async function load() {
  if (!sql) {
    return { cards: [] };
  }

  const rows = await sql`
    SELECT c.*,
           COALESCE(
             json_agg(json_build_object('id', t.id, 'name', t.name))
               FILTER (WHERE t.id IS NOT NULL),
             '[]'::json
           ) AS tags
    FROM cards c
    LEFT JOIN cards_tags ct ON ct.card_id = c.id
    LEFT JOIN tags t ON t.id = ct.tag_id
    GROUP BY c.id
    ORDER BY c.created_at DESC
  `;

  return { cards: rows.map(rowToCard) };
}

/**
 * Save (replace) all cards. Clears existing data and re-inserts everything.
 */
export async function save(data) {
  if (!sql) {
    throw new Error('DATABASE_URL not set — cannot save');
  }
  if (!data || !Array.isArray(data.cards)) {
    throw new Error('save() expects { cards: [...] }');
  }

  // Clear existing data (order matters for FK constraints)
  await sql`DELETE FROM cards_tags`;
  await sql`DELETE FROM cards`;
  await sql`DELETE FROM tags`;

  // Re-insert all cards
  for (const card of data.cards) {
    const sm2 = card.sm2 || {};
    const createdAt = card.created ? new Date(card.created) : new Date();
    const updatedAt = card.updated ? new Date(card.updated) : new Date();
    const nextReview = sm2.nextReview ? new Date(sm2.nextReview) : null;
    const lastReview = sm2.lastReview ? new Date(sm2.lastReview) : null;

    await sql.query(
      `INSERT INTO cards
         (id, created_at, updated_at, question, link, difficulty,
          actual_code, my_thinking, right_thinking, notes,
          question_description,
          easiness_factor, interval, repetitions,
          next_review, last_review, last_quality)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
      [
        card.id,
        createdAt,
        updatedAt,
        card.question || '',
        card.link || '',
        card.difficulty || 'medium',
        card.actual_code || '',
        card.my_thinking || '',
        card.right_thinking || '',
        card.notes || '',
        card.questionDescription || '',
        sm2.easinessFactor ?? 2.5,
        sm2.interval ?? 0,
        sm2.repetitions ?? 0,
        nextReview,
        lastReview,
        sm2.lastQuality ?? null,
      ]
    );

    // Upsert tags and create junction records
    if (Array.isArray(card.tags)) {
      for (const tagName of card.tags) {
        const name = tagName.trim().toLowerCase();
        if (!name) continue;

        const tagResult = await sql.query(
          `INSERT INTO tags (id, name) VALUES ($1, $2)
           ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name
           RETURNING id`,
          [crypto.randomUUID(), name]
        );
        const tagId = tagResult[0].id;

        await sql.query(
          'INSERT INTO cards_tags (card_id, tag_id) VALUES ($1, $2)',
          [card.id, tagId]
        );
      }
    }
  }
}

/**
 * Count streak from lastReview dates.
 * Accepts optional cards array for backward compat.
 */
export async function countStreak(cards) {
  // If cards array passed directly, compute from it (synchronous helper)
  if (Array.isArray(cards)) {
    return _countStreakFromCards(cards);
  }

  // Query DB
  if (!sql) return 0;

  const rows = await sql`
    SELECT DISTINCT last_review
    FROM cards
    WHERE last_review IS NOT NULL
    ORDER BY last_review DESC
  `;

  const days = rows
    .map((r) => new Date(r.last_review).toISOString().slice(0, 10))
    .filter(Boolean);

  return _countStreakFromDays(days);
}

/* ------------------------------------------------------------------ */
/*  Internal streak helpers                                           */
/* ------------------------------------------------------------------ */

function _countStreakFromCards(cards) {
  const streaks = {};
  (cards || []).forEach(function (c) {
    if (c.sm2 && c.sm2.lastReview) {
      streaks[c.sm2.lastReview] = true;
    }
  });
  return _countStreakFromDays(Object.keys(streaks));
}

function _countStreakFromDays(days) {
  const sorted = [...new Set(days)].sort().reverse();
  let count = 0;
  const check = new Date();
  for (let i = 0; i < sorted.length; i++) {
    const expected = new Date(check);
    expected.setDate(expected.getDate() - count);
    const expectedStr = expected.toISOString().slice(0, 10);
    if (sorted[i] === expectedStr) {
      count++;
    } else {
      break;
    }
  }
  return count;
}