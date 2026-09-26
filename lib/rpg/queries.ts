import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { Boss, StreakRescue } from "@/lib/supabase/types";
import { summarizeRecaps, type RecapBoss, type RecapSummary } from "@/lib/rpg/recap";
import { addDays } from "@/lib/calendar/dates";
import { buildTrophyCase, type Trophy, type TrophyLogRow } from "@/lib/rpg/trophies";

export type BattleData = {
  familyId: string;
  boss: Boss | null;
};

/** The family's active boss, for the first render. */
export async function loadBattle(familyId: string): Promise<BattleData> {
  const supabase = await createClient();
  const { data: boss } = await supabase
    .from("bosses")
    .select("*")
    .eq("family_id", familyId)
    .eq("status", "active")
    .maybeSingle();
  return { familyId, boss };
}

/**
 * His "while you were away" recap: every reset since he last acknowledged
 * one (unseen reset_recaps rows), combined, or null if there's none.
 * `today` is the family's today (YYYY-MM-DD).
 */
export async function loadRecap(childId: string, today: string): Promise<RecapSummary | null> {
  const supabase = await createClient();
  const { data: rows } = await supabase
    .from("reset_recaps")
    .select("*")
    .eq("child_id", childId)
    .is("seen_at", null)
    .order("created_at");
  if (!rows?.length) return null;

  const ids = [...new Set(rows.map((r) => r.boss_id).filter((id) => id !== null))];
  const { data: bosses } = ids.length
    ? await supabase.from("bosses").select("id, name, sprite_key, tier").in("id", ids)
    : { data: [] as RecapBoss[] };
  const byId = Object.fromEntries((bosses ?? []).map((b) => [b.id, b]));
  return summarizeRecaps(rows, byId, addDays(today, -1));
}

export type TrophyCaseData = {
  trophies: Trophy[];
  /** His best-ever streak (player_stats.best_streak; a child reads only his own). */
  bestStreak: number;
  timeZone: string;
};

/**
 * The Trophy Case: the family's roster with each boss's damage and defeat
 * date from boss_log (read-only). boss_log grows by a row per hit, so it's
 * read in pages (the API returns at most 1000 rows per request).
 */
export async function loadTrophyCase(familyId: string, childId: string): Promise<TrophyCaseData> {
  const supabase = await createClient();
  const [{ data: bosses }, { data: stats }, { data: family }] = await Promise.all([
    supabase
      .from("bosses")
      .select("id, name, tier, sprite_key, status, queue_position, created_at")
      .eq("family_id", familyId),
    supabase.from("player_stats").select("best_streak").eq("child_id", childId).maybeSingle(),
    supabase.from("families").select("timezone").eq("id", familyId).maybeSingle(),
  ]);

  const ids = (bosses ?? []).map((b) => b.id);
  const logs: TrophyLogRow[] = [];
  const PAGE = 1000;
  for (let from = 0; ids.length > 0; from += PAGE) {
    const { data } = await supabase
      .from("boss_log")
      .select("boss_id, event_type, amount, created_at")
      .in("boss_id", ids)
      // Quest hits and Night Raids both count as the family's damage.
      .in("event_type", ["damage", "night_raid", "defeated"])
      .order("id")
      .range(from, from + PAGE - 1);
    logs.push(...(data ?? []));
    if (!data || data.length < PAGE) break;
  }

  return {
    trophies: buildTrophyCase(bosses ?? [], logs),
    bestStreak: stats?.best_streak ?? 0,
    timeZone: family?.timezone ?? "Europe/London",
  };
}

/** His open streak rescue (a streak on hold), or null. */
export async function loadOpenRescue(childId: string): Promise<StreakRescue | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("streak_rescues")
    .select("*")
    .eq("child_id", childId)
    .eq("status", "open")
    .maybeSingle();
  return data;
}
