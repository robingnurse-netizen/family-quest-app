// Weekly recurrence for calendar events, stored as an RFC 5545 RRULE in
// calendar_events.recurrence_rule, e.g.
//   FREQ=WEEKLY;BYDAY=MO,WE,FR
//   FREQ=WEEKLY;BYDAY=TU;UNTIL=20261222T235959Z
//
// Semantics (all in the family timezone):
//   * The row's start_time/end_time are the series' first possible slot; its
//     wall-clock time and length are reused for every occurrence.
//   * Occurrences fall on the BYDAY weekdays on or after the start date.
//   * UNTIL is the last instant of the "Ends on" day, so that day is included.
//   * No UNTIL = repeats indefinitely; expansion is capped at 1 year from today.
//
// Only the weekly subset above is supported. Any other rule is treated as a
// single occurrence rather than guessed at.

import type { CalendarEvent } from "@/lib/supabase/types";
import {
  addDays,
  dayKeyOf,
  eventDaySpan,
  isDayKey,
  parseDayKey,
  timeOf,
  zonedToUtc,
} from "./dates";

export const WEEKDAY_CODES = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"] as const;
export type WeekdayCode = (typeof WEEKDAY_CODES)[number];

const WEEKDAY_NAMES: Record<WeekdayCode, string> = {
  MO: "Mon",
  TU: "Tue",
  WE: "Wed",
  TH: "Thu",
  FR: "Fri",
  SA: "Sat",
  SU: "Sun",
};

export const weekdayName = (code: WeekdayCode) => WEEKDAY_NAMES[code];

export function isWeekdayCode(value: string): value is WeekdayCode {
  return (WEEKDAY_CODES as readonly string[]).includes(value);
}

/** Weekday code of a day key (pure calendar arithmetic). */
export function weekdayOf(dayKey: string): WeekdayCode {
  const { year, month, day } = parseDayKey(dayKey);
  const sundayFirst = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return WEEKDAY_CODES[(sundayFirst + 6) % 7];
}

export type WeeklyRule = {
  days: WeekdayCode[];
  /** Last day (inclusive) an occurrence may start on, or null = indefinite. */
  untilDay: string | null;
};

/** Build the RRULE string. `days` is sorted into Mon–Sun order. */
export function buildWeeklyRule(
  days: WeekdayCode[],
  untilDay: string | null,
  timeZone: string,
) {
  const byDay = WEEKDAY_CODES.filter((c) => days.includes(c)).join(",");
  let rule = `FREQ=WEEKLY;BYDAY=${byDay}`;
  if (untilDay) {
    // Last second of the "Ends on" day, in UTC as RFC 5545 requires.
    const endOfDay = new Date(
      zonedToUtc(addDays(untilDay, 1), "00:00", timeZone).getTime() - 1000,
    );
    rule += `;UNTIL=${endOfDay.toISOString().replace(/[-:]|\.\d{3}/g, "")}`;
  }
  return rule;
}

/** Parse a weekly RRULE, or null if it isn't one we support. */
export function parseWeeklyRule(
  rule: string | null | undefined,
  timeZone: string,
): WeeklyRule | null {
  if (!rule) return null;
  const parts = new Map<string, string>();
  for (const part of rule.replace(/^RRULE:/i, "").split(";")) {
    const [key, value] = part.split("=");
    if (key && value) parts.set(key.toUpperCase(), value.toUpperCase());
  }
  if (parts.get("FREQ") !== "WEEKLY") return null;
  const unsupported = [...parts.keys()].some(
    (k) => !["FREQ", "BYDAY", "UNTIL", "WKST"].includes(k),
  );
  if (unsupported) return null;

  const days = (parts.get("BYDAY") ?? "").split(",").filter(isWeekdayCode);
  if (days.length === 0) return null;

  let untilDay: string | null = null;
  const until = parts.get("UNTIL");
  if (until) {
    const m = until.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})Z?)?$/);
    if (!m) return null;
    const [, y, mo, d, hh, mm, ss] = m;
    untilDay = hh
      ? dayKeyOf(new Date(Date.UTC(+y, +mo - 1, +d, +hh, +mm, +ss)), timeZone)
      : `${y}-${mo}-${d}`;
    if (!isDayKey(untilDay)) return null;
  }
  return { days, untilDay };
}

/** "Every Mon, Wed, Fri" / "Every Tue until Tue 22 Dec" style summary. */
export function describeRule(rule: WeeklyRule, formatDay: (day: string) => string) {
  const days =
    rule.days.length === 7 ? "Every day" : `Every ${rule.days.map(weekdayName).join(", ")}`;
  return rule.untilDay ? `${days} until ${formatDay(rule.untilDay)}` : days;
}

/**
 * One rendered instance of an event. For single events this is the row
 * itself; for a series, start/end are shifted to that week's slot while `id`
 * still points at the series row (edits/deletes act on the whole series).
 */
export type CalendarOccurrence = CalendarEvent & {
  /** Unique per occurrence — use as the React key. */
  occurrenceKey: string;
};

/**
 * Every occurrence of `event` that touches the day range [firstDay, lastDay].
 * `today` bounds indefinite series to one year out.
 */
export function expandOccurrences(
  event: CalendarEvent,
  firstDay: string,
  lastDay: string,
  timeZone: string,
  today: string,
): CalendarOccurrence[] {
  const rule = parseWeeklyRule(event.recurrence_rule, timeZone);
  if (!rule) return [{ ...event, occurrenceKey: event.id }];

  const span = eventDaySpan(event, timeZone);
  const spanDays = dayDiff(span.first, span.last);
  const cap = rule.untilDay ?? addYear(today);
  const startTime = timeOf(event.start_time, timeZone);
  const durationMs = event.end_time
    ? Date.parse(event.end_time) - Date.parse(event.start_time)
    : null;

  // Start early enough to catch multi-day occurrences spilling into range.
  let day = maxDay(span.first, addDays(firstDay, -spanDays));
  const stop = minDay(lastDay, cap);
  const out: CalendarOccurrence[] = [];

  for (; day <= stop; day = addDays(day, 1)) {
    if (!rule.days.includes(weekdayOf(day))) continue;

    let start: Date;
    let end: Date | null;
    if (event.all_day) {
      start = zonedToUtc(day, "00:00", timeZone);
      end = event.end_time ? zonedToUtc(addDays(day, spanDays), "00:00", timeZone) : null;
    } else {
      // Keep the wall-clock start (09:00 stays 09:00 across DST) and length.
      start = zonedToUtc(day, startTime, timeZone);
      end = durationMs === null ? null : new Date(start.getTime() + durationMs);
    }

    out.push({
      ...event,
      start_time: start.toISOString(),
      end_time: end?.toISOString() ?? null,
      occurrenceKey: `${event.id}:${day}`,
    });
  }
  return out;
}

function dayDiff(from: string, to: string) {
  const a = parseDayKey(from);
  const b = parseDayKey(to);
  return Math.round(
    (Date.UTC(b.year, b.month - 1, b.day) - Date.UTC(a.year, a.month - 1, a.day)) / 86_400_000,
  );
}

function addYear(dayKey: string) {
  const { year, month, day } = parseDayKey(dayKey);
  // 29 Feb + 1 year rolls to 1 Mar, which is fine for a rendering cap.
  const d = new Date(Date.UTC(year + 1, month - 1, day));
  return dayKeyOf(d, "UTC");
}

const maxDay = (a: string, b: string) => (a > b ? a : b);
const minDay = (a: string, b: string) => (a < b ? a : b);
