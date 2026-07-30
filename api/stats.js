import { load, todayISO, countStreak } from '../lib/db.js';
import { requireAuth } from '../lib/auth.js';
import { handleOptions, sendAuthError, sendJSON } from '../lib/api.js';

export default async function handler(req, res) {
  if (handleOptions(req, res)) return;

  var auth;
  try {
    auth = await requireAuth(req);
  } catch (error) {
    sendAuthError(res, error);
    return;
  }
  var userId = auth.userId;

  if (req.method !== 'GET') {
    sendJSON(res, 404, { ok: false, error: 'Not found' });
    return;
  }

  try {
    var dataStats = await load(userId);
    var allCards = dataStats.cards;
    var total = allCards.length;
    var mastered = 0;
    var due = 0;
    var todayStr = todayISO();
    allCards.forEach(function (c) {
      if (c.sm2 && c.sm2.repetitions >= 5) mastered++;
      if (!c.sm2 || !c.sm2.nextReview || c.sm2.nextReview <= todayStr) due++;
    });
    var streak = await countStreak(userId, allCards);
    sendJSON(res, 200, {
      ok: true,
      stats: { total: total, due: due, mastered: mastered, streak: streak }
    });
  } catch (e) {
    console.error('[stats] Error:', e);
    sendJSON(res, 500, { ok: false, error: e.message || 'Internal error' });
  }
}
