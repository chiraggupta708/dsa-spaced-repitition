import { save } from '../lib/db.js';
import { handleOptions, sendJSON, getBody, badBodyError } from '../lib/api.js';

export default async function handler(req, res) {
  if (handleOptions(req, res)) return;

  if (req.method !== 'POST') {
    sendJSON(res, 404, { ok: false, error: 'Not found' });
    return;
  }

  try {
    var body = getBody(req);
    if (!body || !Array.isArray(body.cards)) {
      sendJSON(res, 400, { ok: false, error: 'Body must have a cards array' });
      return;
    }
    await save({ cards: body.cards });
    sendJSON(res, 200, { ok: true, count: body.cards.length });
  } catch (err) {
    sendJSON(res, 400, { ok: false, error: badBodyError(err) });
  }
}
