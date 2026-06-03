/**
 * db-postgres.js — Prisma-based database layer for Coding Journal
 *
 * Drop-in replacement for the JSON-file store (lib/db.js).
 * Exports the same interface but reads/writes via Postgres.
 *
 * Usage:
 *   import { load, save, todayISO, generateId, defaultSm2 } from '../lib/db-postgres.js';
 *
 * The `load()` function returns the same { cards: [...] } shape as the old JSON store.
 * The `save()` function persists to Postgres.
 */

import pkg from '@prisma/client';
const { PrismaClient } = pkg;
import { PrismaNeon } from '@prisma/adapter-neon';
import { Pool } from '@neondatabase/serverless';

// ── Singleton Prisma client ──────────────────────────────────────────

const globalForPrisma = globalThis;

function getPrisma() {
  if (globalForPrisma.prisma) return globalForPrisma.prisma;

  const connectionString = process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.POSTGRES_PRISMA_URL;
  if (!connectionString) {
    console.warn(
      '[db-postgres] No Postgres env var found — falling back.\n' +
      '  Set DATABASE_URL, POSTGRES_URL, or POSTGRES_PRISMA_URL.'
    );
    return null;
  }

  const pool = new Pool({ connectionString });
  const adapter = new PrismaNeon(pool);
  const client = new PrismaClient({ adapter });
  globalForPrisma.prisma = client;
  return client;
}

// ── Helpers ──────────────────────────────────────────────────────────

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

// ── Mapping helpers (card <-> DB row) ────────────────────────────────

/** Convert a Prisma Card row to the old JSON card shape. */
function rowToCard(row) {
  return {
    id: row.id,
    created: row.createdAt ? row.createdAt.toISOString().slice(0, 10) : todayISO(),
    updated: row.updatedAt ? row.updatedAt.toISOString().slice(0, 10) : todayISO(),
    question: row.question || '',
    link: row.link || '',
    tags: (row.tags || []).map(ct => ct.tag?.name || ct.tagId),
    difficulty: row.difficulty || 'medium',
    actual_code: row.actualCode || '',
    my_thinking: row.myThinking || '',
    right_thinking: row.rightThinking || '',
    notes: row.notes || '',
    sm2: {
      easinessFactor: row.easinessFactor ?? 2.5,
      interval: row.interval ?? 0,
      repetitions: row.repetitions ?? 0,
      nextReview: row.nextReview ? row.nextReview.toISOString().slice(0, 10) : null,
      lastReview: row.lastReview ? row.lastReview.toISOString().slice(0, 10) : null,
      lastQuality: row.lastQuality ?? null,
    },
  };
}

/** Extract Prisma create fields from the old JSON card shape (excluding tags). */
function cardToCreateFields(card) {
  const sm2 = card.sm2 || {};
  return {
    id: card.id,
    createdAt: card.created ? new Date(card.created) : undefined,
    question: card.question || '',
    link: card.link || '',
    difficulty: card.difficulty || 'medium',
    actualCode: card.actual_code || '',
    myThinking: card.my_thinking || '',
    rightThinking: card.right_thinking || '',
    notes: card.notes || '',
    easinessFactor: sm2.easinessFactor ?? 2.5,
    interval: sm2.interval ?? 0,
    repetitions: sm2.repetitions ?? 0,
    nextReview: sm2.nextReview ? new Date(sm2.nextReview) : null,
    lastReview: sm2.lastReview ? new Date(sm2.lastReview) : null,
    lastQuality: sm2.lastQuality ?? null,
  };
}

/** Upsert tags and return CardTag create records for a card. */
async function buildCardTagCreates(tagNames) {
  if (!Array.isArray(tagNames) || tagNames.length === 0) return [];
  const records = [];
  for (const name of tagNames) {
    const cleanName = name.trim().toLowerCase();
    if (!cleanName) continue;
    const tag = await getPrisma().tag.upsert({
      where: { name: cleanName },
      update: {},
      create: { name: cleanName },
    });
    records.push({ tagId: tag.id });
  }
  return records;
}

// ── Public API (mirrors lib/db.js) ───────────────────────────────────

/**
 * Load all cards from Postgres, returning the same shape as the old JSON store.
 * @returns {Promise<{ cards: Array }>}
 */
export async function load() {
  const prisma = getPrisma();
  if (!prisma) {
    const { default: loadJson } = await import('./db.js');
    // Avoid infinite loop — db.js load uses JSON store
    return { cards: [] };
  }
  const rows = await prisma.card.findMany({
    include: { tags: { include: { tag: true } } },
    orderBy: { createdAt: 'desc' },
  });
  return { cards: rows.map(rowToCard) };
}

/**
 * Save (replace) all cards. Since Postgres is relational, this is a full sync:
 *  1. Delete all CardTag rows for existing cards, then all cards
 *  2. Re-create everything from the payload
 *
 * For production, prefer per-card upsert/update, but this keeps the
 * interface compatible with the old in-memory save() pattern.
 *
 * @param {{ cards: Array }} data — same shape as load() returns
 */
export async function save(data) {
  if (!data || !Array.isArray(data.cards)) {
    throw new Error('save() expects { cards: [...] }');
  }

  const prisma = getPrisma();
  if (!prisma) {
    throw new Error('DATABASE_URL not set — cannot save to Postgres');
  }

  // Delete existing data (cascade handles CardTag)
  await prisma.cardTag.deleteMany();
  await prisma.card.deleteMany();

  // Re-insert all cards
  for (const card of data.cards) {
    const createFields = cardToCreateFields(card);
    await prisma.card.create({
      data: {
        ...createFields,
        tags: {
          create: await buildCardTagCreates(card.tags),
        },
      },
    });
  }
}

// ── Convenience queries ─────────────────────────────────────────────

/** Get a single card by ID (full card shape). */
export async function getCard(id) {
  const prisma = getPrisma();
  if (!prisma) return null;
  const row = await prisma.card.findUnique({
    where: { id },
    include: { tags: { include: { tag: true } } },
  });
  return row ? rowToCard(row) : null;
}

/** Get cards due for review today or earlier. */
export async function getDueCards() {
  const prisma = getPrisma();
  if (!prisma) return [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const rows = await prisma.card.findMany({
    where: {
      OR: [
        { nextReview: null },
        { nextReview: { lte: today } },
      ],
    },
    include: { tags: { include: { tag: true } } },
    orderBy: [
      { nextReview: { sort: 'asc', nulls: 'first' } },
      { easinessFactor: 'asc' },
    ],
  });
  return rows.map(rowToCard);
}

/** Get cards with 5+ repetitions (mastered). */
export async function getMasteredCards() {
  const prisma = getPrisma();
  if (!prisma) return [];
  const rows = await prisma.card.findMany({
    where: { repetitions: { gte: 5 } },
    include: { tags: { include: { tag: true } } },
  });
  return rows.map(rowToCard);
}

/** Count current streak from lastReview dates.
 *
 * When called with an optional `cards` array (e.g. from old JSON-store callers),
 * computes the streak synchronously from that data for backward compatibility.
 * When called without arguments, queries the database directly.
 *
 * @param {Array} [cards] - Optional array of card objects (old JSON-store shape).
 * @returns {Promise<number>}
 */
export async function countStreak(cards) {
  // If cards array was passed (old JSON-store callers like api/stats.js),
  // compute synchronously for backward compat
  if (Array.isArray(cards)) {
    const streaks = {};
    cards.forEach(function (c) {
      if (c.sm2 && c.sm2.lastReview) {
        streaks[c.sm2.lastReview] = true;
      }
    });
    const streakDays = Object.keys(streaks).sort().reverse();
    let count = 0;
    const check = new Date();
    for (let i = 0; i < streakDays.length; i++) {
      const expected = new Date(check);
      expected.setDate(expected.getDate() - count);
      const expectedStr = expected.toISOString().slice(0, 10);
      if (streakDays[i] === expectedStr) {
        count++;
      } else {
        break;
      }
    }
    return count;
  }

  // No cards passed — query the database
  const prisma = getPrisma();
  if (!prisma) return 0;
  const rows = await prisma.card.findMany({
    where: { lastReview: { not: null } },
    select: { lastReview: true },
    orderBy: { lastReview: 'desc' },
  });

  const seen = new Set();
  for (const r of rows) {
    if (r.lastReview) {
      seen.add(r.lastReview.toISOString().slice(0, 10));
    }
  }
  const sortedDays = [...seen].sort().reverse();
  let count = 0;
  const check = new Date();
  for (let i = 0; i < sortedDays.length; i++) {
    const expected = new Date(check);
    expected.setDate(expected.getDate() - count);
    const expectedStr = expected.toISOString().slice(0, 10);
    if (sortedDays[i] === expectedStr) {
      count++;
    } else {
      break;
    }
  }
  return count;
}

/** Get stats object { total, due, mastered, streak }. */
export async function getStats() {
  const prisma = getPrisma();
  if (!prisma) return { total: 0, due: 0, mastered: 0, streak: 0 };
  const total = await prisma.card.count();
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = await prisma.card.count({
    where: {
      OR: [
        { nextReview: null },
        { nextReview: { lte: today } },
      ],
    },
  });
  const mastered = await prisma.card.count({
    where: { repetitions: { gte: 5 } },
  });
  const streak = await countStreak();
  return { total, due, mastered, streak };
}