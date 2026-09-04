import { replaceCardsForOwner, upsertUser } from '../lib/db.js';
import { saveLldDesign, validateLldDesignImports } from '../lib/lld-db.js';
import { requireAuth } from '../lib/auth.js';
import { handleOptions, sendAuthError, sendJSON, getBody, badBodyError } from '../lib/api.js';

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

  try {
    var body = getBody(req);
    var hasCards = Boolean(body && Array.isArray(body.cards));
    var hasLld = Boolean(body && body.lld !== undefined);
    if (!hasCards && !hasLld) {
      sendJSON(res, 400, { ok: false, error: 'Body must have a cards array or lld backup' });
      return;
    }
    if (hasLld && (!body.lld || typeof body.lld !== 'object' || !Array.isArray(body.lld.designs))) {
      sendJSON(res, 400, { ok: false, error: 'lld backup must have a designs array' });
      return;
    }

    // Preflight all LLD identities before mutating cards. normalizeLldDesign rejects
    // owner fields recursively, and the DB check refuses foreign design IDs.
    var lldDesigns = hasLld ? await validateLldDesignImports(body.lld.designs, userId) : [];
    for (var i = 0; i < lldDesigns.length; i += 1) {
      await saveLldDesign(lldDesigns[i], userId);
    }

    if (hasCards && body.cards.length > 0) {
      await upsertUser({ clerkId: userId });
    }
    var result = hasCards ? await replaceCardsForOwner(body.cards, userId) : { count: 0 };
    sendJSON(res, 200, { ok: true, count: result.count, lldCount: lldDesigns.length });
  } catch (err) {
    sendJSON(res, 400, { ok: false, error: badBodyError(err) });
  }
}
