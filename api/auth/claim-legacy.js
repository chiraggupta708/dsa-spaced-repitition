import { upsertUser, claimLegacyContent } from '../../lib/db.js';
import { requireAuth } from '../../lib/auth.js';
import { handleOptions, sendAuthError, sendJSON } from '../../lib/api.js';

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
