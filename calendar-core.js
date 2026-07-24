/**
 * Pure, dependency-free calendar and scheduling helpers.
 *
 * Calendar dates are interpreted in the user's local time zone. Intervals are
 * half-open (`start <= value < end`), so an event ending at 10:00 does not
 * overlap one beginning at 10:00.
 */

const DAY_MINUTES = 24 * 60;
const LAST_CLOCK_MINUTE = DAY_MINUTES - 1;
const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const CLOCK_RE = /^\s*([+-]?\d{1,4})(?::(\d{1,3}))?\s*([ap](?:\.?m\.?)?)?\s*$/i;

const clamp = (value, minimum, maximum) =>
  Math.min(maximum, Math.max(minimum, value));

function validDate(value, name = "date") {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new TypeError(`${name} must be a valid Date or calendar-date string`);
  }
  return value;
}

function coerceDate(value, name = "date") {
  if (value instanceof Date) return new Date(validDate(value, name).getTime());
  if (typeof value === "string" && ISO_DATE_RE.test(value)) {
    return dateFromISO(value);
  }
  if (typeof value === "string" || typeof value === "number") {
    return validDate(new Date(value), name);
  }
  throw new TypeError(`${name} must be a valid Date or calendar-date string`);
}

function pad2(value) {
  return String(value).padStart(2, "0");
}

function yearString(year) {
  if (year >= 0 && year <= 9999) return String(year).padStart(4, "0");
  const sign = year < 0 ? "-" : "+";
  return `${sign}${String(Math.abs(year)).padStart(6, "0")}`;
}

/** Format a Date as a local YYYY-MM-DD calendar date (never a UTC shift). */
export function dateToISO(value) {
  const date = coerceDate(value);
  return `${yearString(date.getFullYear())}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

/** Parse a strict YYYY-MM-DD value as local midnight, rejecting rollover dates. */
export function dateFromISO(value) {
  if (typeof value !== "string") {
    throw new TypeError("ISO calendar date must be a YYYY-MM-DD string");
  }
  const match = ISO_DATE_RE.exec(value);
  if (!match) throw new RangeError(`Invalid ISO calendar date: ${value}`);

  const year = Number(match[1]);
  const month = Number(match[2]) - 1;
  const day = Number(match[3]);
  const date = new Date(0);
  date.setHours(0, 0, 0, 0);
  date.setFullYear(year, month, day);

  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month ||
    date.getDate() !== day
  ) {
    throw new RangeError(`Invalid ISO calendar date: ${value}`);
  }
  return date;
}

/** Return a new Date advanced by whole local calendar days. */
export function addDays(value, amount) {
  const numericAmount = Number(amount);
  if (!Number.isFinite(numericAmount)) {
    throw new TypeError("amount must be a finite number");
  }
  const date = coerceDate(value);
  date.setDate(date.getDate() + Math.trunc(numericAmount));
  return date;
}

/** Return local midnight on the Monday beginning the date's week. */
export function startOfWeek(value) {
  const date = coerceDate(value);
  date.setHours(0, 0, 0, 0);
  const daysSinceMonday = (date.getDay() + 6) % 7;
  date.setDate(date.getDate() - daysSinceMonday);
  return date;
}

/** Compare two values by local calendar date. */
export function sameDay(left, right) {
  const a = coerceDate(left, "left date");
  const b = coerceDate(right, "right date");
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function parseClock(value, allowBoundary = false) {
  if (value instanceof Date) {
    validDate(value, "time");
    return value.getHours() * 60 + value.getMinutes();
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("time must be finite");
    const maximum = allowBoundary ? DAY_MINUTES : LAST_CLOCK_MINUTE;
    return clamp(Math.trunc(value), 0, maximum);
  }
  if (typeof value !== "string") {
    throw new TypeError("time must be minutes or a clock string");
  }

  const match = CLOCK_RE.exec(value);
  if (!match) throw new RangeError(`Invalid clock time: ${value}`);
  let hour = Number(match[1]);
  const minute = match[2] === undefined ? 0 : Number(match[2]);
  const meridiem = match[3]?.replaceAll(".", "").toLowerCase();

  if (meridiem) {
    if (hour < 1 || hour > 12 || minute > 59 || hour < 0) {
      throw new RangeError(`Invalid 12-hour clock time: ${value}`);
    }
    hour = (hour % 12) + (meridiem.startsWith("p") ? 12 : 0);
  }

  const total = hour * 60 + minute;
  const maximum = allowBoundary ? DAY_MINUTES : LAST_CLOCK_MINUTE;
  return clamp(Math.trunc(total), 0, maximum);
}

/** Convert HH:MM (or a 12-hour clock string) to minutes, clamped to 0...1439. */
export function minutesFromTime(value) {
  return parseClock(value, false);
}

/** Convert minutes to zero-padded HH:MM, clamped to the visible clock day. */
export function timeFromMinutes(value) {
  const total = parseClock(value, false);
  return `${pad2(Math.floor(total / 60))}:${pad2(total % 60)}`;
}

/** Format a clock value as human-readable 12-hour or 24-hour time. */
export function formatTime(value, preference = "12h") {
  const minutes = minutesFromTime(value);
  const use24Hour =
    preference === true ||
    preference === 24 ||
    preference === "24" ||
    preference === "24h" ||
    (preference && typeof preference === "object" &&
      (preference.hour12 === false || preference.use24Hour === true));

  if (use24Hour) return timeFromMinutes(minutes);
  const hour = Math.floor(minutes / 60);
  const displayHour = hour % 12 || 12;
  return `${displayHour}:${pad2(minutes % 60)} ${hour < 12 ? "AM" : "PM"}`;
}

function localeOption(localeOrOptions) {
  if (typeof localeOrOptions === "string") return localeOrOptions;
  if (localeOrOptions && typeof localeOrOptions === "object") {
    return localeOrOptions.locale || "en-US";
  }
  return "en-US";
}

/**
 * Label the Monday-through-Sunday week containing a date.
 * Examples: "Jul 20 – 26, 2026" and "Dec 29, 2025 – Jan 4, 2026".
 */
export function formatWeekRange(value, localeOrOptions = "en-US") {
  const first = startOfWeek(value);
  const last = addDays(first, 6);
  const locale = localeOption(localeOrOptions);
  const monthDay = new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "numeric",
  });
  const dayOnly = new Intl.DateTimeFormat(locale, { day: "numeric" });
  const full = new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

  const sameYear = first.getFullYear() === last.getFullYear();
  const sameMonth = sameYear && first.getMonth() === last.getMonth();
  if (sameMonth) {
    return `${monthDay.format(first)} – ${dayOnly.format(last)}, ${last.getFullYear()}`;
  }
  if (sameYear) {
    return `${monthDay.format(first)} – ${monthDay.format(last)}, ${last.getFullYear()}`;
  }
  return `${full.format(first)} – ${full.format(last)}`;
}

/**
 * Build a Monday-first month grid. By default it is always six weeks (42
 * cells), including the leading and trailing dates from adjacent months.
 */
export function getMonthMatrix(value = new Date(), monthOrOptions, maybeOptions) {
  let focus;
  let options;
  if (typeof value === "number" && typeof monthOrOptions === "number") {
    focus = new Date(0);
    focus.setHours(0, 0, 0, 0);
    focus.setFullYear(value, monthOrOptions, 1);
    options = maybeOptions || {};
  } else {
    focus = coerceDate(value);
    options = monthOrOptions || {};
  }

  const year = focus.getFullYear();
  const month = focus.getMonth();
  const firstOfMonth = new Date(focus.getTime());
  firstOfMonth.setHours(0, 0, 0, 0);
  firstOfMonth.setDate(1);
  const gridStart = startOfWeek(firstOfMonth);
  const today = options.today === undefined ? new Date() : coerceDate(options.today);

  let cellCount = 42;
  if (options.fixedWeeks === false) {
    const lastOfMonth = new Date(firstOfMonth.getTime());
    lastOfMonth.setMonth(month + 1, 0);
    const lastWeekStart = startOfWeek(lastOfMonth);
    cellCount = Math.round((lastWeekStart - gridStart) / 86_400_000) + 7;
  }

  const weeks = [];
  for (let offset = 0; offset < cellCount; offset += 7) {
    const week = [];
    for (let weekday = 0; weekday < 7; weekday += 1) {
      const date = addDays(gridStart, offset + weekday);
      const inCurrentMonth =
        date.getFullYear() === year && date.getMonth() === month;
      week.push({
        date,
        iso: dateToISO(date),
        day: date.getDate(),
        dayOfMonth: date.getDate(),
        month: date.getMonth(),
        year: date.getFullYear(),
        inCurrentMonth,
        isCurrentMonth: inCurrentMonth,
        isToday: sameDay(date, today),
      });
    }
    weeks.push(week);
  }
  return weeks;
}

function firstPresent(object, keys) {
  for (const key of keys) {
    if (object[key] !== undefined && object[key] !== null) return object[key];
  }
  return undefined;
}

function localDateAtMinutes(base, minutes) {
  const date = coerceDate(base, "event date");
  date.setHours(0, 0, 0, 0);
  date.setMinutes(minutes);
  return date;
}

function endpoint(value, baseDate) {
  if (value instanceof Date) {
    return { value: validDate(value, "event endpoint").getTime(), absolute: true, clock: false };
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("event endpoint must be finite");
    if (baseDate !== undefined) {
      return {
        value: localDateAtMinutes(baseDate, Math.trunc(value)).getTime(),
        absolute: true,
        clock: true,
      };
    }
    return { value: Math.trunc(value), absolute: false, clock: true };
  }
  if (typeof value !== "string") throw new TypeError("event endpoint is missing");

  if (CLOCK_RE.test(value)) {
    const minutes = parseClock(value, true);
    if (baseDate !== undefined) {
      return {
        value: localDateAtMinutes(baseDate, minutes).getTime(),
        absolute: true,
        clock: true,
      };
    }
    return { value: minutes, absolute: false, clock: true };
  }

  const parsed = ISO_DATE_RE.test(value) ? dateFromISO(value) : new Date(value);
  validDate(parsed, "event endpoint");
  return { value: parsed.getTime(), absolute: true, clock: false };
}

function eventBounds(event) {
  if (Array.isArray(event) && event.length >= 2) {
    const start = endpoint(event[0]);
    const end = endpoint(event[1]);
    return { start: start.value, end: end.value, absolute: start.absolute && end.absolute };
  }
  if (!event || typeof event !== "object") {
    throw new TypeError("event must be an interval object or [start, end]");
  }

  const eventDate = firstPresent(event, ["date", "startDate"]);
  if (event.allDay && eventDate !== undefined) {
    const startDate = coerceDate(eventDate, "event date");
    startDate.setHours(0, 0, 0, 0);
    let endDate;
    if (event.endDate !== undefined) {
      endDate = coerceDate(event.endDate, "event end date");
      endDate.setHours(0, 0, 0, 0);
      if (endDate <= startDate) endDate = addDays(startDate, 1);
    } else {
      endDate = addDays(startDate, 1);
    }
    return { start: startDate.getTime(), end: endDate.getTime(), absolute: true };
  }

  const startRaw = firstPresent(event, [
    "startMin",
    "startTime",
    "startAt",
    "startsAt",
    "start",
  ]);
  const endRaw = firstPresent(event, [
    "endMin",
    "endTime",
    "endAt",
    "endsAt",
    "end",
  ]);
  const startBase = firstPresent(event, ["startDate", "date"]);
  const endBase = firstPresent(event, ["endDate", "date", "startDate"]);
  const start = endpoint(startRaw, startBase);
  const end = endpoint(endRaw, endBase);

  if (start.absolute !== end.absolute) {
    throw new TypeError("event start and end must use compatible date formats");
  }
  let endValue = end.value;
  if (
    start.absolute &&
    start.clock &&
    end.clock &&
    endValue <= start.value &&
    event.endDate === undefined
  ) {
    const wrapped = new Date(endValue);
    wrapped.setDate(wrapped.getDate() + 1);
    endValue = wrapped.getTime();
  }
  return { start: start.value, end: endValue, absolute: start.absolute };
}

/** Return whether two event-like half-open intervals share any time. */
export function eventsOverlap(left, right) {
  try {
    const a = eventBounds(left);
    const b = eventBounds(right);
    if (a.absolute !== b.absolute || a.end <= a.start || b.end <= b.start) return false;
    return a.start < b.end && b.start < a.end;
  } catch {
    return false;
  }
}

function busyMinutesForDate(event, targetDate) {
  const bounds = eventBounds(event);
  if (!bounds.absolute) return [bounds.start, bounds.end];

  const dayStart = coerceDate(targetDate);
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = addDays(dayStart, 1);
  const clippedStart = Math.max(bounds.start, dayStart.getTime());
  const clippedEnd = Math.min(bounds.end, dayEnd.getTime());
  if (clippedEnd <= clippedStart) return null;

  // Project instants back onto the wall clock instead of dividing elapsed
  // milliseconds by 60,000. On a daylight-saving transition, local 09:00 is
  // still minute 540 even though fewer or more real minutes followed midnight.
  const wallMinute = (timestamp, isEnd) => {
    if (timestamp <= dayStart.getTime()) return 0;
    if (timestamp >= dayEnd.getTime()) return DAY_MINUTES;
    const point = new Date(timestamp);
    const exact =
      point.getHours() * 60 +
      point.getMinutes() +
      point.getSeconds() / 60 +
      point.getMilliseconds() / 60_000;
    return isEnd ? Math.ceil(exact) : Math.floor(exact);
  };
  return [
    Math.max(0, wallMinute(clippedStart, false)),
    Math.min(DAY_MINUTES, wallMinute(clippedEnd, true)),
  ];
}

function boundaryMinutes(value, fallback) {
  if (value === undefined || value === null) return fallback;
  if (typeof value === "string") return parseClock(value, true);
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) throw new TypeError("schedule boundary must be finite");
  return clamp(Math.trunc(numeric), 0, DAY_MINUTES);
}

function boundaryTime(minutes) {
  return minutes === DAY_MINUTES ? "24:00" : timeFromMinutes(minutes);
}

/**
 * Find the first free slot on `date` inside [startMin, endMin).
 *
 * Events may use `{date, startTime, endTime}`, `{date, startMin, endMin}`,
 * absolute `{start, end}` date-times, or numeric `{start, end}` intervals.
 * Returns a descriptive slot object, or null when the window has no fit.
 */
export function findNextOpenSlot(
  events,
  date,
  duration,
  startMin = 0,
  endMin = DAY_MINUTES,
) {
  if (!Array.isArray(events)) throw new TypeError("events must be an array");
  const targetDate = coerceDate(date);
  targetDate.setHours(0, 0, 0, 0);
  const length = Math.trunc(Number(duration));
  if (!Number.isFinite(length) || length <= 0) {
    throw new RangeError("duration must be a positive number of minutes");
  }
  const windowStart = boundaryMinutes(startMin, 0);
  const windowEnd = boundaryMinutes(endMin, DAY_MINUTES);
  if (windowEnd <= windowStart || length > windowEnd - windowStart) return null;

  const busy = [];
  for (const event of events) {
    try {
      const interval = busyMinutesForDate(event, targetDate);
      if (!interval) continue;
      const start = Math.max(windowStart, interval[0]);
      const end = Math.min(windowEnd, interval[1]);
      if (end > start) busy.push([start, end]);
    } catch {
      // Invalid or incomplete draft events do not make the scheduler unusable.
    }
  }
  busy.sort((a, b) => a[0] - b[0] || a[1] - b[1]);

  let cursor = windowStart;
  for (const [busyStart, busyEnd] of busy) {
    if (busyEnd <= cursor) continue;
    if (busyStart - cursor >= length) break;
    cursor = Math.max(cursor, busyEnd);
    if (cursor + length > windowEnd) return null;
  }
  if (cursor + length > windowEnd) return null;

  const slotEnd = cursor + length;
  const startTime = boundaryTime(cursor);
  const endTime = boundaryTime(slotEnd);
  return {
    date: dateToISO(targetDate),
    startMin: cursor,
    endMin: slotEnd,
    startTime,
    endTime,
    start: startTime,
    end: endTime,
  };
}

// Small naming aliases make the core pleasant to consume from different UI layers.
export const toISODate = dateToISO;
export const fromISODate = dateFromISO;
export const toISO = dateToISO;
export const fromISO = dateFromISO;
export const weekRangeLabel = formatWeekRange;
export const formatWeekRangeLabel = formatWeekRange;
export const monthMatrix = getMonthMatrix;
export const overlaps = eventsOverlap;
