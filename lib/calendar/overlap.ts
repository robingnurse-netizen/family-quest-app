import type { CalendarEvent } from "@/lib/supabase/types";

/**
 * PostgREST `or` filter for "the event hasn't ended before `start`, or it
 * repeats". Combined with `.lt("start_time", end)` this selects every event
 * that can appear in [start, end): overlapping single events, plus any series
 * that began before the range ends (expanded client-side; an ended series
 * simply yields no occurrences). Used by the server loader and the client hook.
 */
export function overlapFilter(start: string) {
  return `end_time.gte."${start}",and(end_time.is.null,start_time.gte."${start}"),recurrence_rule.not.is.null`;
}

/** Client-side mirror of the query above, for cache invalidation. */
export function mayAppearIn(event: CalendarEvent, startMs: number, endMs: number) {
  if (Date.parse(event.start_time) >= endMs) return false;
  if (event.recurrence_rule) return true;
  return Date.parse(event.end_time ?? event.start_time) >= startMs;
}
