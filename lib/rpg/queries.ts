import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { Boss, PartyHealth } from "@/lib/supabase/types";

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
