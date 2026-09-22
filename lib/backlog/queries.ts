import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { Profile, TaskSlot, WeeklyPool } from "@/lib/supabase/types";
import { fetchWeek } from "./fetch-week";
import { isDayKey, todayKey, weekStartOf } from "@/lib/calendar/dates";
import type { BoardMember } from "./types";

export type WeekBoardData = {
  familyId: string;
  timeZone: string;
  week: string;
  today: string;
  /** Only this child's pools; null = every child in the family (parents). */
  childId: string | null;
  pools: WeeklyPool[];
  slots: TaskSlot[];
  members: BoardMember[];
};

/**
 * First-render data for a week of pools. Parents get every family pool for
 * the week; a child gets only their own. `requestedWeek` may be any day in
 * the week — it's normalised to that week's Monday.
 */
export async function loadWeekBoard(
  profile: Profile,
  requestedWeek?: string | string[],
): Promise<WeekBoardData> {
  const supabase = await createClient();

  const [{ data: family }, { data: members }] = await Promise.all([
    supabase.from("families").select("timezone").eq("id", profile.family_id).single(),
    supabase
      .from("profiles")
      .select("id, display_name, role")
      .eq("family_id", profile.family_id)
      .order("created_at"),
  ]);

  const timeZone = family?.timezone ?? "Europe/London";
  const today = todayKey(timeZone);
  const week = weekStartOf(
    typeof requestedWeek === "string" && isDayKey(requestedWeek) ? requestedWeek : today,
  );
  const childId = profile.role === "child" ? profile.id : null;

  const result = await fetchWeek(supabase, profile.family_id, week, childId);
  return {
    familyId: profile.family_id,
    timeZone,
    week,
    today,
    childId,
    pools: result?.pools ?? [],
    slots: result?.slots ?? [],
    members: members ?? [],
  };
}
