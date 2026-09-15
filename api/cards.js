import { load, loadCardSummaries, upsertCard, upsertUser, todayISO, generateId, defaultSm2 } from '../lib/db.js';
import { requireAuth } from '../lib/auth.js';
import { handleOptions, sendAuthError, sendJSON, sendConditionalJSON, getBody } from '../lib/api.js';
import { isPracticeError, practiceErrorBody } from '../lib/dsa-practice.js';

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
      if (summary) {
        var limit = queryValue(req, 'limit') || undefined;
        var cursor = queryValue(req, 'cursor') || undefined;
        var q = queryValue(req, 'q') || undefined;
        var difficulty = queryValue(req, 'difficulty') || undefined;
        var page = await loadCardSummaries(userId, {
          limit: limit,
          cursor: cursor,
          q: q,
          difficulty: difficulty,
        });
        sendConditionalJSON(req, res, 200, {
          ok: true,
          cards: page.cards,
          nextCursor: page.nextCursor,
          hasMore: page.hasMore,
          version: page.version,
        });
      } else {
        // The unparameterized path is intentionally retained for legacy
        // import/export callers that explicitly request complete cards.
        var cardsData = await load(userId);
        var sorted = cardsData.cards.slice().sort(function (a, b) {
          return a.created > b.created ? -1 : a.created < b.created ? 1 : 0;
        });
        sendJSON(res, 200, { ok: true, cards: sorted });
      }
    } catch (e) {
      if (isPracticeError(e)) {
        var payload = practiceErrorBody(e);
        var status = Number.isInteger(payload.status) ? payload.status : 500;
        delete payload.status;
        sendJSON(res, status, payload);
        return;
      }
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
