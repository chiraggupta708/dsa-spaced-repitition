/**
 * db.js — Auto-detecting backend selector
 *
 * Priority:
 *   1. Upstash Redis (via KV_REST_API_URL + KV_REST_API_TOKEN env vars)
 *   2. Postgres/Neon (via DATABASE_URL or POSTGRES_URL)
 *   3. Local JSON file (fallback for local dev)
 *
 * All existing API endpoints import from this file and work transparently.
 */

import fs from 'node:fs';
import path from 'node:path';

// Auto-detect which backend to use — check Redis first, then Postgres.
const USE_KV = !!(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN);
const PG_URL = process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.POSTGRES_PRISMA_URL || '';
const USE_POSTGRES = !USE_KV && !!PG_URL;

let kv;
let pgExports;

if (USE_KV) {
  const { Redis } = await import('@upstash/redis');
  kv = new Redis({
    url: process.env.KV_REST_API_URL,
    token: process.env.KV_REST_API_TOKEN,
  });
} else if (USE_POSTGRES) {
  // Dynamic import so Prisma/Neon deps are only loaded when Postgres is used
  pgExports = await import('./db-postgres.js');
}

const DATA_KEY = 'coding:journal:data';

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
  if (USE_KV) {
    try {
      const raw = await kv.get(DATA_KEY);
      const data = raw || {};
      if (!data || !Array.isArray(data.cards)) {
        return { cards: [] };
      }
      return data;
    } catch (err) {
      console.error('Redis load error:', err);
      return { cards: [] };
    }
  }

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
  if (USE_KV) {
    await kv.set(DATA_KEY, data);
    return;
  }

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
export async function countStreak(cards) {
  if (USE_KV) {
    // Load from Redis and compute
    try {
      const data = await load();
      return _countStreakFromCards(data.cards || []);
    } catch (e) {
      return 0;
    }
  }

  if (USE_POSTGRES) {
    // Postgres version is async — returns a promise
    return pgExports.countStreak(cards);
  }

  // Local JSON store — synchronous computation from cards array
  return _countStreakFromCards(cards || []);
}

function _countStreakFromCards(cards) {
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