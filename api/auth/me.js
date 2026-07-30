import { upsertUser } from '../../lib/db.js';
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
    await upsertUser({ clerkId: userId });
    sendJSON(res, 200, { ok: true, user: { id: userId } });
  } catch (error) {
    sendJSON(res, 500, { ok: false, error: 'Internal error' });
  }
}
