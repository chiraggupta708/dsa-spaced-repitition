import { load } from '../lib/db.js';
import { handleOptions, sendJSON } from '../lib/api.js';

export default async function handler(req, res) {
  if (handleOptions(req, res)) return;

  if (req.method !== 'GET') {
    sendJSON(res, 404, { ok: false, error: 'Not found' });
    return;
  }

  try {
    var data = await load();
    sendJSON(res, 200, { status: 'ok', cards: data.cards.length });
  } catch (e) {
    sendJSON(res, 500, { ok: false, error: 'Internal error' });
  }
}
