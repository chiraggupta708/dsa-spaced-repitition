import { handleOptions, sendJSON } from '../../lib/api.js';

export default async function handler(req, res) {
  if (handleOptions(req, res)) return;

  if (req.method !== 'GET') {
    sendJSON(res, 404, { ok: false, error: 'Not found' });
    return;
  }

  var publishableKey = process.env.CLERK_PUBLISHABLE_KEY;
  if (!publishableKey) {
    sendJSON(res, 503, { ok: false, error: 'Authentication service unavailable.' });
    return;
  }

  sendJSON(res, 200, { ok: true, publishableKey: publishableKey });
}
