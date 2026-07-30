import { load, upsertCard, deleteCard, todayISO } from '../../lib/db.js';
import { sm2Calc } from '../../lib/sm2.js';
import { requireAuth } from '../../lib/auth.js';
import { handleOptions, sendAuthError, sendJSON, getBody, badBodyError } from '../../lib/api.js';

function getCardId(req) {
  if (req.query && req.query.cardId) {
    return Array.isArray(req.query.cardId) ? req.query.cardId[0] : req.query.cardId;
  }
  var url = req.url || '';
  var pathname = url.split('?')[0];
  var parts = pathname.split('/').filter(Boolean);
  return parts[2];
}

function findCard(cards, cardId) {
  for (var i = 0; i < cards.length; i++) {
    if (cards[i].id === cardId) return cards[i];
  }
  return null;
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
  var cardId = getCardId(req);
  var url = req.url || '';
  var pathname = url.split('?')[0];
  var pathParts = pathname.split('/').filter(Boolean);
  var isReviewPath = (pathParts.length === 4 && pathParts[3] === 'review') ||
    (req.query && (req.query.review === '1' || req.query.review === 'true'));

  if (req.method === 'POST' && isReviewPath) {
    try {
      var body = getBody(req);
      var quality = body.quality;
      if (quality === undefined || quality === null || !Number.isInteger(Number(quality)) || quality < 1 || quality > 5) {
        sendJSON(res, 400, { ok: false, error: 'quality must be an integer 1-5' });
        return;
      }
      quality = Number(quality);
      var reviewData = await load(userId);
      var card = findCard(reviewData.cards, cardId);
      if (!card) {
        sendJSON(res, 404, { ok: false, error: 'Card not found' });
        return;
      }
      card.sm2 = sm2Calc(quality, card.sm2 || {});
      card.updated = todayISO();
      await upsertCard(card, userId);
      sendJSON(res, 200, { ok: true, card: card });
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
      var getData = await load(userId);
      var found = findCard(getData.cards, cardId);
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
      var updateData = await load(userId);
      var existing = findCard(updateData.cards, cardId);
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
      sendJSON(res, 200, { ok: true, card: existing });
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
