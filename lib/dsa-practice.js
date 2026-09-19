import { createHash } from 'node:crypto';

export const PRACTICE_OUTCOMES = Object.freeze(['independent', 'hinted', 'unfinished']);

export const PRACTICE_DUE_REASONS = Object.freeze({
  MONTHLY_CHECKPOINT: 'monthly_checkpoint',
  THREE_DAY_RETRY: 'three_day_retry',
});

export const PRACTICE_HISTORY_STATUSES = Object.freeze({
  HAS_INDEPENDENT_SOLVE: 'has_independent_solve',
  NO_INDEPENDENT_SOLVE_RECORDED: 'no_independent_solve_recorded',
});

export const PRACTICE_TEXT_LIMITS = Object.freeze({
  idempotencyKey: 200,
  blocker: 1000,
  reflection: 2000,
  challengeApproach: 2000,
  challengeInvariant: 1000,
  challengeComplexity: 500,
  cursor: 4096,
});

/** Bounds for the additive problem-capture payload. */
export const PRACTICE_CAPTURE_LIMITS = Object.freeze({
  title: 300,
  link: 2048,
  description: 12000,
  approach: 10000,
  reference: 20000,
  code: 30000,
  notes: 10000,
  insight: 1000,
  trap: 1000,
  tags: 20,
  tag: 80,
});

export const PRACTICE_CAPTURE_FIELDS = Object.freeze([
  'idempotencyKey', 'title', 'link', 'description', 'approach', 'reference',
  'code', 'notes', 'insight', 'trap', 'tags', 'difficulty', 'outcome',
]);

/** Solution fields are intentionally absent from queue/session/card DTOs. */
export const PRACTICE_REVEAL_FIELDS = Object.freeze([
  'reference', 'approach', 'code', 'notes', 'keyInsight', 'recurringTrap',
]);

export const PRACTICE_PAGE_LIMITS = Object.freeze({
  cards: 10,
  due: 5,
  queue: 10,
  session: 5,
  history: 10,
});

export const PRACTICE_CURSOR_VERSION = 1;
export const PRACTICE_CURSOR_SCOPE = 'dsa_practice';
/** Queue, session, and history cursors expire after one server-day. */
export const PRACTICE_CURSOR_MAX_AGE_MS = 24 * 60 * 60 * 1000;

const CURSOR_SORTS = Object.freeze({
  cards: 'created_at_desc_id_desc',
  due: 'next_review_asc_nulls_first_easiness_factor_asc_id_asc',
  queue: 'next_practice_at_asc_card_id_asc',
  history: 'occurred_at_desc_id_desc',
});

const FORBIDDEN_CLIENT_FIELDS = Object.freeze([
  'ownerId',
  'owner',
  'userId',
  'cardId',
  'attemptId',
  'id',
  'revision',
  'occurredAt',
  'occurred_at',
  'createdAt',
  'created_at',
  'timeZone',
  'timezone',
  'time_zone',
  'source',
  'sourceEventId',
  'source_event_id',
  'nextPracticeAt',
  'next_practice_at',
  'dueReason',
  'due_reason',
]);

export class PracticeError extends Error {
  constructor(message, { code = 'practice_error', status = 400, details = undefined, cause = undefined } = {}) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = new.target.name;
    this.code = code;
    this.status = status;
    this.statusCode = status;
    if (details !== undefined) this.details = details;
  }
}

export class PracticeValidationError extends PracticeError {
  constructor(message, details) {
    super(message, { code: 'invalid_practice_input', status: 400, details });
  }
}

export class PracticeTimezoneError extends PracticeError {
  constructor(message = 'timeZone must be a valid IANA time zone') {
    super(message, { code: 'invalid_practice_timezone', status: 400 });
  }
}

export class PracticeTimezoneRequiredError extends PracticeTimezoneError {
  constructor(message = 'a persisted practice time zone is required before saving an attempt') {
    super(message);
    this.code = 'practice_timezone_required';
    this.status = 409;
    this.statusCode = 409;
  }
}

export class PracticeCursorError extends PracticeError {
  constructor(message = 'invalid or mismatched practice cursor', details) {
    super(message, { code: 'invalid_practice_cursor', status: 400, details });
  }
}

export class PracticeConflictError extends PracticeError {
  constructor(message = 'practice attempt conflicts with existing state', details) {
    super(message, { code: 'practice_conflict', status: 409, details });
  }
}

export class PracticeIdempotencyConflictError extends PracticeConflictError {
  constructor(message = 'idempotency key conflicts with an existing attempt', details) {
    super(message, details);
    this.code = 'practice_idempotency_conflict';
  }
}

export class PracticeNotFoundError extends PracticeError {
  constructor(message = 'practice card or attempt was not found') {
    super(message, { code: 'practice_not_found', status: 404 });
  }
}

export function isPracticeError(error) {
  return error instanceof PracticeError
    || (error && typeof error === 'object' && typeof error.code === 'string' && Number.isInteger(error.status));
}

export function practiceErrorStatus(error) {
  if (error && Number.isInteger(error.statusCode)) return error.statusCode;
  if (error && Number.isInteger(error.status)) return error.status;
  return 500;
}

export function practiceErrorBody(error) {
  const status = practiceErrorStatus(error);
  return {
    ok: false,
    error: {
      code: error?.code || 'practice_error',
      message: error?.message || 'Practice request failed',
      ...(error?.details === undefined ? {} : { details: error.details }),
    },
    status,
  };
}

export const toPracticeErrorResponse = practiceErrorBody;
export const getPracticeErrorStatus = practiceErrorStatus;

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
}

function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function invalidInput(message, details) {
  throw new PracticeValidationError(message, details);
}

function boundedText(value, field, maximum) {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') invalidInput(`${field} must be a string when supplied`, { field });
  const normalized = value.trim();
  if (normalized.length > maximum) {
    invalidInput(`${field} must be at most ${maximum} characters`, { field, maximum });
  }
  return normalized || null;
}

function requiredText(value, field, maximum) {
  if (typeof value !== 'string') invalidInput(`${field} must be a nonempty string`, { field });
  const normalized = value.trim();
  if (!normalized) invalidInput(`${field} must be a nonempty string`, { field });
  if (normalized.length > maximum) {
    invalidInput(`${field} must be at most ${maximum} characters`, { field, maximum });
  }
  return normalized;
}

function normalizeOutcome(value) {
  if (!PRACTICE_OUTCOMES.includes(value)) {
    invalidInput(`outcome must be one of: ${PRACTICE_OUTCOMES.join(', ')}`, { field: 'outcome' });
  }
  return value;
}

function normalizeChallenge(value) {
  if (value === undefined || value === null) return null;
  if (!isPlainObject(value)) invalidInput('challenge must be an object when supplied', { field: 'challenge' });
  return {
    approach: boundedText(value.approach, 'challenge.approach', PRACTICE_TEXT_LIMITS.challengeApproach),
    invariant: boundedText(value.invariant, 'challenge.invariant', PRACTICE_TEXT_LIMITS.challengeInvariant),
    complexity: boundedText(value.complexity, 'challenge.complexity', PRACTICE_TEXT_LIMITS.challengeComplexity),
  };
}

/** Normalize only client-owned practice fields into the idempotency payload. */
export function normalizePracticeInput(input) {
  if (!isPlainObject(input)) invalidInput('practice input must be an object');
  for (const field of FORBIDDEN_CLIENT_FIELDS) {
    if (hasOwn(input, field)) invalidInput(`${field} is server-controlled`, { field });
  }
  const normalized = {
    idempotencyKey: requiredText(input.idempotencyKey, 'idempotencyKey', PRACTICE_TEXT_LIMITS.idempotencyKey),
    outcome: normalizeOutcome(input.outcome),
    blocker: boundedText(input.blocker, 'blocker', PRACTICE_TEXT_LIMITS.blocker),
    reflection: boundedText(input.reflection, 'reflection', PRACTICE_TEXT_LIMITS.reflection),
    challenge: normalizeChallenge(input.challenge),
  };
  return deepFreeze(normalized);
}

/**
 * Produce the bounded, deterministic fingerprint stored with an attempt.
 * The digest keeps the database value bounded even when optional text is long.
 */
export function fingerprintPracticeInput(input, cardId) {
  const normalized = normalizePracticeInput(input);
  const identity = cardId === undefined ? null : requiredText(cardId, 'cardId', 300);
  return hashText(canonicalJson({ cardId: identity, ...normalized }));
}

function normalizeCaptureTitle(value) {
  return requiredText(value, 'title', PRACTICE_CAPTURE_LIMITS.title).replace(/\s+/g, ' ');
}

function normalizeCaptureLink(value) {
  const bounded = boundedText(value, 'link', PRACTICE_CAPTURE_LIMITS.link);
  if (!bounded) return null;
  let parsed;
  try {
    parsed = new URL(bounded);
  } catch {
    invalidInput('link must be a valid HTTP(S) URL', { field: 'link' });
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    invalidInput('link must be a valid HTTP(S) URL', { field: 'link' });
  }
  parsed.hash = '';
  parsed.protocol = parsed.protocol.toLowerCase();
  parsed.hostname = parsed.hostname.toLowerCase();
  if ((parsed.protocol === 'http:' && parsed.port === '80')
    || (parsed.protocol === 'https:' && parsed.port === '443')) {
    parsed.port = '';
  }
  const canonical = parsed.toString();
  if (canonical.length > PRACTICE_CAPTURE_LIMITS.link) {
    invalidInput(`link must be at most ${PRACTICE_CAPTURE_LIMITS.link} characters`, {
      field: 'link', maximum: PRACTICE_CAPTURE_LIMITS.link,
    });
  }
  return canonical;
}

function normalizeCaptureDifficulty(value) {
  if (value === undefined || value === null || (typeof value === 'string' && !value.trim())) return null;
  if (typeof value !== 'string') invalidInput('difficulty must be easy, medium, hard, or unset', { field: 'difficulty' });
  const difficulty = value.trim().toLowerCase();
  if (!['easy', 'medium', 'hard'].includes(difficulty)) {
    invalidInput('difficulty must be easy, medium, hard, or unset', { field: 'difficulty' });
  }
  return difficulty;
}

function normalizeCaptureTags(value) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) invalidInput('tags must be an array when supplied', { field: 'tags' });
  if (value.length > PRACTICE_CAPTURE_LIMITS.tags) {
    invalidInput(`tags must contain at most ${PRACTICE_CAPTURE_LIMITS.tags} entries`, {
      field: 'tags', maximum: PRACTICE_CAPTURE_LIMITS.tags,
    });
  }
  const tags = [];
  const seen = new Set();
  value.forEach((tag, index) => {
    if (typeof tag !== 'string') invalidInput(`tags[${index}] must be a string`, { field: `tags[${index}]` });
    const normalized = boundedText(tag, `tags[${index}]`, PRACTICE_CAPTURE_LIMITS.tag);
    if (!normalized) return;
    const lower = normalized.toLowerCase();
    if (seen.has(lower)) return;
    seen.add(lower);
    tags.push(lower);
  });
  return tags.sort((left, right) => left < right ? -1 : left > right ? 1 : 0);
}

function normalizeOptionalPracticeOutcome(value) {
  if (value === undefined || value === null || (typeof value === 'string' && !value.trim())) return null;
  return normalizeOutcome(value);
}

function captureIdentityFromNormalized(normalized) {
  return normalized.link
    ? { type: 'link', value: normalized.link }
    : { type: 'title', value: normalized.title.toLowerCase() };
}

/** Normalize the owner-independent, additive problem-capture payload. */
export function normalizePracticeCaptureInput(input) {
  if (!isPlainObject(input)) invalidInput('practice capture input must be an object');
  for (const field of Object.keys(input)) {
    if (!PRACTICE_CAPTURE_FIELDS.includes(field)) {
      invalidInput(`${field} is not supported by practice capture`, { field });
    }
  }
  const normalized = {
    idempotencyKey: requiredText(input.idempotencyKey, 'idempotencyKey', PRACTICE_TEXT_LIMITS.idempotencyKey),
    title: normalizeCaptureTitle(input.title),
    link: normalizeCaptureLink(input.link),
    description: boundedText(input.description, 'description', PRACTICE_CAPTURE_LIMITS.description),
    approach: boundedText(input.approach, 'approach', PRACTICE_CAPTURE_LIMITS.approach),
    reference: boundedText(input.reference, 'reference', PRACTICE_CAPTURE_LIMITS.reference),
    code: boundedText(input.code, 'code', PRACTICE_CAPTURE_LIMITS.code),
    notes: boundedText(input.notes, 'notes', PRACTICE_CAPTURE_LIMITS.notes),
    insight: boundedText(input.insight, 'insight', PRACTICE_CAPTURE_LIMITS.insight),
    trap: boundedText(input.trap, 'trap', PRACTICE_CAPTURE_LIMITS.trap),
    tags: normalizeCaptureTags(input.tags),
    difficulty: normalizeCaptureDifficulty(input.difficulty),
    outcome: normalizeOptionalPracticeOutcome(input.outcome),
  };
  return deepFreeze(normalized);
}

/** Return the deterministic owner-scoped duplicate identity for a capture. */
export function practiceCaptureIdentity(input) {
  return captureIdentityFromNormalized(normalizePracticeCaptureInput(input));
}

/** Produce a bounded deterministic digest for a normalized capture request. */
export function fingerprintPracticeCaptureInput(input) {
  const normalized = normalizePracticeCaptureInput(input);
  return hashText(canonicalJson({
    version: 1,
    identity: captureIdentityFromNormalized(normalized),
    ...normalized,
  }));
}

function formatterFor(timeZone) {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone,
      calendar: 'iso8601',
      numberingSystem: 'latn',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    });
  } catch (error) {
    throw new PracticeTimezoneError(`Invalid IANA time zone: ${String(timeZone)}`);
  }
}

/** Validate with the runtime's IANA time-zone database; never silently use UTC. */
export function normalizePracticeTimeZone(value) {
  if (value === undefined || value === null || (typeof value === 'string' && !value.trim())) {
    throw new PracticeTimezoneRequiredError();
  }
  if (typeof value !== 'string') throw new PracticeTimezoneError();
  const normalized = value.trim();
  if (normalized.length > 100) throw new PracticeTimezoneError('timeZone is too long');
  formatterFor(normalized);
  return normalized;
}

export function isValidPracticeTimeZone(value) {
  try {
    normalizePracticeTimeZone(value);
    return true;
  } catch {
    return false;
  }
}

function dateFrom(value) {
  if (value === undefined || value === null) {
    throw new PracticeValidationError('now must be a valid instant', { field: 'now' });
  }
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    throw new PracticeValidationError('now must be a valid instant', { field: 'now' });
  }
  return date;
}

function localParts(instant, formatter) {
  const parts = Object.fromEntries(
    formatter.formatToParts(instant)
      .filter(({ type }) => type !== 'literal')
      .map(({ type, value }) => [type, value]),
  );
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
    millisecond: instant.getUTCMilliseconds(),
  };
}

function addCalendarDays(parts, days) {
  const shifted = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days));
  return {
    ...parts,
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  };
}

function sameLocalParts(left, right) {
  return left.year === right.year
    && left.month === right.month
    && left.day === right.day
    && left.hour === right.hour
    && left.minute === right.minute
    && left.second === right.second
    && left.millisecond === right.millisecond;
}

function compareLocalParts(left, right) {
  for (const field of ['year', 'month', 'day', 'hour', 'minute', 'second', 'millisecond']) {
    if (left[field] !== right[field]) return left[field] < right[field] ? -1 : 1;
  }
  return 0;
}

function localEpoch(parts) {
  return Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
    parts.millisecond,
  );
}

function firstValidLocalInstantAtOrAfter(parts, formatter) {
  const target = localEpoch(parts);
  const window = 36 * 60 * 60 * 1000;
  for (let timestamp = target - window; timestamp <= target + window; timestamp += 60 * 1000) {
    const candidate = new Date(timestamp);
    const observed = localParts(candidate, formatter);
    if (observed.year === parts.year && observed.month === parts.month && observed.day === parts.day
      && compareLocalParts(observed, parts) >= 0) {
      return candidate;
    }
  }
  throw new PracticeValidationError('could not resolve the scheduled local date-time');
}

function localDateTimeToInstant(parts, formatter) {
  const target = localEpoch(parts);
  let timestamp = target;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const observed = localParts(new Date(timestamp), formatter);
    const observedEpoch = localEpoch(observed);
    const next = target - (observedEpoch - timestamp);
    if (next === timestamp) break;
    timestamp = next;
  }
  const resolved = new Date(timestamp);
  if (!sameLocalParts(localParts(resolved, formatter), parts)) {
    return firstValidLocalInstantAtOrAfter(parts, formatter);
  }
  return resolved;
}

function localDateString(parts) {
  return [parts.year, parts.month, parts.day]
    .map((value, index) => index === 0 ? String(value).padStart(4, '0') : String(value).padStart(2, '0'))
    .join('-');
}

/**
 * Schedule a DSA attempt in the owner's local calendar. Calendar days are not
 * fixed-hour durations, so DST transitions do not shift the target local date.
 */
export function schedulePracticeOutcome(input, positionalTimeZone, positionalNow) {
  const args = typeof input === 'string'
    ? { outcome: input, timeZone: positionalTimeZone, now: positionalNow }
    : input;
  if (!isPlainObject(args)) invalidInput('practice scheduling input must be an object');
  const outcome = normalizeOutcome(args.outcome);
  const timeZone = normalizePracticeTimeZone(args.timeZone);
  const now = dateFrom(args.now === undefined ? new Date() : args.now);
  const formatter = formatterFor(timeZone);
  const current = localParts(now, formatter);
  const intervalDays = outcome === 'independent' ? 30 : 3;
  const dueReason = outcome === 'independent'
    ? PRACTICE_DUE_REASONS.MONTHLY_CHECKPOINT
    : PRACTICE_DUE_REASONS.THREE_DAY_RETRY;
  const target = addCalendarDays(current, intervalDays);
  const due = localDateTimeToInstant(target, formatter);
  const dueAt = due.toISOString();
  return Object.freeze({
    outcome,
    intervalDays,
    days: intervalDays,
    dueAt,
    nextPracticeAt: dueAt,
    nextPracticeDate: localDateString(target),
    dueReason,
    timeZone,
  });
}

function canonicalize(value) {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(canonicalize);
  if (isPlainObject(value)) {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
  }
  return value;
}

function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}

function hashText(value) {
  return createHash('sha256').update(value).digest('base64url');
}

function ownerHash(ownerId) {
  return hashText(requiredText(ownerId, 'ownerId', 300));
}

function validSnapshot(value) {
  try {
    const date = dateFrom(value);
    return date.toISOString();
  } catch {
    throw new PracticeCursorError('cursor snapshotAt must be a valid instant');
  }
}

function cursorContext(input = {}, { requireKey = true } = {}) {
  if (!isPlainObject(input)) throw new PracticeCursorError('cursor context must be an object');
  const ownerId = input.ownerId ?? input.owner;
  if (typeof ownerId !== 'string' || !ownerId.trim()) throw new PracticeCursorError('cursor owner binding is required');
  const view = input.view || 'queue';
  if (!['queue', 'history', 'session', 'cards', 'due'].includes(view)) {
    throw new PracticeCursorError('unsupported cursor view');
  }
  const bucket = input.bucket === undefined || input.bucket === null ? null : String(input.bucket);
  if (view === 'queue' && bucket !== null && !['due', 'first-check'].includes(bucket)) {
    throw new PracticeCursorError('unsupported queue cursor bucket');
  }
  if (view !== 'queue' && bucket !== null) {
    throw new PracticeCursorError(`${view} cursors cannot contain a bucket`);
  }
  const filter = input.filter ?? input.filters ?? {};
  if (!isPlainObject(filter)) throw new PracticeCursorError('cursor filter must be an object');
  const sortView = view === 'session' ? 'queue' : view;
  const sort = input.sort || input.sortKey || CURSOR_SORTS[sortView];
  const expectedSort = CURSOR_SORTS[sortView];
  if (sort !== expectedSort) throw new PracticeCursorError('unsupported cursor sort');
  const snapshotValue = input.snapshotAt ?? input.snapshot ?? null;
  if (snapshotValue === null || snapshotValue === undefined) {
    throw new PracticeCursorError('cursor snapshotAt is required');
  }
  const snapshotAt = validSnapshot(snapshotValue);
  const key = input.key ?? input.lastKey ?? input.orderingKey;
  const normalizedKey = normalizeCursorKey(view, key, requireKey);
  return {
    ownerId: ownerId.trim(),
    view,
    bucket,
    filter: canonicalize(filter),
    sort,
    snapshotAt,
    key: normalizedKey,
  };
}

function normalizeCursorKey(view, key, required) {
  if (key === null || key === undefined) {
    if (required) throw new PracticeCursorError('cursor ordering key is required');
    return null;
  }
  if (!isPlainObject(key)) throw new PracticeCursorError('cursor ordering key must be an object');
  if (view === 'history') {
    if (typeof key.id !== 'string' || !key.id.trim()) {
      throw new PracticeCursorError('history cursor id is required');
    }
    if (key.occurredAt === undefined || key.occurredAt === null) {
      throw new PracticeCursorError('history cursor occurredAt is required');
    }
    return {
      occurredAt: validSnapshot(key.occurredAt),
      id: key.id.trim(),
    };
  }
  if (view === 'cards') {
    if (typeof key.id !== 'string' || !key.id.trim()) {
      throw new PracticeCursorError('cards cursor id is required');
    }
    if (key.createdAt === undefined || key.createdAt === null) {
      throw new PracticeCursorError('cards cursor createdAt is required');
    }
    return {
      createdAt: validSnapshot(key.createdAt),
      id: key.id.trim(),
    };
  }
  if (view === 'due') {
    const cardId = key.cardId ?? key.id;
    if (typeof cardId !== 'string' || !cardId.trim()) {
      throw new PracticeCursorError('due cursor cardId is required');
    }
    const nextReview = key.nextReview !== undefined ? key.nextReview : key.next_review;
    if (key.nextReview === undefined && key.next_review === undefined) {
      throw new PracticeCursorError('due cursor nextReview is required');
    }
    const easinessFactor = key.easinessFactor ?? key.easiness_factor;
    if (!Number.isFinite(Number(easinessFactor))) {
      throw new PracticeCursorError('due cursor easinessFactor is required');
    }
    return {
      nextReview: nextReview === null ? null : validSnapshot(nextReview),
      easinessFactor: Number(easinessFactor),
      cardId: cardId.trim(),
    };
  }
  if (typeof key.cardId !== 'string' || !key.cardId.trim()) {
    throw new PracticeCursorError('queue cursor cardId is required');
  }
  return {
    nextPracticeAt: key.nextPracticeAt === null || key.nextPracticeAt === undefined
      ? null
      : validSnapshot(key.nextPracticeAt),
    cardId: key.cardId.trim(),
  };
}

export function encodePracticeCursor(input) {
  const context = cursorContext(input);
  const payload = {
    v: PRACTICE_CURSOR_VERSION,
    scope: PRACTICE_CURSOR_SCOPE,
    ownerHash: ownerHash(context.ownerId),
    view: context.view,
    bucket: context.bucket,
    filter: context.filter,
    filterSignature: hashText(canonicalJson(context.filter)),
    sort: context.sort,
    snapshotAt: context.snapshotAt,
    key: context.key,
  };
  const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  if (encoded.length > PRACTICE_TEXT_LIMITS.cursor) {
    throw new PracticeCursorError('cursor is too large');
  }
  return encoded;
}

function decodeToken(token) {
  if (typeof token !== 'string' || !token || token.length > PRACTICE_TEXT_LIMITS.cursor
    || !/^[A-Za-z0-9_-]+$/.test(token)) {
    throw new PracticeCursorError();
  }
  let decoded;
  try {
    decoded = Buffer.from(token, 'base64url').toString('utf8');
    if (Buffer.from(decoded, 'utf8').toString('base64url') !== token) throw new Error('non-canonical cursor');
    decoded = JSON.parse(decoded);
  } catch {
    throw new PracticeCursorError();
  }
  if (!isPlainObject(decoded)) throw new PracticeCursorError();
  return decoded;
}

function expectedValue(input, key, fallback = undefined) {
  return hasOwn(input, key) ? input[key] : fallback;
}

export function decodePracticeCursor(token, expected = {}) {
  const payload = decodeToken(token);
  if (payload.v !== PRACTICE_CURSOR_VERSION || payload.scope !== PRACTICE_CURSOR_SCOPE) {
    throw new PracticeCursorError('unsupported practice cursor version or scope');
  }
  for (const field of ['view', 'bucket', 'filter', 'filterSignature', 'sort', 'snapshotAt', 'key']) {
    if (!hasOwn(payload, field)) throw new PracticeCursorError(`cursor field ${field} is missing`);
  }
  if (typeof payload.view !== 'string'
    || (payload.bucket !== null && typeof payload.bucket !== 'string')
    || typeof payload.filterSignature !== 'string'
    || !/^[A-Za-z0-9_-]{40,100}$/.test(payload.filterSignature)) {
    throw new PracticeCursorError('cursor metadata is invalid');
  }
  if (typeof payload.ownerHash !== 'string' || !/^[A-Za-z0-9_-]{40,100}$/.test(payload.ownerHash)) {
    throw new PracticeCursorError('cursor owner hash is invalid');
  }
  const hasExpectedOwner = hasOwn(expected, 'ownerId') || hasOwn(expected, 'owner');
  const expectedOwner = expected.ownerId ?? expected.owner;
  if (hasExpectedOwner && (typeof expectedOwner !== 'string' || !expectedOwner.trim())) {
    throw new PracticeCursorError('expected cursor owner is invalid');
  }
  const context = cursorContext({
    ownerId: hasExpectedOwner ? expectedOwner : 'cursor-owner-placeholder',
    view: payload.view,
    bucket: payload.bucket,
    filter: payload.filter,
    sort: payload.sort,
    snapshotAt: payload.snapshotAt,
    key: payload.key,
  });
  if (hasExpectedOwner) {
    if (payload.ownerHash !== ownerHash(expectedOwner)) {
      throw new PracticeCursorError('cursor owner binding does not match');
    }
  }
  if (hasOwn(expected, 'view') && expected.view !== payload.view) {
    throw new PracticeCursorError('cursor view does not match');
  }
  if (hasOwn(expected, 'bucket') && (expected.bucket ?? null) !== payload.bucket) {
    throw new PracticeCursorError('cursor bucket does not match');
  }
  if (hasOwn(expected, 'sort') && expected.sort !== payload.sort) {
    throw new PracticeCursorError('cursor sort does not match');
  }
  if (hasOwn(expected, 'filter') || hasOwn(expected, 'filters')) {
    const filter = expected.filter ?? expected.filters;
    if (!isPlainObject(filter) || canonicalJson(filter) !== canonicalJson(payload.filter)) {
      throw new PracticeCursorError('cursor filter does not match');
    }
  }
  if (hasOwn(expected, 'snapshotAt') || hasOwn(expected, 'snapshot')) {
    const expectedSnapshot = expected.snapshotAt ?? expected.snapshot;
    if (validSnapshot(expectedSnapshot) !== payload.snapshotAt) {
      throw new PracticeCursorError('cursor snapshot does not match');
    }
  }
  if (context.snapshotAt !== payload.snapshotAt || canonicalJson(context.key) !== canonicalJson(payload.key)) {
    throw new PracticeCursorError('cursor contains non-canonical ordering metadata');
  }
  if (payload.filterSignature !== hashText(canonicalJson(payload.filter))) {
    throw new PracticeCursorError('cursor filter signature is invalid');
  }
  if (expected.maxAgeMs !== undefined) {
    if (!Number.isFinite(expected.maxAgeMs) || expected.maxAgeMs < 0) {
      throw new PracticeCursorError('cursor maxAgeMs is invalid');
    }
    let nowInstant;
    try {
      nowInstant = dateFrom(expected.now === undefined ? new Date() : expected.now).getTime();
    } catch {
      throw new PracticeCursorError('cursor now must be a valid instant');
    }
    const age = nowInstant - new Date(payload.snapshotAt).getTime();
    if (!Number.isFinite(age)) throw new PracticeCursorError('cursor snapshot age is invalid');
    if (age < 0) throw new PracticeCursorError('cursor snapshot is in the future');
    if (age > expected.maxAgeMs) throw new PracticeCursorError('cursor snapshot has expired');
  }
  return Object.freeze({
    version: payload.v,
    scope: payload.scope,
    ownerHash: payload.ownerHash,
    view: context.view,
    bucket: context.bucket,
    filter: context.filter,
    filterSignature: payload.filterSignature,
    sort: context.sort,
    snapshotAt: context.snapshotAt,
    key: context.key,
  });
}

function isoOrNull(value) {
  if (value === undefined || value === null || value === '') return null;
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function rowValue(row, ...keys) {
  for (const key of keys) {
    if (row && row[key] !== undefined) return row[key];
  }
  return null;
}

function normalizeTags(value) {
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(value)) return [];
  return value.map((tag) => (isPlainObject(tag) ? tag.name : tag))
    .filter((tag) => typeof tag === 'string' && tag.trim())
    .map((tag) => tag.trim());
}

function recognitionTrapDto(row) {
  const nested = isPlainObject(row?.recognitionTrap) ? row.recognitionTrap : null;
  const suggested = nested?.suggested ?? row?.recognition_trap_suggested ?? row?.recognitionTrapSuggested ?? false;
  const reason = nested?.reason ?? row?.recognition_trap_reason ?? row?.recognitionTrapReason ?? null;
  return { suggested: Boolean(suggested), reason: reason || null };
}

export function toPracticeQueueItem(row = {}) {
  const lastIndependentSolveAt = isoOrNull(rowValue(row, 'last_independent_solve_at', 'lastIndependentSolveAt'));
  const latestAttemptAt = isoOrNull(rowValue(row, 'latest_attempt_at', 'last_attempt_at', 'latestAttemptAt', 'lastAttemptAt'));
  const latestOutcome = rowValue(row, 'latest_outcome', 'last_outcome', 'latestOutcome', 'lastOutcome');
  return {
    cardId: rowValue(row, 'card_id', 'cardId', 'id'),
    title: rowValue(row, 'title', 'question') || '',
    link: rowValue(row, 'link') || '',
    difficulty: rowValue(row, 'difficulty') || null,
    tags: normalizeTags(rowValue(row, 'tags')),
    lastIndependentSolveAt,
    latestAttemptAt,
    latestOutcome: latestOutcome || null,
    nextPracticeAt: isoOrNull(rowValue(row, 'next_practice_at', 'nextPracticeAt')),
    dueReason: rowValue(row, 'due_reason', 'dueReason') || null,
    historyStatus: lastIndependentSolveAt
      ? PRACTICE_HISTORY_STATUSES.HAS_INDEPENDENT_SOLVE
      : PRACTICE_HISTORY_STATUSES.NO_INDEPENDENT_SOLVE_RECORDED,
    recognitionTrap: recognitionTrapDto(row),
  };
}

export function toPracticeCardDto(row = {}) {
  return {
    ...toPracticeQueueItem(row),
    prompt: rowValue(row, 'prompt', 'question_description', 'question', 'title') || '',
  };
}

/** Reveal solution bodies only after the explicit owner-scoped reveal request. */
export function toPracticeRevealDto(row = {}) {
  return {
    cardId: rowValue(row, 'card_id', 'cardId', 'id'),
    prompt: rowValue(row, 'prompt', 'question_description', 'question', 'title') || '',
    link: rowValue(row, 'link') || '',
    reference: rowValue(row, 'reference', 'right_thinking', 'answer') || null,
    approach: rowValue(row, 'approach', 'my_thinking') || null,
    code: rowValue(row, 'code', 'actual_code') || null,
    notes: rowValue(row, 'notes') || null,
    keyInsight: rowValue(row, 'key_insight', 'keyInsight') || null,
    recurringTrap: rowValue(row, 'recurring_trap', 'recurringTrap') || null,
  };
}

export function toPracticeAttemptSummary(row = {}) {
  return {
    id: rowValue(row, 'id'),
    cardId: rowValue(row, 'card_id', 'cardId'),
    occurredAt: isoOrNull(rowValue(row, 'occurred_at', 'occurredAt')),
    timeZone: rowValue(row, 'time_zone', 'timeZone') || null,
    outcome: rowValue(row, 'outcome') || null,
    nextPracticeAt: isoOrNull(rowValue(row, 'next_practice_at', 'nextPracticeAt')),
    dueReason: rowValue(row, 'due_reason', 'dueReason') || null,
    source: rowValue(row, 'source') || null,
  };
}

export function toPracticeAttemptDetail(row = {}) {
  const summary = toPracticeAttemptSummary(row);
  return {
    ...summary,
    blocker: rowValue(row, 'blocker') || null,
    reflection: rowValue(row, 'reflection') || null,
    challenge: {
      approach: rowValue(row, 'challenge_approach', 'approach') || null,
      invariant: rowValue(row, 'challenge_invariant', 'invariant') || null,
      complexity: rowValue(row, 'challenge_complexity', 'complexity') || null,
    },
  };
}

export function toPracticeSummary(row = {}) {
  return {
    totalCount: Number(rowValue(row, 'total_count', 'totalCount') || 0),
    dueCount: Number(rowValue(row, 'due_count', 'dueCount') || 0),
    firstCheckCount: Number(rowValue(row, 'first_check_count', 'firstCheckCount') || 0),
    nextItem: rowValue(row, 'next_item', 'nextItem') || null,
    recognitionTrapCount: Number(rowValue(row, 'recognition_trap_count', 'recognitionTrapCount') || 0),
    version: rowValue(row, 'version') || null,
  };
}

export const practiceQueueDto = toPracticeQueueItem;
export const practiceCardDto = toPracticeCardDto;
export const practiceAttemptSummaryDto = toPracticeAttemptSummary;
export const practiceAttemptDetailDto = toPracticeAttemptDetail;
export const practiceSummaryDto = toPracticeSummary;
