import { load } from '../lib/db.js';
import { requireAuth } from '../lib/auth.js';
import { applyCors, handleOptions, sendAuthError, sendJSON } from '../lib/api.js';

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
    var exportData = await load(userId);
    var jsonStr = JSON.stringify(exportData, null, 2);
    applyCors(res);
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', 'attachment; filename="coding-journal-backup.json"');
    res.status(200).send(jsonStr);
  } catch (e) {
    sendJSON(res, 500, { ok: false, error: 'Internal error' });
  }
}
