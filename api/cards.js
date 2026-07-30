import { load, upsertCard, upsertUser, todayISO, generateId, defaultSm2 } from '../lib/db.js';
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

  if (req.method === 'GET') {
    try {
      var cardsData = await load(userId);
      var sorted = cardsData.cards.slice().sort(function (a, b) {
        return a.created > b.created ? -1 : a.created < b.created ? 1 : 0;
      });
      sendJSON(res, 200, { ok: true, cards: sorted });
    } catch (e) {
      console.error('[cards GET] Error:', e);
      sendJSON(res, 500, { ok: false, error: e.message || 'Internal error' });
    }
    return;
  }

  if (req.method === 'POST') {
    try {
      var body = getBody(req);
      if (typeof body.question !== 'string' || !body.question.trim()) {
        sendJSON(res, 400, { ok: false, error: 'question is required' });
        return;
      }
      await upsertUser({ clerkId: userId });
      var card = {
        id: generateId(),
        created: todayISO(),
        updated: todayISO(),
        question: body.question,
        answer: body.answer || '',
        link: body.link || '',
        tags: Array.isArray(body.tags) ? body.tags : [],
        difficulty: body.difficulty || 'medium',
        actual_code: body.actual_code || '',
        my_thinking: body.my_thinking || '',
        right_thinking: body.right_thinking || '',
        notes: body.notes || '',
        questionDescription: body.questionDescription || '',
        sm2: defaultSm2()
      };
      await upsertCard(card, userId);
      sendJSON(res, 201, { ok: true, card: card });
    } catch (err) {
      console.error('[cards POST] Error:', err);
      sendJSON(res, 500, { ok: false, error: err.message || 'Internal error' });
    }
    return;
  }

  sendJSON(res, 404, { ok: false, error: 'Not found' });
}
