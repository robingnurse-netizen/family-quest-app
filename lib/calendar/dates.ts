// Timezone-aware date helpers for the family calendar.
//
// Everything is bucketed in the *family's* timezone (families.timezone), not
// the device's, so Dad's phone and Reuben's tablet always agree on which day
// an event falls on. Pure functions — safe to import on server and client.
//
// Conventions:
//   * A "day key" is a calendar date string "YYYY-MM-DD".
//   * Timed events: end_time is exclusive (an event ending at 00:00 does not
//     spill onto the next day).
//   * All-day events: start_time is 00:00 on the first day and end_time is
//     00:00 on the LAST day (inclusive), both in the family timezone.
//   * Weeks start on Monday.

import type { CalendarEvent } from "@/lib/supabase/types";

const partsFormatters = new Map<string, Intl.DateTimeFormat>();

function partsFormatter(timeZone: string) {
  let f = partsFormatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-GB", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    partsFormatters.set(timeZone, f);
  }
  return f;
}

/** Wall-clock parts of an instant in the given timezone. */
function zonedParts(date: Date, timeZone: string) {
  const out: Record<string, number> = {};
  for (const p of partsFormatter(timeZone).formatToParts(date)) {
    if (p.type !== "literal") out[p.type] = Number(p.value);
  }
  return out as {
    year: number;
    month: number;
    day: number;
    hour: number;
    minute: number;
    second: number;
  };
}

/** Offset (ms) of `timeZone` from UTC at the given instant. */
function tzOffset(date: Date, timeZone: string) {
  const p = zonedParts(date, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

const pad = (n: number) => String(n).padStart(2, "0");

export function parseDayKey(key: string) {
  const [y, m, d] = key.split("-").map(Number);
  return { year: y, month: m, day: d };
}

export function isDayKey(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

export function isTimeString(value: string) {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

/** Day key of an instant, as seen in the family timezone. */
export function dayKeyOf(instant: string | Date, timeZone: string) {
  const p = zonedParts(new Date(instant), timeZone);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

/** "HH:mm" of an instant in the family timezone. */
export function timeOf(instant: string | Date, timeZone: string) {
  const p = zonedParts(new Date(instant), timeZone);
  return `${pad(p.hour)}:${pad(p.minute)}`;
}

/**
 * Convert a wall-clock date + time in `timeZone` to a UTC instant.
 * Handles DST: a time that doesn't exist (clocks spring forward) resolves to
 * the instant just after the gap.
 */
export function zonedToUtc(dayKey: string, time: string, timeZone: string) {
  const { year, month, day } = parseDayKey(dayKey);
  const [hh, mm] = time.split(":").map(Number);
  const guess = Date.UTC(year, month - 1, day, hh, mm);
  let result = guess - tzOffset(new Date(guess), timeZone);
  const second = guess - tzOffset(new Date(result), timeZone);
  if (second !== result) result = second;
  return new Date(result);
}

/** Add days to a day key (pure calendar arithmetic, no timezone). */
export function addDays(dayKey: string, days: number) {
  const { year, month, day } = parseDayKey(dayKey);
  const d = new Date(Date.UTC(year, month - 1, day + days));
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/** "YYYY-MM" month key. */
export function monthKeyOf(dayKey: string) {
  return dayKey.slice(0, 7);
}

export function isMonthKey(value: string) {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
}

export function addMonths(monthKey: string, months: number) {
  const [y, m] = monthKey.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + months, 1));
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`;
}

/**
 * The 6×7 grid of day keys shown for a month (Monday-first), padded with the
 * trailing days of the previous month and leading days of the next.
 */
export function monthGrid(monthKey: string) {
  const first = `${monthKey}-01`;
  const { year, month } = parseDayKey(first);
  const weekday = new Date(Date.UTC(year, month - 1, 1)).getUTCDay(); // 0 = Sun
  const start = addDays(first, -((weekday + 6) % 7));
  return Array.from({ length: 42 }, (_, i) => addDays(start, i));
}

/** UTC bounds [start, end) covering the whole visible grid for a month. */
export function monthGridRange(monthKey: string, timeZone: string) {
  const grid = monthGrid(monthKey);
  return {
    start: zonedToUtc(grid[0], "00:00", timeZone).toISOString(),
    end: zonedToUtc(addDays(grid[grid.length - 1], 1), "00:00", timeZone).toISOString(),
  };
}

/** First and last day keys (inclusive) that an event occupies. */
export function eventDaySpan(
  event: Pick<CalendarEvent, "start_time" | "end_time" | "all_day">,
  timeZone: string,
) {
  const first = dayKeyOf(event.start_time, timeZone);
  if (!event.end_time) return { first, last: first };

  if (event.all_day) {
    const last = dayKeyOf(event.end_time, timeZone);
    return { first, last: last < first ? first : last };
  }

  const endMs = new Date(event.end_time).getTime();
  const startMs = new Date(event.start_time).getTime();
  // Exclusive end: a 22:00–00:00 event stays on its start day.
  const last = endMs > startMs ? dayKeyOf(new Date(endMs - 1), timeZone) : first;
  return { first, last };
}

/** Today's day key in the family timezone. */
export function todayKey(timeZone: string) {
  return dayKeyOf(new Date(), timeZone);
}

// Fixed name tables rather than Intl: server (Node) and browser ICU data can
// disagree (e.g. "Sep" vs "Sept"), which would cause hydration mismatches.
const WEEKDAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTH_LONG = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** "Tue 22 Sep" */
export function formatDayLabel(dayKey: string) {
  const { year, month, day } = parseDayKey(dayKey);
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return `${WEEKDAY_SHORT[weekday]} ${day} ${MONTH_SHORT[month - 1]}`;
}

/** "September 2026" */
export function formatMonthLabel(monthKey: string) {
  const [year, month] = monthKey.split("-").map(Number);
  return `${MONTH_LONG[month - 1]} ${year}`;
}

/** Human-readable "when" line for an event, in the family timezone. */
export function formatEventWhen(
  event: Pick<CalendarEvent, "start_time" | "end_time" | "all_day">,
  timeZone: string,
) {
  const { first, last } = eventDaySpan(event, timeZone);
  if (event.all_day) {
    return first === last
      ? `${formatDayLabel(first)} · All day`
      : `${formatDayLabel(first)} – ${formatDayLabel(last)} · All day`;
  }
  const start = timeOf(event.start_time, timeZone);
  if (!event.end_time) return `${formatDayLabel(first)} · ${start}`;
  const end = timeOf(event.end_time, timeZone);
  return first === last
    ? `${formatDayLabel(first)} · ${start}–${end}`
    : `${formatDayLabel(first)} ${start} – ${formatDayLabel(last)} ${end}`;
}
