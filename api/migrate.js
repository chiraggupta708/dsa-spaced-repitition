import { handleOptions, sendJSON } from '../lib/api.js';

export default async function handler(req, res) {
  if (handleOptions(req, res)) return;

  sendJSON(res, 403, { ok: false, error: 'Migration endpoint is disabled.' });
}
