import { getAuthErrorResponse } from './auth.js';
import { createHash } from 'node:crypto';

export function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization'
  };
}

export function applyCors(res) {
  var ch = corsHeaders();
  for (var key in ch) {
    res.setHeader(key, ch[key]);
  }
}

export function sendJSON(res, statusCode, data) {
  applyCors(res);
  res.setHeader('Cache-Control', 'no-store');
  res.status(statusCode).json(data);
}

/** Send authenticated JSON that can be revalidated without sharing it publicly. */
export function sendConditionalJSON(req, res, statusCode, data) {
  applyCors(res);
  const body = JSON.stringify(data);
  const etag = `"${createHash('sha256').update(body).digest('base64url')}"`;
  const incoming = req && req.headers && (req.headers['if-none-match'] || req.headers['If-None-Match']);
  res.setHeader('Cache-Control', 'private, no-cache');
  res.setHeader('Vary', 'Authorization');
  res.setHeader('ETag', etag);
  if (incoming && (incoming.split(',').some((value) => value.trim() === etag) || incoming.trim() === '*')) {
    res.status(304).end();
    return;
  }
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.status(statusCode).send(body);
}

export function sendAuthError(res, error) {
  var authError = getAuthErrorResponse(error);
  sendJSON(res, authError.status, { error: authError.error });
}

export function handleOptions(req, res) {
  if (req.method === 'OPTIONS') {
    var ch = corsHeaders();
    for (var key in ch) {
      res.setHeader(key, ch[key]);
    }
    res.setHeader('Cache-Control', 'no-store');
    res.status(204).end();
    return true;
  }
  return false;
}

export function getBody(req) {
  if (req.body === undefined || req.body === null) {
    throw new Error('Empty body');
  }
  if (typeof req.body === 'string') {
    if (!req.body) {
      throw new Error('Empty body');
    }
    try {
      return JSON.parse(req.body);
    } catch (e) {
      throw new Error('Invalid JSON');
    }
  }
  return req.body;
}

export function badBodyError(err) {
  return err.message === 'Empty body' ? 'Empty body' : 'Invalid JSON';
}
