// Streak recovery on the player's side: the rescue card's wording and the
// database's errors in kid-friendly words. Pure (no React / Supabase) —
// tests/rescue.test.mjs. The rules live in the database
// (20260928000014_streak_recovery.sql).

/**
 * When the rescue is due, relative to his today (both YYYY-MM-DD, family
 * time): "today", "tomorrow", or a weekday.
 */
export function rescueDeadline(dueOn: string, today: string): string {
  if (dueOn === today) return "today";
  const next = new Date(`${today}T12:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  if (dueOn === next.toISOString().slice(0, 10)) return "tomorrow";
  return new Date(`${dueOn}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "long", timeZone: "UTC" });
}

/** A pick_rescue_job / complete_rescue error, in words for him. */
export function friendlyRescueError(message: string | undefined, fallback: string): string {
  if (!message) return fallback;
  if (message.includes("rescue_overdue")) return "This rescue has closed. Tomorrow's quests will grow your streak again.";
  if (message.includes("rescue_closed")) return "This one's wrapped up — your streak's already been updated.";
  if (message.includes("rescue_not_picked")) return "Pick a rescue quest first, then tap All done.";
  if (message.includes("rescue_not_offered")) return "That one's not on your list — pick from the rescue quests shown.";
  if (message.includes("rescue_fallback")) return "Finish any of today's quests to rescue your streak.";
  if (message.includes("rescue_not_found")) return "Can't find that one — try picking again.";
  return fallback;
}
