import { load } from '../../lib/db.js';
import { handleOptions, sendJSON } from '../../lib/api.js';

export default async function handler(req, res) {
  if (handleOptions(req, res)) return;

  if (req.method !== 'GET') {
    sendJSON(res, 404, { ok: false, error: 'Not found' });
    return;
  }

  try {
    var masteredData = await load();
    var masteredCards = masteredData.cards.filter(function (c) {
      return c.sm2 && c.sm2.repetitions >= 5;
    });
    sendJSON(res, 200, { ok: true, cards: masteredCards });
  } catch (e) {
    sendJSON(res, 500, { ok: false, error: 'Internal error' });
  }
}
