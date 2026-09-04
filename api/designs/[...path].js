import { deleteDesign, getDesign, saveDesign, upsertUser } from '../../lib/db.js';
import { deleteLldDesign, getLldCodeVersions, getLldDesign, listLldDesigns, saveLldCode, saveLldDesign } from '../../lib/lld-db.js';
import {
  abandonLldAttempt,
  completeLldAttempt,
  createLldAttempt,
  getLldAttempt,
  saveLldAttemptAnswer,
  saveLldAttemptReview,
} from '../../lib/lld-attempts-db.js';
import { coachLldAttempt } from '../../lib/lld-ai.js';
import { requireAuth } from '../../lib/auth.js';
import { getBody, handleOptions, sendAuthError, sendJSON } from '../../lib/api.js';

export function getPathParts(req) {
  const queryPath = req.query?.path;
  const nestedId = req.query?.lldId || req.query?.designId;
  const values = Array.isArray(queryPath)
    ? queryPath
    : queryPath
      ? [queryPath]
      : req.query?.id
        ? [req.query.id]
        : [];
  if (values.length) {
    const parts = values.flatMap((part) => String(part).split('/')).filter(Boolean);
    if (nestedId && parts[0] === 'lld' && parts.length === 1) parts.push(String(nestedId));
    return parts;
  }

  const pathname = (req.originalUrl || req.url || '').split('?')[0];
  const marker = '/api/designs/';
  if (!pathname.startsWith(marker)) return [];
  const parts = pathname.slice(marker.length).split('/').filter(Boolean).map((part) => decodeURIComponent(part));
  if (nestedId && parts[0] === 'lld' && parts.length === 1) parts.push(String(nestedId));
  return parts;
}

function operationError(res, error, label) {
  const message = error?.message || 'Internal error';
  const status = error instanceof TypeError
    ? 400
    : /not found|owned by another user/i.test(message)
      ? 404
      : 500;
  console.error(`[${label}] Error:`, error);
  sendJSON(res, status, { ok: false, error: status === 500 ? 'Internal error' : message });
}

function queryValue(req, key) {
  const value = req.query?.[key];
  if (Array.isArray(value)) return value[0] ? String(value[0]) : '';
  if (value !== undefined && value !== null) return String(value);
  return new URL(req.url || '', 'http://localhost').searchParams.get(key) || '';
}

async function handleLldAttempt(req, res, userId) {
  const attemptId = queryValue(req, 'attemptId');
  const designId = queryValue(req, 'designId');
  const action = queryValue(req, 'action');
  const start = req.method === 'POST' && designId && (queryValue(req, 'attempt') === '1' || action === 'start');
  if (!attemptId && !start) return false;

  try {
    if (start) {
      const result = await createLldAttempt(designId, userId, queryValue(req, 'mode') || 'practice');
      sendJSON(res, 201, { ok: true, ...result });
      return true;
    }
    if (req.method === 'GET') {
      const result = await getLldAttempt(attemptId, userId);
      if (!result.attempt) {
        sendJSON(res, 404, { ok: false, error: 'Attempt not found' });
        return true;
      }
      sendJSON(res, 200, { ok: true, ...result });
      return true;
    }
    if (req.method === 'POST' && action === 'ai') {
      const result = await coachLldAttempt(attemptId, userId, getBody(req));
      sendJSON(res, 200, { ok: true, ...result });
      return true;
    }
    if (req.method === 'PUT' || req.method === 'PATCH') {
      const result = await saveLldAttemptAnswer(attemptId, userId, getBody(req));
      sendJSON(res, 200, { ok: true, ...result });
      return true;
    }
    if (req.method === 'POST' && action === 'review') {
      const result = await saveLldAttemptReview(attemptId, userId, getBody(req));
      sendJSON(res, 200, { ok: true, ...result });
      return true;
    }
    if (req.method === 'POST' && action === 'complete') {
      const result = await completeLldAttempt(attemptId, userId);
      sendJSON(res, 200, { ok: true, ...result });
      return true;
    }
    if (req.method === 'POST' && action === 'abandon') {
      const result = await abandonLldAttempt(attemptId, userId);
      sendJSON(res, 200, { ok: true, ...result });
      return true;
    }
    sendJSON(res, 404, { ok: false, error: 'Not found' });
  } catch (error) {
    operationError(res, error, `lld attempt ${action || req.method.toLowerCase()}`);
  }
  return true;
}

async function handleLld(req, res, parts, userId) {
  if (await handleLldAttempt(req, res, userId)) return;
  if (parts.length > 2 || (parts.length === 2 && !parts[1])) {
    sendJSON(res, 404, { ok: false, error: 'Not found' });
    return;
  }

  const designId = parts[1];
  const action = queryValue(req, 'action');
  if (!designId) {
    if (req.method === 'GET') {
      try {
        const result = await listLldDesigns(userId);
        sendJSON(res, 200, { ok: true, ...result });
      } catch (error) {
        operationError(res, error, 'lld list');
      }
      return;
    }
    if (req.method === 'POST') {
      try {
        const result = await saveLldDesign(getBody(req), userId);
        sendJSON(res, 201, result);
      } catch (error) {
        operationError(res, error, 'lld create');
      }
      return;
    }
    sendJSON(res, 404, { ok: false, error: 'Not found' });
    return;
  }

  if (req.method === 'GET' && action === 'code-versions') {
    try {
      const result = await getLldCodeVersions(designId, userId);
      sendJSON(res, 200, result);
    } catch (error) {
      operationError(res, error, 'lld code history');
    }
    return;
  }

  if (req.method === 'POST' && action === 'code') {
    try {
      const result = await saveLldCode(designId, userId, getBody(req));
      sendJSON(res, 200, result);
    } catch (error) {
      operationError(res, error, 'lld code update');
    }
    return;
  }

  if (req.method === 'GET') {
    try {
      const design = await getLldDesign(designId, userId);
      if (!design) {
        sendJSON(res, 404, { ok: false, error: 'Design not found' });
        return;
      }
      sendJSON(res, 200, { ok: true, design });
    } catch (error) {
      operationError(res, error, 'lld detail');
    }
    return;
  }

  if (req.method === 'PUT' || req.method === 'PATCH') {
    try {
      const body = getBody(req);
      const result = await saveLldDesign({ ...body, id: designId }, userId);
      sendJSON(res, 200, result);
    } catch (error) {
      operationError(res, error, 'lld update');
    }
    return;
  }

  if (req.method === 'DELETE') {
    try {
      const result = await deleteLldDesign(designId, userId);
      if (!result.deleted) {
        sendJSON(res, 404, { ok: false, error: 'Design not found' });
        return;
      }
      sendJSON(res, 200, result);
    } catch (error) {
      operationError(res, error, 'lld delete');
    }
    return;
  }

  sendJSON(res, 404, { ok: false, error: 'Not found' });
}

async function handleGenericDesign(req, res, id, userId) {
  if (!id) {
    sendJSON(res, 400, { ok: false, error: 'Missing design id' });
    return;
  }

  if (req.method === 'GET') {
    try {
      const design = await getDesign(id, userId);
      if (!design) {
        sendJSON(res, 404, { ok: false, error: 'Design not found' });
        return;
      }
      sendJSON(res, 200, { ok: true, design });
    } catch (error) {
      operationError(res, error, 'design detail');
    }
    return;
  }

  if (req.method === 'PUT') {
    try {
      const body = getBody(req);
      await upsertUser({ clerkId: userId });
      const result = await saveDesign({ ...body, id }, userId);
      sendJSON(res, 200, { ok: true, id: result.id });
    } catch (error) {
      operationError(res, error, 'design update');
    }
    return;
  }

  if (req.method === 'DELETE') {
    try {
      await upsertUser({ clerkId: userId });
      const result = await deleteDesign(id, userId);
      if (!result.deleted) {
        sendJSON(res, 404, { ok: false, error: 'Design not found' });
        return;
      }
      sendJSON(res, 200, result);
    } catch (error) {
      operationError(res, error, 'design delete');
    }
    return;
  }

  sendJSON(res, 404, { ok: false, error: 'Not found' });
}

export default async function handler(req, res) {
  if (handleOptions(req, res)) return;

  let userId;
  try {
    ({ userId } = await requireAuth(req));
  } catch (error) {
    sendAuthError(res, error);
    return;
  }

  const parts = getPathParts(req);
  if (parts[0] === 'lld') {
    await handleLld(req, res, parts, userId);
    return;
  }
  if (parts.length === 1) {
    await handleGenericDesign(req, res, parts[0], userId);
    return;
  }
  sendJSON(res, 404, { ok: false, error: 'Not found' });
}
