import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { CalendarEvent } from "@/lib/supabase/types";
import { isMonthKey, monthGridRange, monthKeyOf, todayKey } from "./dates";
import { overlapFilter } from "./overlap";
import type { CalendarMember } from "./types";

export type CalendarData = {
  familyId: string;
  timeZone: string;
  month: string;
  today: string;
  events: CalendarEvent[];
  members: CalendarMember[];
};

/**
 * Everything the calendar needs for its first render: the family's timezone,
 * the requested month (defaults to the current one) and the events visible in
 * that month's grid. RLS already scopes every query to the caller's family.
 */
export async function loadCalendar(
  familyId: string,
  requestedMonth?: string | string[],
): Promise<CalendarData> {
  const supabase = await createClient();

  const [{ data: family }, { data: members }] = await Promise.all([
    supabase.from("families").select("timezone").eq("id", familyId).single(),
    supabase
      .from("profiles")
      .select("id, display_name, role")
      .eq("family_id", familyId)
      .order("created_at"),
  ]);

  const timeZone = family?.timezone ?? "Europe/London";
  const today = todayKey(timeZone);
  const month =
    typeof requestedMonth === "string" && isMonthKey(requestedMonth)
      ? requestedMonth
      : monthKeyOf(today);

  const { start, end } = monthGridRange(month, timeZone);
  const { data: events } = await supabase
    .from("calendar_events")
    .select("*")
    .eq("family_id", familyId)
    .lt("start_time", end)
    .or(overlapFilter(start))
    .order("start_time");

  return {
    familyId,
    timeZone,
    month,
    today,
    events: events ?? [],
    members: members ?? [],
  };
}

