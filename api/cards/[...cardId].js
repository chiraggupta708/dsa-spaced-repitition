import { load, save, todayISO } from '../../lib/db.js';
import { sm2Calc } from '../../lib/sm2.js';
import { handleOptions, sendJSON, getBody, badBodyError } from '../../lib/api.js';

function getCardId(req) {
  if (req.query && req.query.cardId) {
    return Array.isArray(req.query.cardId) ? req.query.cardId[0] : req.query.cardId;
  }
  var url = req.url || '';
  var pathname = url.split('?')[0];
  var parts = pathname.split('/').filter(Boolean);
  return parts[2];
}

export default async function handler(req, res) {
  if (handleOptions(req, res)) return;

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
      var rData = await load();
      var rIdx = -1;
      for (var ri = 0; ri < rData.cards.length; ri++) {
        if (rData.cards[ri].id === cardId) {
          rIdx = ri;
          break;
        }
      }
      if (rIdx === -1) {
        sendJSON(res, 404, { ok: false, error: 'Card not found' });
        return;
      }
      var card = rData.cards[rIdx];
      var newSm2 = sm2Calc(quality, card.sm2 || {});
      card.sm2 = newSm2;
      card.updated = todayISO();
      rData.cards[rIdx] = card;
      await save(rData);
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
      var gData = await load();
      var found = null;
      for (var gi = 0; gi < gData.cards.length; gi++) {
        if (gData.cards[gi].id === cardId) {
          found = gData.cards[gi];
          break;
        }
      }
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
      var uData = await load();
      var idx = -1;
      for (var ui = 0; ui < uData.cards.length; ui++) {
        if (uData.cards[ui].id === cardId) {
          idx = ui;
          break;
        }
      }
      if (idx === -1) {
        sendJSON(res, 404, { ok: false, error: 'Card not found' });
        return;
      }
      var existing = uData.cards[idx];
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
      uData.cards[idx] = existing;
      await save(uData);
      sendJSON(res, 200, { ok: true, card: existing });
    } catch (err) {
      sendJSON(res, 400, { ok: false, error: badBodyError(err) });
    }
    return;
  }

  if (req.method === 'DELETE') {
    try {
      var dData = await load();
      var dIdx = -1;
      for (var di = 0; di < dData.cards.length; di++) {
        if (dData.cards[di].id === cardId) {
          dIdx = di;
          break;
        }
      }
      if (dIdx === -1) {
        sendJSON(res, 404, { ok: false, error: 'Card not found' });
        return;
      }
      dData.cards.splice(dIdx, 1);
      await save(dData);
      sendJSON(res, 200, { ok: true });
    } catch (e) {
      sendJSON(res, 500, { ok: false, error: 'Internal error' });
    }
    return;
  }

  sendJSON(res, 405, { ok: false, error: 'Method not allowed' });
}
