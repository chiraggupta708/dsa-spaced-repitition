import { saveDesign, deleteDesign, getDesign } from '../../lib/db.js';
import { handleOptions, sendJSON, getBody } from '../../lib/api.js';

export default async function handler(req, res) {
  if (handleOptions(req, res)) return;

  const id = req.query.id;
  if (!id) {
    sendJSON(res, 400, { ok: false, error: 'Missing design id' });
    return;
  }

  if (req.method === 'GET') {
    try {
      const design = await getDesign(id);
      if (!design) {
        sendJSON(res, 404, { ok: false, error: 'Design not found' });
        return;
      }
      sendJSON(res, 200, { ok: true, design });
    } catch (err) {
      console.error('[designs GET :id] Error:', err);
      sendJSON(res, 500, { ok: false, error: err.message || 'Internal error' });
    }
    return;
  }

  if (req.method === 'PUT') {
    try {
      const body = getBody(req);
      const result = await saveDesign({ ...body, id });
      sendJSON(res, 200, { ok: true, id: result.id });
    } catch (err) {
      console.error('[designs PUT] Error:', err);
      sendJSON(res, 500, { ok: false, error: err.message || 'Internal error' });
    }
    return;
  }

  if (req.method === 'DELETE') {
    try {
      await deleteDesign(id);
      sendJSON(res, 200, { ok: true });
    } catch (err) {
      console.error('[designs DELETE] Error:', err);
      sendJSON(res, 500, { ok: false, error: err.message || 'Internal error' });
    }
    return;
  }

  sendJSON(res, 404, { ok: false, error: 'Not found' });
}
