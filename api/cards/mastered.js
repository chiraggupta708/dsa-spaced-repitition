import { load } from '../../lib/db.js';
import { requireAuth } from '../../lib/auth.js';
import { handleOptions, sendAuthError, sendJSON } from '../../lib/api.js';

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
    var masteredData = await load(userId);
    var masteredCards = masteredData.cards.filter(function (c) {
      return c.sm2 && c.sm2.repetitions >= 5;
    });
    sendJSON(res, 200, { ok: true, cards: masteredCards });
  } catch (e) {
    console.error('[mastered GET] Error:', e);
    sendJSON(res, 500, { ok: false, error: e.message || 'Internal error' });
  }
}
