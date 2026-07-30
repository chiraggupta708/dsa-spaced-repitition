import { extractSlug, fetchProblem } from '../../lib/leetcode.js';
import { requireAuth } from '../../lib/auth.js';
import { handleOptions, sendAuthError, sendJSON, getBody } from '../../lib/api.js';

export default async function handler(req, res) {
  if (handleOptions(req, res)) return;

  try {
    await requireAuth(req);
  } catch (error) {
    return sendAuthError(res, error);
  }

  if (req.method !== 'POST') {
    return sendJSON(res, 405, { ok: false, error: 'Method not allowed' });
  }

  try {
    let body;
    try {
      body = getBody(req);
    } catch (e) {
      return sendJSON(res, 400, { ok: false, error: 'URL is required' });
    }

    const url = (body && body.url || '').trim();

    if (!url) {
      return sendJSON(res, 400, { ok: false, error: 'URL is required' });
    }

    const slug = extractSlug(url);
    if (!slug) {
      return sendJSON(res, 400, { ok: false, error: 'Invalid LeetCode URL. Expected format: https://leetcode.com/problems/<slug>/' });
    }

    const data = await fetchProblem(slug);
    return sendJSON(res, 200, { ok: true, data });

  } catch (err) {
    const msg = err.message || 'Failed to fetch problem';
    if (msg === 'Problem not found') {
      return sendJSON(res, 404, { ok: false, error: 'Problem not found on LeetCode' });
    }
    return sendJSON(res, 502, { ok: false, error: 'Failed to fetch from LeetCode. Please try again.' });
  }
}
