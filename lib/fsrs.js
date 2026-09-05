export const FSRS_CONFIG = Object.freeze({
  requestRetention: 0.9,
  enableFuzz: false,
});

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
