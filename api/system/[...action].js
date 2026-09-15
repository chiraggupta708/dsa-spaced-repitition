import { loadCardSummaries, todayISO, countStreak } from '../../lib/db.js';
import { requireAuth } from '../../lib/auth.js';
import { handleOptions, sendAuthError, sendJSON } from '../../lib/api.js';

const databaseConfigured = Boolean(
  process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.POSTGRES_PRISMA_URL
);

function getAction(req) {
  var action = req.query?.action;
  if (Array.isArray(action)) return action[0];
  if (typeof action === 'string') return action;

  var pathname = (req.originalUrl || req.url || '').split('?')[0];
  var prefix = '/api/system/';
  if (pathname.startsWith(prefix)) return pathname.slice(prefix.length).split('/')[0];
  // Local Express keeps the public URL rather than applying Vercel rewrites.
  if (pathname === '/api/health') return 'health';
  if (pathname === '/api/migrate') return 'migrate';
  if (pathname === '/api/stats') return 'stats';
  return undefined;
}

export default async function handler(req, res) {
  if (handleOptions(req, res)) return;

  var action = getAction(req);
  if (action === 'health') {
    if (req.method !== 'GET') {
      sendJSON(res, 404, { ok: false, error: 'Not found' });
      return;
    }

    sendJSON(res, 200, { status: 'ok', databaseConfigured });
    return;
  }

  if (action === 'migrate') {
    sendJSON(res, 403, { ok: false, error: 'Migration endpoint is disabled.' });
    return;
  }

  if (action === 'stats') {
    if (req.method !== 'GET') {
      sendJSON(res, 404, { ok: false, error: 'Not found' });
      return;
    }

    var auth;
    try {
      auth = await requireAuth(req);
    } catch (error) {
      sendAuthError(res, error);
      return;
    }

    try {
      var dataStats = await loadCardSummaries(auth.userId);
      var allCards = dataStats.cards;
      var total = allCards.length;
      var mastered = 0;
      var due = 0;
      var todayStr = todayISO();
      allCards.forEach(function (c) {
        if (c.sm2 && c.sm2.repetitions >= 5) mastered++;
        if (!c.sm2 || !c.sm2.nextReview || c.sm2.nextReview <= todayStr) due++;
      });
      var streak = await countStreak(auth.userId, allCards);
      sendJSON(res, 200, {
        ok: true,
        stats: { total: total, due: due, mastered: mastered, streak: streak }
      });
    } catch (e) {
      console.error('[stats] Error:', e);
      sendJSON(res, 500, { ok: false, error: e.message || 'Internal error' });
    }
    return;
  }

  sendJSON(res, 404, { ok: false, error: 'Not found' });
}
