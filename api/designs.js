import { loadDesigns, saveDesign } from '../lib/db.js';
import { handleOptions, sendJSON, getBody } from '../lib/api.js';

export default async function handler(req, res) {
  if (handleOptions(req, res)) return;

  if (req.method === 'GET') {
    try {
      const url = new URL(req.url, 'http://localhost');
      const kind = url.searchParams.get('kind') || undefined;
      const tag = url.searchParams.get('tag') || undefined;
      const { designs } = await loadDesigns({ kind, tag });
      sendJSON(res, 200, { ok: true, designs });
    } catch (e) {
      console.error('[designs GET] Error:', e);
      sendJSON(res, 500, { ok: false, error: e.message || 'Internal error' });
    }
    return;
  }

  if (req.method === 'POST') {
    try {
      const body = getBody(req);
      if (!body || !body.title) {
        sendJSON(res, 400, { ok: false, error: 'Title is required' });
        return;
      }
      const result = await saveDesign(body);
      sendJSON(res, 201, { ok: true, id: result.id });
    } catch (err) {
      console.error('[designs POST] Error:', err);
      sendJSON(res, 500, { ok: false, error: err.message || 'Internal error' });
    }
    return;
  }

  sendJSON(res, 404, { ok: false, error: 'Not found' });
}
