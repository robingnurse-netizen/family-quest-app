// Map database errors raised by the pool integrity and child-guard triggers
// (supabase/migrations/20260922000004_pool_integrity.sql,
// 20260922000005_child_slot_guard.sql and 20260924000010_child_slot_no_past_days.sql)
// to friendly text.

export function friendlyBacklogError(message: string | undefined, fallback: string) {
  if (!message) return fallback;
  if (message.startsWith("pool_over_allocated")) {
    return "That's more minutes than this weekly quest has left.";
  }
  if (message.startsWith("pool_below_allocated")) {
    return "More minutes than that are already scheduled — remove some slots first.";
  }
  if (message.startsWith("slot_outside_week")) {
    return "That day isn't in this quest's week.";
  }
  if (message.startsWith("slot_locked")) {
    return "That quest's damage has already been dealt — it's locked in.";
  }
  if (message.startsWith("slot_past_day")) {
    return "That day has already gone — pick today or later.";
  }
  if (message.startsWith("slot_child_forbidden")) {
    return "That change isn't allowed from the quest board.";
  }
  if (message.includes("weekly_pools_week_starts_monday")) {
    return "Weeks start on a Monday.";
  }
  return fallback;
}
