"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { PlayerStats } from "@/lib/supabase/types";

export type LiveStats = { level: number; xp: number; gold: number; streak: number };

const fromRow = (row: Pick<PlayerStats, "level" | "xp" | "gold" | "current_streak">): LiveStats => ({
  level: row.level,
  xp: row.xp,
  gold: row.gold,
  streak: row.current_streak,
});

/**
 * A player's Level / XP / Gold / Streak, kept live with Supabase Realtime
 * (player_stats is in the publication). Gold moves with boss payouts,
 * purchases and refunds, so the HUD follows along without a reload.
 * Refetches when the channel (re)connects to cover the gap after the
 * server render.
 */
export function usePlayerStats(childId: string, initial: LiveStats) {
  const [supabase] = useState(createClient);
  const [stats, setStats] = useState(initial);

  useEffect(() => {
    const refetch = async () => {
      const { data } = await supabase
        .from("player_stats")
        .select("level, xp, gold, current_streak")
        .eq("child_id", childId)
        .maybeSingle();
      if (data) setStats(fromRow(data));
    };
    const own = { schema: "public", table: "player_stats", filter: `child_id=eq.${childId}` } as const;
    const channel = supabase
      .channel(`player_stats:${childId}:hud`)
      .on("postgres_changes", { event: "INSERT", ...own }, (p) => setStats(fromRow(p.new as PlayerStats)))
      .on("postgres_changes", { event: "UPDATE", ...own }, (p) => setStats(fromRow(p.new as PlayerStats)))
      .subscribe((status) => {
        if (status === "SUBSCRIBED") void refetch();
      });
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [supabase, childId]);

  return stats;
}
