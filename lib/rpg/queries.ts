import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { Boss, PartyHealth } from "@/lib/supabase/types";
import { summarizeRecaps, type RecapBoss, type RecapSummary } from "@/lib/rpg/recap";
import { addDays } from "@/lib/calendar/dates";

export type BattleData = {
  familyId: string;
  boss: Boss | null;
  party: PartyHealth | null;
};

/** The family's active boss and party health, for the first render. */
export async function loadBattle(familyId: string): Promise<BattleData> {
  const supabase = await createClient();
  const [{ data: boss }, { data: party }] = await Promise.all([
    supabase
      .from("bosses")
      .select("*")
      .eq("family_id", familyId)
      .eq("status", "active")
      .maybeSingle(),
    supabase.from("party_health").select("*").eq("family_id", familyId).maybeSingle(),
  ]);
  return { familyId, boss, party };
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

  const ids = [...new Set(rows.flatMap((r) => [r.boss_id, r.escaped_boss_id, r.next_boss_id]).filter((id) => id !== null))];
  const { data: bosses } = ids.length
    ? await supabase.from("bosses").select("id, name, sprite_key, tier").in("id", ids)
    : { data: [] as RecapBoss[] };
  const byId = Object.fromEntries((bosses ?? []).map((b) => [b.id, b]));
  return summarizeRecaps(rows, byId, addDays(today, -1));
}
