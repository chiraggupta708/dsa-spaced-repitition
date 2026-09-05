import {
  createEmptyCard,
  fsrs,
  generatorParameters,
  Rating,
  State,
} from 'ts-fsrs';

export const FSRS_CONFIG = Object.freeze({
  requestRetention: 0.9,
  enableFuzz: false,
});

export const FSRS_LIBRARY = Object.freeze({
  packageName: 'ts-fsrs',
  packageVersion: '5.4.2',
  algorithm: 'fsrs',
  algorithmVersion: 6,
  parameterVersion: 2,
});

export const SCHEDULER_MODES = Object.freeze({
  SM2: 'sm2',
  FSRS_SHADOW: 'fsrs_shadow',
  FSRS_ACTIVE: 'fsrs_active',
});

// Phase 3 records FSRS transitions without changing the legacy queue authority.
export const ACTIVE_SCHEDULER_MODE = SCHEDULER_MODES.FSRS_SHADOW;

const FSRS_PARAMETERS = deepFreeze(generatorParameters({
  request_retention: FSRS_CONFIG.requestRetention,
  enable_fuzz: FSRS_CONFIG.enableFuzz,
}));

export const FSRS_PARAMETER_RECORD = deepFreeze({
  library: FSRS_LIBRARY,
  parameters: FSRS_PARAMETERS,
});

const FSRS_RATINGS = Object.freeze({
  again: Rating.Again,
  hard: Rating.Hard,
  good: Rating.Good,
  easy: Rating.Easy,
});

const FSRS_STATES = Object.freeze([State.New, State.Learning, State.Review, State.Relearning]);

const FSRS_STATE_NAMES = Object.freeze({
  [State.New]: 'new',
  [State.Learning]: 'learning',
  [State.Review]: 'review',
  [State.Relearning]: 'relearning',
});

export function fsrsStateName(value) {
  if (!Number.isInteger(value) || !Object.hasOwn(FSRS_STATE_NAMES, value)) {
    throw new TypeError(`Invalid FSRS state: ${String(value)}`);
  }
  return FSRS_STATE_NAMES[value];
}

export const RATINGS = Object.freeze({
  AGAIN: 'again',
  HARD: 'hard',
  GOOD: 'good',
  EASY: 'easy',
});

const LEGACY_RATINGS = Object.freeze({
  1: RATINGS.AGAIN,
  2: RATINGS.HARD,
  3: RATINGS.HARD,
  4: RATINGS.GOOD,
  5: RATINGS.EASY,
});

function invalidRating(value) {
  throw new TypeError(`Invalid rating: ${String(value)}`);
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
}

function finiteNonNegative(value, field, { integer = false, maximum = Infinity } = {}) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0
    || value > maximum || (integer && !Number.isInteger(value))) {
    throw new TypeError(`Invalid FSRS card ${field}`);
  }
  return value;
}

function cardDate(value, field) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new TypeError(`Invalid FSRS card ${field}`);
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new TypeError(`Invalid FSRS card ${field}`);
  return date;
}

function serializeFsrsCard(card) {
  if (!card || typeof card !== 'object' || Array.isArray(card)) {
    throw new TypeError('Invalid FSRS card state');
  }
  const due = card.due instanceof Date ? card.due : cardDate(card.due, 'due');
  const state = finiteNonNegative(card.state, 'state', { integer: true, maximum: State.Relearning });
  if (!FSRS_STATES.includes(state)) throw new TypeError('Invalid FSRS card state');
  const serialized = {
    due: due.toISOString(),
    stability: finiteNonNegative(card.stability, 'stability'),
    difficulty: finiteNonNegative(card.difficulty, 'difficulty', { maximum: 10 }),
    elapsed_days: finiteNonNegative(card.elapsed_days, 'elapsed_days', { integer: true }),
    scheduled_days: finiteNonNegative(card.scheduled_days, 'scheduled_days', { integer: true }),
    learning_steps: finiteNonNegative(card.learning_steps, 'learning_steps', { integer: true }),
    reps: finiteNonNegative(card.reps, 'reps', { integer: true }),
    lapses: finiteNonNegative(card.lapses, 'lapses', { integer: true }),
    state,
  };
  if (card.last_review !== undefined && card.last_review !== null) {
    const lastReview = card.last_review instanceof Date
      ? card.last_review
      : cardDate(card.last_review, 'last_review');
    serialized.last_review = lastReview.toISOString();
  }
  return deepFreeze(serialized);
}

function deserializeFsrsCard(serialized) {
  if (!serialized || typeof serialized !== 'object' || Array.isArray(serialized)) {
    throw new TypeError('Invalid FSRS card state');
  }
  const normalized = serializeFsrsCard(serialized);
  return {
    ...normalized,
    due: new Date(normalized.due),
    ...(normalized.last_review ? { last_review: new Date(normalized.last_review) } : {}),
  };
}

export function isSerializedFsrsCard(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || value.due instanceof Date || value.last_review instanceof Date) return false;
  try {
    serializeFsrsCard(value);
    return true;
  } catch {
    return false;
  }
}

export function createFsrsTransition(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new TypeError('FSRS transition input must be an object');
  }
  if (typeof input.timeZone !== 'string' || input.timeZone.length === 0) {
    throw new TypeError('FSRS transition timeZone must be an IANA zone string');
  }
  const rating = normalizeRating(input.rating);
  if (input.legacyRating !== undefined && normalizeRating(input.legacyRating) !== rating) {
    throw new TypeError('Contradictory rating and legacyRating values');
  }
  const now = dateFrom(input.now);
  formatterFor(input.timeZone);
  const before = input.card === undefined || input.card === null
    ? createEmptyCard(now)
    : deserializeFsrsCard(input.card);
  const stateBefore = serializeFsrsCard(before);
  const result = fsrs(FSRS_PARAMETERS).next(before, now, FSRS_RATINGS[rating]);
  const actualElapsedDays = finiteNonNegative(result.log.elapsed_days, 'review elapsed_days', { integer: true });
  const overdueDays = Math.max(0, actualElapsedDays - stateBefore.scheduled_days);
  let cardAfter = result.card;
  let scheduledIntervalDays = cardAfter.scheduled_days;

  if (rating === RATINGS.AGAIN) {
    const override = scheduleNextDue({
      mode: 'review',
      rating,
      now,
      timeZone: input.timeZone,
    });
    scheduledIntervalDays = Math.max(1, Math.ceil(
      (Date.parse(override.dueAt) - now.getTime()) / (24 * 60 * 60 * 1000),
    ));
    cardAfter = {
      ...cardAfter,
      due: new Date(override.dueAt),
      scheduled_days: scheduledIntervalDays,
    };
  }

  const stateAfter = serializeFsrsCard(cardAfter);
  return deepFreeze({
    rating,
    dueAt: stateAfter.due,
    scheduledIntervalDays,
    actualElapsedDays,
    overdueDays,
    algorithm: FSRS_LIBRARY.algorithm,
    algorithmVersion: FSRS_LIBRARY.algorithmVersion,
    parameterVersion: FSRS_LIBRARY.parameterVersion,
    stateBefore,
    stateAfter,
  });
}

export function normalizeRating(value) {
  if (Object.values(RATINGS).includes(value)) return value;
  if (Number.isInteger(value) && Object.hasOwn(LEGACY_RATINGS, value)) {
    return LEGACY_RATINGS[value];
  }
  return invalidRating(value);
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
  } catch {
    throw new RangeError(`Invalid IANA time zone: ${String(timeZone)}`);
  }
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

// Resolve a local civil timestamp through the named IANA zone without relying on
// the machine's time zone. This keeps calendar arithmetic correct across DST.
function localDateTimeToInstant(parts, formatter) {
  const localEpoch = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
    parts.millisecond,
  );
  let timestamp = localEpoch;

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const observed = localParts(new Date(timestamp), formatter);
    const observedLocalEpoch = Date.UTC(
      observed.year,
      observed.month - 1,
      observed.day,
      observed.hour,
      observed.minute,
      observed.second,
      observed.millisecond,
    );
    const nextTimestamp = localEpoch - (observedLocalEpoch - timestamp);
    if (nextTimestamp === timestamp) break;
    timestamp = nextTimestamp;
  }

  const resolved = new Date(timestamp);
  if (!sameLocalParts(localParts(resolved, formatter), parts)) {
    throw new RangeError('Local date-time does not exist in the supplied time zone');
  }
  return resolved;
}

function dateFrom(value) {
  const result = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (Number.isNaN(result.getTime())) throw new TypeError('Invalid now date');
  return result;
}

export function scheduleNextDue(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new TypeError('Scheduler input must be an object');
  }
  if (input.mode !== 'review' && input.mode !== 'practice') {
    throw new TypeError('Scheduler mode must be review or practice');
  }
  if (typeof input.timeZone !== 'string' || input.timeZone.length === 0) {
    throw new TypeError('Scheduler timeZone must be an IANA zone string');
  }

  const rating = normalizeRating(input.rating);
  if (input.legacyRating !== undefined && normalizeRating(input.legacyRating) !== rating) {
    throw new TypeError('Contradictory rating and legacyRating values');
  }

  const now = dateFrom(input.now);
  const formatter = formatterFor(input.timeZone);
  const currentLocal = localParts(now, formatter);
  const targetLocal = input.mode === 'practice'
    ? addCalendarDays(currentLocal, 30)
    : { ...addCalendarDays(currentLocal, 1), hour: 0, minute: 0, second: 0, millisecond: 0 };

  return Object.freeze({
    dueAt: localDateTimeToInstant(targetLocal, formatter).toISOString(),
    rating,
  });
}
