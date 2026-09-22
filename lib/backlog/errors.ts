// Map database errors raised by the pool integrity triggers
// (supabase/migrations/20260922000004_pool_integrity.sql) to friendly text.

export function friendlyBacklogError(message: string | undefined, fallback: string) {
  if (!message) return fallback;
  if (message.startsWith("pool_over_allocated")) {
    return "That's more minutes than this pool has left.";
  }
  if (message.startsWith("pool_below_allocated")) {
    return "More minutes than that are already scheduled — remove some slots first.";
  }
  if (message.startsWith("slot_outside_week")) {
    return "That day isn't in this pool's week.";
  }
  if (message.includes("weekly_pools_week_starts_monday")) {
    return "Weeks start on a Monday.";
  }
  return fallback;
}
