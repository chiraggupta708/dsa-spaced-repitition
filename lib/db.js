/**
 * db.js — Auto-detecting backend selector
 *
 * - If DATABASE_URL is set (e.g. Vercel Postgres), delegates to db-postgres.js
 * - Otherwise, uses local JSON-file storage for local dev
 *
 * All existing API endpoints import from this file and work transparently.
 */

import fs from 'node:fs';
import path from 'node:path';

// Auto-detect: if a Postgres env var is set, use Postgres/Prisma.
// Vercel Neon integration sets POSTGRES_URL (not DATABASE_URL).
const PG_URL = process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.POSTGRES_PRISMA_URL || '';
const USE_POSTGRES = !!PG_URL;

let pgExports;
if (USE_POSTGRES) {
  // Dynamic import so the Prisma/Neon dependencies are only loaded when Postgres is used
  pgExports = await import('./db-postgres.js');
}

/* ------------------------------------------------------------------ */
/*  Local JSON-file store (fallback when Postgres is not available)    */
/* ------------------------------------------------------------------ */

const DATA_DIR = path.resolve(import.meta.dirname, '..', 'data');
const DATA_FILE = path.join(DATA_DIR, 'journal.json');

function ensureDataFile() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, JSON.stringify({ cards: [] }), 'utf-8');
  }
}

/* ------------------------------------------------------------------ */
/*  Unified API — same signatures exported                             */
/* ------------------------------------------------------------------ */

/**
 * Load all cards.
 * Postgres path: queries the database and returns { cards: [...] }
 * Local path: reads from JSON file.
 */
export async function load() {
  if (USE_POSTGRES) {
    return pgExports.load();
  }

  // local file fallback
  ensureDataFile();
  const raw = fs.readFileSync(DATA_FILE, 'utf-8');
  return JSON.parse(raw);
}

/**
 * Save (replace) all cards.
 */
export async function save(data) {
  if (USE_POSTGRES) {
    return pgExports.save(data);
  }

  ensureDataFile();
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf-8');
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
    lastQuality: null
  };
}

/**
 * Count streak. Delegates to Postgres if available, or computes from cards array.
 * Accepts optional cards array for backward compat with old callers.
 */
export function countStreak(cards) {
  if (USE_POSTGRES) {
    // Postgres version is async — returns a promise
    return pgExports.countStreak(cards);
  }

  // Local JSON store — synchronous computation from cards array
  const streaks = {};
  (cards || []).forEach(function (c) {
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