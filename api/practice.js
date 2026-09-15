import {
  getPracticeAttempt,
  getPracticeCard,
  getPracticeReveal,
  getPracticeSession,
  getPracticeSummary,
  getPracticeTimeZone,
  listPracticeHistory,
  listPracticeQueue,
  recordPracticeAttempt,
  recordPracticeCapture,
  setPracticeTimeZone,
} from '../lib/db.js';
import { requireAuth } from '../lib/auth.js';
import { handleOptions, sendAuthError, sendJSON, getBody } from '../lib/api.js';
import {
  isPracticeError,
  practiceErrorBody,
  PracticeValidationError,
} from '../lib/dsa-practice.js';

function queryValue(req, key) {
  var value = req.query && req.query[key];
  if (Array.isArray(value)) return value[0] ? String(value[0]) : '';
  if (value !== undefined && value !== null) return String(value);
  return new URL(req.url || '', 'http://localhost').searchParams.get(key) || '';
}

function optionalQueryValue(req, key) {
  var value = queryValue(req, key).trim();
  return value || undefined;
}

function requireQueryValue(req, key) {
  var value = queryValue(req, key).trim();
  if (!value) throw new PracticeValidationError(`${key} is required`, { field: key });
  return value;
}

function positiveLimit(req) {
  var raw = queryValue(req, 'limit').trim();
  if (!raw) return undefined;
  var limit = Number(raw);
  if (!Number.isInteger(limit) || limit <= 0) {
    throw new PracticeValidationError('limit must be a positive integer', { field: 'limit' });
  }
  return limit;
}

function sendNotFound(res, message) {
  sendJSON(res, 404, {
    ok: false,
    error: { code: 'practice_not_found', message: message || 'Practice record was not found' },
  });
}

function practiceErrorDetails(error) {
  var message = typeof error?.message === 'string'
    ? error.message
      .replace(/postgres(?:ql)?:\/\/\S+/gi, '[REDACTED]')
      .replace(/\b(password|passwd|secret|token|api[_-]?key)\s*[=:]\s*\S+/gi, '$1=[REDACTED]')
      .slice(0, 240)
    : undefined;
  return {
    name: typeof error?.name === 'string' ? error.name.slice(0, 80) : 'Error',
    code: typeof error?.code === 'string' ? error.code.slice(0, 40) : undefined,
    stage: typeof error?.practiceStage === 'string' ? error.practiceStage : undefined,
    message,
  };
}

function sendPracticeError(res, error) {
  if (isPracticeError(error)) {
    var payload = practiceErrorBody(error);
    var status = Number.isInteger(payload.status) ? payload.status : 500;
    var body = { ...payload };
    delete body.status;
    sendJSON(res, status, body);
    return;
  }

  if (error && (error.message === 'Empty body' || error.message === 'Invalid JSON')) {
    sendJSON(res, 400, {
      ok: false,
      error: { code: 'invalid_request_body', message: 'Request body must be valid JSON' },
    });
    return;
  }

  sendJSON(res, 500, {
    ok: false,
    error: { code: 'internal_error', message: 'Internal error' },
  });
}

function sendPracticePage(res, page) {
  sendJSON(res, 200, {
    ok: true,
    items: page.items,
    nextCursor: page.nextCursor,
    hasMore: page.hasMore,
    version: page.version,
  });
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

  try {
    if (req.method === 'GET') {
      var view = queryValue(req, 'view');

      if (view === 'summary') {
        var summary = await getPracticeSummary(userId);
        sendJSON(res, 200, { ok: true, summary: summary });
        return;
      }

      if (view === 'queue') {
        var queueLimit = positiveLimit(req);
        var queueCursor = queryValue(req, 'cursor') || undefined;
        var queue = await listPracticeQueue(userId, {
          bucket: optionalQueryValue(req, 'bucket') || 'due',
          limit: queueLimit,
          cursor: queueCursor,
          q: optionalQueryValue(req, 'q'),
          difficulty: optionalQueryValue(req, 'difficulty'),
        });
        sendPracticePage(res, queue);
        return;
      }

      if (view === 'session') {
        var sessionLimit = positiveLimit(req);
        var sessionCursor = queryValue(req, 'cursor') || undefined;
        var sessionCardId = optionalQueryValue(req, 'cardId');
        var session = await getPracticeSession(userId, {
          limit: sessionLimit,
          cursor: sessionCursor,
          cardId: sessionCardId,
        });
        sendPracticePage(res, session);
        return;
      }

      if (view === 'reveal') {
        var revealCardId = requireQueryValue(req, 'cardId');
        var reveal = await getPracticeReveal(revealCardId, userId);
        if (!reveal) {
          sendNotFound(res, 'Practice card was not found');
          return;
        }
        sendJSON(res, 200, { ok: true, reveal: reveal });
        return;
      }

      if (view === 'card') {
        var cardId = requireQueryValue(req, 'cardId');
        var card = await getPracticeCard(cardId, userId);
        if (!card) {
          sendNotFound(res, 'Practice card was not found');
          return;
        }
        sendJSON(res, 200, { ok: true, card: card });
        return;
      }

      if (view === 'history') {
        var historyCardId = requireQueryValue(req, 'cardId');
        var historyLimit = positiveLimit(req);
        var historyCursor = queryValue(req, 'cursor') || undefined;
        var history = await listPracticeHistory(userId, historyCardId, {
          limit: historyLimit,
          cursor: historyCursor,
        });
        sendPracticePage(res, history);
        return;
      }

      if (view === 'attempt') {
        var attemptId = requireQueryValue(req, 'attemptId');
        var attempt = await getPracticeAttempt(attemptId, userId);
        if (!attempt) {
          sendNotFound(res, 'Practice attempt was not found');
          return;
        }
        sendJSON(res, 200, { ok: true, attempt: attempt });
        return;
      }

      if (view === 'timezone') {
        var timeZone = await getPracticeTimeZone(userId);
        sendJSON(res, 200, {
          ok: true,
          timeZone: timeZone,
          required: timeZone === null,
        });
        return;
      }

      throw new PracticeValidationError('view must be one of: summary, queue, session, reveal, card, history, attempt, timezone', {
        field: 'view',
      });
    }

    if (req.method === 'POST') {
      var view = queryValue(req, 'view');
      var body = getBody(req);
      if (view === 'capture') {
        var result = await recordPracticeCapture({ ownerId: userId, body: body });
        sendJSON(res, 200, {
          ok: true,
          replayed: result.replayed,
          duplicate: result.duplicate,
          cardId: result.cardId,
          attempt: result.attempt,
          practice: result.practice,
        });
        return;
      }
      var postCardId = requireQueryValue(req, 'cardId');
      var result = await recordPracticeAttempt({ ownerId: userId, cardId: postCardId, body: body });
      sendJSON(res, 200, {
        ok: true,
        replayed: result.replayed,
        attempt: result.attempt,
        practice: result.practice,
      });
      return;
    }

    if (req.method === 'PUT') {
      var timezoneView = queryValue(req, 'view');
      if (timezoneView !== 'timezone') {
        throw new PracticeValidationError('view must be timezone for PUT requests', { field: 'view' });
      }
      var timezoneBody = getBody(req);
      if (!timezoneBody || typeof timezoneBody !== 'object' || Array.isArray(timezoneBody)
        || typeof timezoneBody.timeZone !== 'string' || !timezoneBody.timeZone.trim()) {
        throw new PracticeValidationError('timeZone is required', { field: 'timeZone' });
      }
      var saved = await setPracticeTimeZone(userId, timezoneBody.timeZone);
      sendJSON(res, 200, { ok: true, timeZone: saved.timeZone });
      return;
    }

    sendJSON(res, 405, {
      ok: false,
      error: { code: 'method_not_allowed', message: 'Method not allowed' },
    });
  } catch (error) {
    console.error('[practice] internal error', practiceErrorDetails(error));
    sendPracticeError(res, error);
  }
}
