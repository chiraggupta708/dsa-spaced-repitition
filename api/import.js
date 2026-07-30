import { replaceCardsForOwner } from '../lib/db.js';
import { requireAuth } from '../lib/auth.js';
import { handleOptions, sendAuthError, sendJSON, getBody, badBodyError } from '../lib/api.js';

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
    var result = await replaceCardsForOwner(body.cards, userId);
    sendJSON(res, 200, { ok: true, count: result.count });
  } catch (err) {
    sendJSON(res, 400, { ok: false, error: badBodyError(err) });
  }
}
