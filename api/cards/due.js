import { load, loadCardSummaries, loadDueCardSummaries, loadDueCards, todayISO } from '../../lib/db.js';
import { requireAuth } from '../../lib/auth.js';
import { handleOptions, sendAuthError, sendJSON, sendConditionalJSON } from '../../lib/api.js';
import { isPracticeError, practiceErrorBody } from '../../lib/dsa-practice.js';

function queryValue(req, key) {
  var value = req.query && req.query[key];
  if (Array.isArray(value)) return value[0] ? String(value[0]) : '';
  if (value !== undefined && value !== null) return String(value);
  return new URL(req.url || '', 'http://localhost').searchParams.get(key) || '';
}

function excludedIds(req) {
  return queryValue(req, 'exclude')
    .split(',')
    .map(function (id) { return id.trim(); })
    .filter(Boolean)
    .slice(0, 200);
}

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

  if (req.method !== 'GET') {
    sendJSON(res, 404, { ok: false, error: 'Not found' });
    return;
  }

  try {
    var useSummary = queryValue(req, 'summary') === '1' || queryValue(req, 'view') === 'summary';
    if (useSummary) {
      var summaryLimit = queryValue(req, 'limit') || undefined;
      var summaryCursor = queryValue(req, 'cursor') || undefined;
      var dueSummary = await loadDueCardSummaries(userId, {
        limit: summaryLimit,
        cursor: summaryCursor,
      });
      sendConditionalJSON(req, res, 200, {
        ok: true,
        cards: dueSummary.cards,
        nextCursor: dueSummary.nextCursor,
        hasMore: dueSummary.hasMore,
        totalCount: dueSummary.totalCount,
        version: dueSummary.version,
      });
      return;
    }
    var limitValue = queryValue(req, 'limit');
    if (!useSummary && limitValue) {
      var limit = Number(limitValue);
      if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
        sendJSON(res, 400, { ok: false, error: 'limit must be an integer between 1 and 50' });
        return;
      }
      var batch = await loadDueCards(userId, { limit: limit, excludeIds: excludedIds(req) });
      sendJSON(res, 200, { ok: true, cards: batch.cards, hasMore: batch.hasMore });
      return;
    }

    var dueData = await load(userId);
    var todayDue = todayISO();
    var dueCards = dueData.cards.filter(function (c) {
      return !c.sm2 || !c.sm2.nextReview || c.sm2.nextReview <= todayDue;
    });
    dueCards.sort(function (a, b) {
      var aNext = a.sm2 && a.sm2.nextReview ? a.sm2.nextReview : '';
      var bNext = b.sm2 && b.sm2.nextReview ? b.sm2.nextReview : '';
      if (aNext !== bNext) {
        if (!aNext) return -1;
        if (!bNext) return 1;
        return aNext < bNext ? -1 : 1;
      }
      var aEF = a.sm2 && a.sm2.easinessFactor != null ? a.sm2.easinessFactor : 2.5;
      var bEF = b.sm2 && b.sm2.easinessFactor != null ? b.sm2.easinessFactor : 2.5;
      return aEF - bEF;
    });
    sendJSON(res, 200, { ok: true, cards: dueCards });
  } catch (e) {
    if (isPracticeError(e)) {
      var payload = practiceErrorBody(e);
      var status = Number.isInteger(payload.status) ? payload.status : 500;
      delete payload.status;
      sendJSON(res, status, payload);
      return;
    }
    sendJSON(res, 500, { ok: false, error: 'Internal error' });
  }
}
