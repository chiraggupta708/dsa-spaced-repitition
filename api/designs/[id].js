import { saveDesign, deleteDesign, getDesign, upsertUser } from '../../lib/db.js';
import { requireAuth } from '../../lib/auth.js';
import { handleOptions, sendAuthError, sendJSON, getBody } from '../../lib/api.js';

export default async function handler(req, res) {
  if (handleOptions(req, res)) return;

  let userId;
  try {
    ({ userId } = await requireAuth(req));
  } catch (error) {
    sendAuthError(res, error);
    return;
  }

  const id = req.query.id;
  if (!id) {
    sendJSON(res, 400, { ok: false, error: 'Missing design id' });
    return;
  }

  if (req.method === 'GET') {
    try {
      const design = await getDesign(id, userId);
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
      await upsertUser({ clerkId: userId });
      const result = await saveDesign({ ...body, id }, userId);
      sendJSON(res, 200, { ok: true, id: result.id });
    } catch (err) {
      console.error('[designs PUT] Error:', err);
      sendJSON(res, 500, { ok: false, error: err.message || 'Internal error' });
    }
    return;
  }

  if (req.method === 'DELETE') {
    try {
      await upsertUser({ clerkId: userId });
      await deleteDesign(id, userId);
      sendJSON(res, 200, { ok: true });
    } catch (err) {
      console.error('[designs DELETE] Error:', err);
      sendJSON(res, 500, { ok: false, error: err.message || 'Internal error' });
    }
    return;
  }

  sendJSON(res, 404, { ok: false, error: 'Not found' });
}
