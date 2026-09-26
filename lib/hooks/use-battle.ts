"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Boss, BossLog } from "@/lib/supabase/types";
import { eventFromLog, type BattleEvent } from "@/lib/rpg/battle-events";

/**
 * The family's active boss, kept live with Supabase Realtime. When a boss is
 * defeated and the next one activated, both updates arrive; whichever order
 * they come in, the active one wins.
 *
 * `onEvent` receives the typed battle events (lib/rpg/battle-events.ts):
 * damage / raid / gold from boss_log inserts, defeated from boss rows
 * (Realtime only), and activated whenever a different boss becomes the
 * active one — whether that arrives over Realtime or via a refetch. (Party
 * HP is gone since …16: party_health / party_log are dormant.)
 */
export function useBattle({
  familyId,
  initialBoss,
  onEvent,
}: {
  familyId: string;
  initialBoss: Boss | null;
  onEvent?: (event: BattleEvent) => void;
}) {
  const [supabase] = useState(createClient);
  const [boss, setBoss] = useState(initialBoss);
  const onEventRef = useRef(onEvent);
  useEffect(() => {
    onEventRef.current = onEvent;
  }, [onEvent]);
  // The active boss id we last reported, so "activated" fires once per boss
  // (and not for the one the page loaded with).
  const activeIdRef = useRef(initialBoss?.id ?? null);
  const adoptActive = useCallback((next: Boss | null) => {
    const id = next?.id ?? null;
    if (id === activeIdRef.current) return;
    activeIdRef.current = id;
    if (next) onEventRef.current?.({ type: "activated", boss: next });
  }, []);

  const refetch = useCallback(async () => {
    const b = await supabase
      .from("bosses")
      .select("*")
      .eq("family_id", familyId)
      .eq("status", "active")
      .maybeSingle();
    if (!b.error) {
      setBoss(b.data);
      adoptActive(b.data);
    }
  }, [supabase, familyId, adoptActive]);

  useEffect(() => {
    const onBoss = (row: Boss) => {
      if (row.status === "defeated") {
        onEventRef.current?.({ type: "defeated", boss: row });
        if (activeIdRef.current === row.id) activeIdRef.current = null;
      }
      if (row.status === "active") adoptActive(row);
      setBoss((current) => {
        if (row.status === "active") return row;
        // The current boss is no longer active (defeated); the next one (if
        // any) arrives in its own event.
        return current?.id === row.id ? null : current;
      });
    };

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
      // boss_log has no family_id; RLS scopes Realtime to this family's bosses.
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "boss_log" }, (p) => {
        const event = eventFromLog(p.new as BossLog);
        if (event) onEventRef.current?.(event);
      })
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
  }, [supabase, familyId, refetch, adoptActive]);

  return { boss, refetch };
}
