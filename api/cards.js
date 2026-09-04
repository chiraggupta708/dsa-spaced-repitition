import { load, loadCardSummaries, upsertCard, upsertUser, todayISO, generateId, defaultSm2 } from '../lib/db.js';
import { requireAuth } from '../lib/auth.js';
import { handleOptions, sendAuthError, sendJSON, sendConditionalJSON, getBody, badBodyError } from '../lib/api.js';

function queryValue(req, key) {
  var value = req.query && req.query[key];
  if (Array.isArray(value)) return value[0] ? String(value[0]) : '';
  if (value !== undefined && value !== null) return String(value);
  return new URL(req.url || '', 'http://localhost').searchParams.get(key) || '';
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

  if (req.method === 'GET') {
    try {
      var summary = queryValue(req, 'summary') === '1' || queryValue(req, 'view') === 'summary';
      var query = queryValue(req, 'q');
      var cardsData = summary ? await loadCardSummaries(userId, { query: query }) : await load(userId);
      var sorted = cardsData.cards.slice().sort(function (a, b) {
        return a.created > b.created ? -1 : a.created < b.created ? 1 : 0;
      });
      if (summary) sendConditionalJSON(req, res, 200, { ok: true, cards: sorted });
      else sendJSON(res, 200, { ok: true, cards: sorted });
    } catch (e) {
      console.error('[cards GET] Error:', e);
      sendJSON(res, 500, { ok: false, error: e.message || 'Internal error' });
    }
    return;
  }

  if (req.method === 'POST') {
    var compactResponse = queryValue(req, 'response') === 'summary';
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
      sendJSON(res, 201, compactResponse ? { ok: true, id: card.id } : { ok: true, card: card });
    } catch (err) {
      console.error('[cards POST] Error:', err);
      sendJSON(res, 500, { ok: false, error: err.message || 'Internal error' });
    }
    return;
  }

  sendJSON(res, 404, { ok: false, error: 'Not found' });
}
