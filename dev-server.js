#!/usr/bin/env node
/**
 * Local dev server — works without Vercel KV.
 * db.js auto-detects and falls back to data/journal.json.
 *
 * Usage: node dev-server.js [port]
 */

import express from 'express';
import path from 'node:path';

const PORT = parseInt(process.argv[2], 10) || 3000;

const app = express();
app.use(express.json());

/* ------------------------------------------------------------------ */
/*  API routes                                                         */
/*  The [...cardId].js handler self-parses the URL for cardId & review  */
/*  so we just route all paths it knows about                          */
/* ------------------------------------------------------------------ */

const cardHandler = (await import('./api/cards/[...cardId].js')).default;

app.all('/api/health',             (await import('./api/health.js')).default);
app.all('/api/auth/config',        (await import('./api/auth/config.js')).default);
app.all('/api/auth/me',            (await import('./api/auth/me.js')).default);
app.all('/api/auth/claim-legacy',  (await import('./api/auth/claim-legacy.js')).default);
app.all('/api/cards/due',          (await import('./api/cards/due.js')).default);
app.all('/api/cards/mastered',     (await import('./api/cards/mastered.js')).default);
app.all('/api/stats',              (await import('./api/stats.js')).default);
app.all('/api/export',             (await import('./api/export.js')).default);
app.all('/api/import',             (await import('./api/import.js')).default);
app.all('/api/leetcode/fetch',      (await import('./api/leetcode/fetch.js')).default);
app.all('/api/migrate',             (await import('./api/migrate.js')).default);
app.all('/api/cards',              (await import('./api/cards.js')).default);
app.all('/api/cards/:cardId',      cardHandler);
app.post('/api/cards/:cardId/review', cardHandler);

// Designs (LLD/HLD) — added with the Designs feature
app.all('/api/designs',           (await import('./api/designs.js')).default);
app.all('/api/designs/:id',       (await import('./api/designs/[id].js')).default);

// Serve index.html (must be before 404 catch-all)
import fs from 'node:fs';
app.get('/', (req, res) => {
  res.type('html').send(fs.readFileSync(path.resolve(import.meta.dirname, 'index.html'), 'utf-8'));
});

// 404 catch-all
app.use((req, res) => {
  res.status(404).json({ ok: false, error: 'Not found' });
});

app.listen(PORT, () => {
  console.log(`\n  🦾 Coding Journal — local dev server`);
  console.log(`  ──────────────────────────────────────`);
  console.log(`  API:    http://localhost:${PORT}/api/`);
  console.log(`  Health: http://localhost:${PORT}/api/health`);
  console.log(`  Cards:  http://localhost:${PORT}/api/cards`);
  console.log(`  Due:    http://localhost:${PORT}/api/cards/due`);
  console.log(`  Stats:  http://localhost:${PORT}/api/stats`);
  console.log(`  Export: http://localhost:${PORT}/api/export`);
  console.log(`  UI:     http://localhost:${PORT}/`);
  console.log(`\n  (using data/journal.json — no Vercel KV required)\n`);
});