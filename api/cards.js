import { load, save, todayISO, generateId, defaultSm2 } from '../lib/db.js';
import { handleOptions, sendJSON, getBody, badBodyError } from '../lib/api.js';

export default async function handler(req, res) {
  if (handleOptions(req, res)) return;

  if (req.method === 'GET') {
    try {
      var cardsData = await load();
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
      var card = {
        id: generateId(),
        created: todayISO(),
        updated: todayISO(),
        question: body.question || '',
        link: body.link || '',
        tags: Array.isArray(body.tags) ? body.tags : [],
        difficulty: body.difficulty || 'medium',
        actual_code: body.actual_code || '',
        my_thinking: body.my_thinking || '',
        right_thinking: body.right_thinking || '',
        notes: body.notes || '',
        sm2: defaultSm2()
      };
      var cData = await load();
      cData.cards.push(card);
      await save(cData);
      sendJSON(res, 201, { ok: true, card: card });
    } catch (err) {
      console.error('[cards POST] Error:', err);
      sendJSON(res, 500, { ok: false, error: err.message || 'Internal error' });
    }
    return;
  }

  sendJSON(res, 404, { ok: false, error: 'Not found' });
}
