import { upsertUser, claimLegacyContent } from '../../lib/db.js';
import { requireAuth } from '../../lib/auth.js';
import { handleOptions, sendAuthError, sendJSON } from '../../lib/api.js';

function getAction(req) {
  var auth = req.query?.auth;
  if (Array.isArray(auth)) return auth[0];
  if (typeof auth === 'string') return auth;

  var pathname = (req.originalUrl || req.url || '').split('?')[0];
  var prefix = '/api/auth/';
  if (pathname.startsWith(prefix)) return pathname.slice(prefix.length).split('/')[0];
  return undefined;
}

export default async function handler(req, res) {
  if (handleOptions(req, res)) return;

  var action = getAction(req);
  if (action === 'config') {
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
    return;
  }

  if (action !== 'me' && action !== 'claim-legacy') {
    sendJSON(res, 404, { ok: false, error: 'Not found' });
    return;
  }

  var auth;
  try {
    auth = await requireAuth(req);
  } catch (error) {
    sendAuthError(res, error);
    return;
  }
  var userId = auth.userId;

  if (action === 'me') {
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
    return;
  }

  if (req.method !== 'POST') {
    sendJSON(res, 404, { ok: false, error: 'Not found' });
    return;
  }

  var legacyOwnerId = process.env.LEGACY_OWNER_CLERK_ID;
  if (!legacyOwnerId) {
    sendJSON(res, 503, { ok: false, error: 'Legacy claim service unavailable.' });
    return;
  }
  if (legacyOwnerId !== userId) {
    sendJSON(res, 403, { ok: false, error: 'Forbidden.' });
    return;
  }

  try {
    await upsertUser({ clerkId: userId });
    var claimed = await claimLegacyContent({ clerkId: userId });
    sendJSON(res, 200, {
      ok: true,
      claimed: { cards: claimed.cards, designs: claimed.designs },
      oneShot: true
    });
  } catch (error) {
    sendJSON(res, 500, { ok: false, error: 'Internal error' });
  }
}
