import { getCard, upsertCard, deleteCard, todayISO, recordReview } from '../../lib/db.js';
import { requireAuth } from '../../lib/auth.js';
import { handleOptions, sendAuthError, sendJSON, getBody, badBodyError } from '../../lib/api.js';

function queryValue(req, key) {
  var value = req.query && req.query[key];
  if (Array.isArray(value)) return value[0] ? String(value[0]) : '';
  if (value !== undefined && value !== null) return String(value);
  return new URL(req.url || '', 'http://localhost').searchParams.get(key) || '';
}

function getCardId(req) {
  if (req.query && req.query.cardId) {
    return Array.isArray(req.query.cardId) ? req.query.cardId[0] : req.query.cardId;
  }
  var url = req.url || '';
  var pathname = url.split('?')[0];
  var parts = pathname.split('/').filter(Boolean);
  return parts[2];
}

// Explicit request-edge compatibility mapping for legacy SM-2 clients.
const legacyQualityToRating = {
  1: 'again',
  2: 'hard',
  3: 'hard',
  4: 'good',
  5: 'easy',
};

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
  var cardId = getCardId(req);
  var compactResponse = queryValue(req, 'response') === 'summary';
  var url = req.url || '';
  var pathname = url.split('?')[0];
  var pathParts = pathname.split('/').filter(Boolean);
  var isReviewPath = (pathParts.length === 4 && pathParts[3] === 'review') ||
    (req.query && (req.query.review === '1' || req.query.review === 'true'));

  if (req.method === 'POST' && isReviewPath) {
    try {
      var body = getBody(req);
      var rating = body.rating;
      var quality = body.quality;
      var legacyRating;
      if (quality !== undefined && quality !== null) {
        if (!Number.isInteger(Number(quality)) || quality < 1 || quality > 5) {
          sendJSON(res, 400, { ok: false, error: 'quality must be an integer 1-5' });
          return;
        }
        legacyRating = legacyQualityToRating[Number(quality)];
      }
      // Temporary request-edge compatibility for quality-only legacy clients.
      // Remove after all clients send the explicit FSRS semantic review fields.
      var isLegacyQualityOnly = quality !== undefined && quality !== null && rating === undefined;
      if (rating === undefined || rating === null) rating = legacyRating;
      if (!['again', 'hard', 'good', 'easy'].includes(rating)) {
        sendJSON(res, 400, { ok: false, error: 'rating must be again, hard, good, or easy' });
        return;
      }
      if (legacyRating && rating !== legacyRating) {
        sendJSON(res, 400, { ok: false, error: 'rating and quality contradict each other' });
        return;
      }
      var idempotencyKey = isLegacyQualityOnly
        ? 'legacy-quality-review:' + userId + ':' + cardId + ':' + Number(quality) + ':' + todayISO()
        : body.idempotencyKey;
      if (!isLegacyQualityOnly && (typeof idempotencyKey !== 'string' || !idempotencyKey.trim() || idempotencyKey.length > 200)) {
        sendJSON(res, 400, { ok: false, error: 'idempotencyKey must be a nonempty string of at most 200 characters' });
        return;
      }
      var solvedFromScratch = body.solvedFromScratch;
      if (isLegacyQualityOnly) {
        solvedFromScratch = false;
      }
      if (!isLegacyQualityOnly && typeof body.solvedFromScratch !== 'boolean') {
        sendJSON(res, 400, { ok: false, error: 'solvedFromScratch must be a boolean' });
        return;
      }
      var review = await recordReview({
        cardId,
        userId,
        rating,
        idempotencyKey,
        solvedFromScratch,
      });
      if (review.missing) {
        sendJSON(res, 404, { ok: false, error: 'Card not found' });
        return;
      }
      sendJSON(res, 200, compactResponse ? { ok: true, id: review.card.id } : { ok: true, card: review.card });
    } catch (err) {
      sendJSON(res, 400, { ok: false, error: badBodyError(err) });
    }
    return;
  }

  if (pathParts.length !== 3) {
    sendJSON(res, 405, { ok: false, error: 'Method not allowed' });
    return;
  }

  if (req.method === 'GET') {
    try {
      var found = await getCard(cardId, userId);
      if (!found) {
        sendJSON(res, 404, { ok: false, error: 'Card not found' });
        return;
      }
      sendJSON(res, 200, { ok: true, card: found });
    } catch (e) {
      sendJSON(res, 500, { ok: false, error: 'Internal error' });
    }
    return;
  }

  if (req.method === 'PUT') {
    try {
      var body = getBody(req);
      if (body.question !== undefined && (typeof body.question !== 'string' || !body.question.trim())) {
        sendJSON(res, 400, { ok: false, error: 'question is required' });
        return;
      }
      var existing = await getCard(cardId, userId);
      if (!existing) {
        sendJSON(res, 404, { ok: false, error: 'Card not found' });
        return;
      }
      if (body.question !== undefined) existing.question = body.question;
      if (body.answer !== undefined) existing.answer = body.answer;
      if (body.link !== undefined) existing.link = body.link;
      if (body.tags !== undefined) existing.tags = body.tags;
      if (body.difficulty !== undefined) existing.difficulty = body.difficulty;
      if (body.actual_code !== undefined) existing.actual_code = body.actual_code;
      if (body.my_thinking !== undefined) existing.my_thinking = body.my_thinking;
      if (body.right_thinking !== undefined) existing.right_thinking = body.right_thinking;
      if (body.notes !== undefined) existing.notes = body.notes;
      if (body.questionDescription !== undefined) existing.questionDescription = body.questionDescription;
      existing.updated = todayISO();
      await upsertCard(existing, userId);
      sendJSON(res, 200, compactResponse ? { ok: true, id: existing.id } : { ok: true, card: existing });
    } catch (err) {
      sendJSON(res, 400, { ok: false, error: badBodyError(err) });
    }
    return;
  }

  if (req.method === 'DELETE') {
    try {
      var deleted = await deleteCard(cardId, userId);
      if (!deleted.deleted) {
        sendJSON(res, 404, { ok: false, error: 'Card not found' });
        return;
      }
      sendJSON(res, 200, { ok: true });
    } catch (e) {
      sendJSON(res, 500, { ok: false, error: 'Internal error' });
    }
    return;
  }

  sendJSON(res, 405, { ok: false, error: 'Method not allowed' });
}
