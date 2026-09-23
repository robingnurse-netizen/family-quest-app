import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, TaskSlotStatus } from "@/lib/supabase/types";
import { weekStartOf } from "@/lib/calendar/dates";

/** One scheduled quest, as the Quest Log month view shows it. */
export type LogQuest = {
  id: string;
  day: string;
  title: string;
  color: string | null;
  minutes: number;
  status: TaskSlotStatus;
  /** Completed and counted against a boss (shown with a tiny HIT! mark). */
  hit: boolean;
};

/**
 * A child's placed quests (task slots) between two days, inclusive. Used by
 * the Quest Log page's first render and when its month changes; RLS limits
 * a child to their own pools either way.
 */
export async function fetchQuestLog(
  supabase: SupabaseClient<Database>,
  childId: string,
  firstDay: string,
  lastDay: string,
): Promise<LogQuest[] | null> {
  const pools = await supabase
    .from("weekly_pools")
    .select("id, title, color")
    .eq("child_id", childId)
    .gte("week_start_date", weekStartOf(firstDay))
    .lte("week_start_date", lastDay);
  if (pools.error) return null;
  if (pools.data.length === 0) return [];

  const byPool = new Map(pools.data.map((p) => [p.id, p]));
  const slots = await supabase
    .from("task_slots")
    .select("id, pool_id, scheduled_date, duration_minutes, status, applied_to_boss, sort_order")
    .in("pool_id", [...byPool.keys()])
    .gte("scheduled_date", firstDay)
    .lte("scheduled_date", lastDay)
    .order("scheduled_date")
    .order("sort_order");
  if (slots.error) return null;

  return slots.data.map((s) => {
    const pool = byPool.get(s.pool_id);
    return {
      id: s.id,
      day: s.scheduled_date,
      title: pool?.title ?? "Quest",
      color: pool?.color ?? null,
      minutes: s.duration_minutes,
      status: s.status,
      hit: s.applied_to_boss,
    };
  });
}
