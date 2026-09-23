"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Boss, PartyHealth } from "@/lib/supabase/types";

/**
 * The family's active boss + party health, kept live with Supabase Realtime.
 * When a boss is defeated and the next one activated, both updates arrive;
 * whichever order they come in, the active one wins.
 */
export function useBattle({
  familyId,
  initialBoss,
  initialParty,
}: {
  familyId: string;
  initialBoss: Boss | null;
  initialParty: PartyHealth | null;
}) {
  const [supabase] = useState(createClient);
  const [boss, setBoss] = useState(initialBoss);
  const [party, setParty] = useState(initialParty);

  const refetch = useCallback(async () => {
    const [b, p] = await Promise.all([
      supabase
        .from("bosses")
        .select("*")
        .eq("family_id", familyId)
        .eq("status", "active")
        .maybeSingle(),
      supabase.from("party_health").select("*").eq("family_id", familyId).maybeSingle(),
    ]);
    if (!b.error) setBoss(b.data);
    if (!p.error && p.data) setParty(p.data);
  }, [supabase, familyId]);

  useEffect(() => {
    const onBoss = (row: Boss) =>
      setBoss((current) => {
        if (row.status === "active") return row;
        // The current boss was defeated/escaped; the next one (if any) arrives
        // in its own event.
        return current?.id === row.id ? null : current;
      });

    const channel = supabase
      .channel(`battle:${familyId}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "bosses", filter: `family_id=eq.${familyId}` },
        (p) => onBoss(p.new as Boss),
      )
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "bosses", filter: `family_id=eq.${familyId}` },
        (p) => onBoss(p.new as Boss),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "party_health", filter: `family_id=eq.${familyId}` },
        (p) => {
          if (p.eventType !== "DELETE") setParty(p.new as PartyHealth);
        },
      )
      .subscribe((status, err) => {
        if (status === "SUBSCRIBED") void refetch();
        // Surface failures instead of silently showing stale HP (e.g. the
        // table isn't in the supabase_realtime publication).
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          console.warn(`Realtime battle channel ${status}`, err ?? "");
        }
      });

    // Safety net: a tablet waking from sleep may have missed the nightly
    // reset while its socket was down.
    const onVisible = () => {
      if (document.visibilityState === "visible") void refetch();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      void supabase.removeChannel(channel);
    };
  }, [supabase, familyId, refetch]);

  return { boss, party, refetch };
}
