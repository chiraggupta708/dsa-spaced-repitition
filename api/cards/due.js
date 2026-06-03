import { load, todayISO } from '../../lib/db.js';
import { handleOptions, sendJSON } from '../../lib/api.js';

export default async function handler(req, res) {
  if (handleOptions(req, res)) return;

  if (req.method !== 'GET') {
    sendJSON(res, 404, { ok: false, error: 'Not found' });
    return;
  }

  try {
    var dueData = await load();
    var todayDue = todayISO();
    var dueCards = dueData.cards.filter(function (c) {
      return !c.sm2 || !c.sm2.nextReview || c.sm2.nextReview <= todayDue;
    });
    dueCards.sort(function (a, b) {
      var aNext = a.sm2 && a.sm2.nextReview ? a.sm2.nextReview : '';
      var bNext = b.sm2 && b.sm2.nextReview ? b.sm2.nextReview : '';
      if (aNext !== bNext) {
        if (!aNext) return -1;
        if (!bNext) return 1;
        return aNext < bNext ? -1 : 1;
      }
      var aEF = a.sm2 && a.sm2.easinessFactor != null ? a.sm2.easinessFactor : 2.5;
      var bEF = b.sm2 && b.sm2.easinessFactor != null ? b.sm2.easinessFactor : 2.5;
      return aEF - bEF;
    });
    sendJSON(res, 200, { ok: true, cards: dueCards });
  } catch (e) {
    sendJSON(res, 500, { ok: false, error: 'Internal error' });
  }
}
