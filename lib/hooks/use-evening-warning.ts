"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { TonightStakes } from "@/lib/supabase/types";
import { eveningWarning, isEvening } from "@/lib/rpg/evening";

/**
 * The evening warning for the battle scene: is it evening in the family's
 * timezone (re-checked every minute), and what tonight's reset would deal
 * (tonight_stakes(), refetched whenever his quests left or the boss change).
 * Returns the warning line, or null. Development overrides: `force` sets
 * evening on / off (null follows the clock) and `devStakes` stands in for
 * the database's stakes.
 */
export function useEveningWarning({
  timeZone,
  bossId,
  questsLeftToday,
  streak,
  force,
  devStakes = null,
}: {
  timeZone: string;
  bossId: string | null;
  questsLeftToday: number | null;
  streak: number;
  force: boolean | null;
  devStakes?: TonightStakes | null;
}) {
  const [clockEvening, setClockEvening] = useState(false);
  useEffect(() => {
    const check = () => setClockEvening(isEvening(new Date(), timeZone));
    check();
    const t = setInterval(check, 60_000);
    return () => clearInterval(t);
  }, [timeZone]);
  const evening = force ?? clockEvening;

  const [stakes, setStakes] = useState<TonightStakes | null>(null);
  const [supabase] = useState(createClient);
  useEffect(() => {
    if (!evening) return;
    let cancelled = false;
    void supabase.rpc("tonight_stakes").then(({ data }) => {
      if (!cancelled) setStakes(data ?? null);
    });
    return () => {
      cancelled = true;
    };
  }, [supabase, evening, bossId, questsLeftToday]);

  return { evening, line: eveningWarning(evening, devStakes ?? stakes, streak) };
}
