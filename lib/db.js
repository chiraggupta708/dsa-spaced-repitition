import fs from 'node:fs';
import path from 'node:path';

// Auto-detect: if KV env vars are set, use Upstash Redis remotely.
// These env vars are injected automatically by Vercel when you
// install a Redis integration from the Marketplace (Upstash, Redis Cloud, etc.).
// Fall back to a JSON file for local dev.
const USE_KV = !!(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN);

let redis;
if (USE_KV) {
  const { Redis } = await import('@upstash/redis');
  redis = new Redis({
    url: process.env.KV_REST_API_URL,
    token: process.env.KV_REST_API_TOKEN,
  });
}

const DATA_KEY = 'coding:journal:data';

/* ------------------------------------------------------------------ */
/*  Local file store (used when KV is not available)                   */
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

export async function load() {
  if (USE_KV) {
    try {
      const raw = await redis.get(DATA_KEY);
      // @upstash/redis returns null for missing keys
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

  // local file fallback
  ensureDataFile();
  const raw = fs.readFileSync(DATA_FILE, 'utf-8');
  return JSON.parse(raw);
}

export async function save(data) {
  if (USE_KV) {
    // @upstash/redis auto-serializes objects to JSON
    await redis.set(DATA_KEY, data);
    return;
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

export function countStreak(cards) {
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