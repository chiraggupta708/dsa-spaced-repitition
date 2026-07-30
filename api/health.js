import { handleOptions, sendJSON } from '../lib/api.js';

const databaseConfigured = Boolean(
  process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.POSTGRES_PRISMA_URL
);

export default async function handler(req, res) {
  if (handleOptions(req, res)) return;

  if (req.method !== 'GET') {
    sendJSON(res, 404, { ok: false, error: 'Not found' });
    return;
  }

  sendJSON(res, 200, { status: 'ok', databaseConfigured });
}
