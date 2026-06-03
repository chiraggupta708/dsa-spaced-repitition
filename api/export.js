import { load } from '../lib/db.js';
import { applyCors, handleOptions, sendJSON } from '../lib/api.js';

export default async function handler(req, res) {
  if (handleOptions(req, res)) return;

  if (req.method !== 'GET') {
    sendJSON(res, 404, { ok: false, error: 'Not found' });
    return;
  }

  try {
    var exportData = await load();
    var jsonStr = JSON.stringify(exportData, null, 2);
    applyCors(res);
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', 'attachment; filename="coding-journal-backup.json"');
    res.status(200).send(jsonStr);
  } catch (e) {
    sendJSON(res, 500, { ok: false, error: 'Internal error' });
  }
}
