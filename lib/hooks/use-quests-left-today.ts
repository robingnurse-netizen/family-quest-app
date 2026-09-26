"use client";

import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { todayKey } from "@/lib/calendar/dates";
import { countQuestsLeft } from "@/lib/backlog/quests-left";

/**
 * How many of his quests are still to do today (family time), kept live:
 * refetched whenever a task slot changes (Realtime; RLS scopes it to the
 * family), when the channel (re)connects, and when the date rolls over
 * (re-checked every minute). Independent of which week the quest board is
 * showing. null = not known yet. `initial` is the server's count for
 * `initialToday`, so the first render needn't wait for a fetch.
 */
export function useQuestsLeftToday({
  familyId,
  childId,
  timeZone,
  initialToday,
  initial,
}: {
  familyId: string;
  childId: string;
  timeZone: string;
  initialToday: string;
  initial: number | null;
}): number | null {
  const [supabase] = useState(createClient);
  const [today, setToday] = useState(initialToday);
  useEffect(() => {
    const check = () => setToday(todayKey(timeZone));
    check();
    const t = setInterval(check, 60_000);
    return () => clearInterval(t);
  }, [timeZone]);

  const [counted, setCounted] = useState<{ day: string; n: number | null }>({ day: initialToday, n: initial });
  // Only the newest fetch may land (a slow one can't overwrite a newer count).
  const seq = useRef(0);

  useEffect(() => {
    const refetch = () => {
      const mine = ++seq.current;
      void countQuestsLeft(supabase, familyId, childId, today).then((n) => {
        if (mine === seq.current && n !== null) setCounted({ day: today, n });
      });
    };
    const channel = supabase
      .channel(`quests_left:${childId}:${today}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "task_slots" }, refetch)
      .subscribe((status) => {
        if (status === "SUBSCRIBED") refetch();
      });
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [supabase, familyId, childId, today]);

  // Yesterday's count says nothing about today: unknown until refetched.
  return counted.day === today ? counted.n : null;
}
