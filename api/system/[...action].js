import { handleOptions, sendJSON } from '../../lib/api.js';

const databaseConfigured = Boolean(
  process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.POSTGRES_PRISMA_URL
);

function getAction(req) {
  var action = req.query?.action;
  if (Array.isArray(action)) return action[0];
  if (typeof action === 'string') return action;

  var pathname = (req.originalUrl || req.url || '').split('?')[0];
  var prefix = '/api/system/';
  if (pathname.startsWith(prefix)) return pathname.slice(prefix.length).split('/')[0];
  // Local Express keeps the public URL rather than applying Vercel rewrites.
  if (pathname === '/api/health') return 'health';
  if (pathname === '/api/migrate') return 'migrate';
  return undefined;
}

export default async function handler(req, res) {
  if (handleOptions(req, res)) return;

  var action = getAction(req);
  if (action === 'health') {
    if (req.method !== 'GET') {
      sendJSON(res, 404, { ok: false, error: 'Not found' });
      return;
    }

    sendJSON(res, 200, { status: 'ok', databaseConfigured });
    return;
  }

  if (action === 'migrate') {
    sendJSON(res, 403, { ok: false, error: 'Migration endpoint is disabled.' });
    return;
  }

  sendJSON(res, 404, { ok: false, error: 'Not found' });
}
