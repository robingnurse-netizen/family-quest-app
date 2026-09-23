import type { CalendarEvent } from "@/lib/supabase/types";
import { addDays, eventDaySpan } from "./dates";
import { expandOccurrences, type CalendarOccurrence } from "./recurrence";

/**
 * Expand recurring series over [firstDay, lastDay] and bucket each
 * occurrence onto every day it covers within that range, sorted all-day
 * first, then by start time, then title. Shared by the month calendar and
 * the quest board's per-day notices.
 */
export function occurrencesByDay(
  events: CalendarEvent[],
  firstDay: string,
  lastDay: string,
  timeZone: string,
  today: string,
) {
  const map = new Map<string, CalendarOccurrence[]>();
  for (const event of events) {
    for (const occ of expandOccurrences(event, firstDay, lastDay, timeZone, today)) {
      const span = eventDaySpan(occ, timeZone);
      let day = span.first < firstDay ? firstDay : span.first;
      const last = span.last > lastDay ? lastDay : span.last;
      while (day <= last) {
        const list = map.get(day);
        if (list) list.push(occ);
        else map.set(day, [occ]);
        day = addDays(day, 1);
      }
    }
  }
  for (const list of map.values()) {
    list.sort(
      (a, b) =>
        Number(b.all_day) - Number(a.all_day) ||
        Date.parse(a.start_time) - Date.parse(b.start_time) ||
        a.title.localeCompare(b.title),
    );
  }
  return map;
}
