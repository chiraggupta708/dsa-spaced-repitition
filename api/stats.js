import { load, todayISO, countStreak } from '../lib/db.js';
import { handleOptions, sendJSON } from '../lib/api.js';

export default async function handler(req, res) {
  if (handleOptions(req, res)) return;

  if (req.method !== 'GET') {
    sendJSON(res, 404, { ok: false, error: 'Not found' });
    return;
  }

  try {
    var dataStats = await load();
    var allCards = dataStats.cards;
    var total = allCards.length;
    var mastered = 0;
    var due = 0;
    var todayStr = todayISO();
    allCards.forEach(function (c) {
      if (c.sm2 && c.sm2.repetitions >= 5) mastered++;
      if (!c.sm2 || !c.sm2.nextReview || c.sm2.nextReview <= todayStr) due++;
    });
    sendJSON(res, 200, {
      ok: true,
      stats: {
        total: total,
        due: due,
        mastered: mastered,
        streak: countStreak(allCards)
      }
    });
  } catch (e) {
    sendJSON(res, 500, { ok: false, error: 'Internal error' });
  }
}
