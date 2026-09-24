"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef, useState } from "react";
import type { Boss, PartyHealth } from "@/lib/supabase/types";
import { createClient } from "@/lib/supabase/client";
import { useBattle } from "@/lib/hooks/use-battle";
import { initialStage, stageReducer, type StageState } from "@/lib/rpg/boss-stage";
import { createBattleEmitter, type BattleEvent, type BattleListener } from "@/lib/rpg/battle-events";

type BattleContextValue = {
  /** The database's active boss (the stage's `shown` boss can lag it). */
  boss: Boss | null;
  party: PartyHealth | null;
  stage: StageState;
  /** The boss's one-shot hurt / attack finished. */
  onBossAnimationEnd: () => void;
  /** The finished boss's defeat / escape has played out. */
  onBossFinished: () => void;
  subscribe: (listener: BattleListener) => () => void;
  /** Emit into the stream (the overlay's "moment" events). */
  emit: (event: BattleEvent) => void;
  /**
   * The hit overlay is playing (it announces the hit itself, so the scene
   * mutes its screen-reader caption meanwhile).
   */
  overlayActive: boolean;
  setOverlayActive: (active: boolean) => void;
  /**
   * The "while you were away" recap is playing: it goes before anything
   * else, so the celebration cards wait for it.
   */
  recapActive: boolean;
  setRecapActive: (active: boolean) => void;
  /** Quests still to do today (set by the quest board; null = unknown). */
  questsLeftToday: number | null;
  setQuestsLeftToday: (n: number | null) => void;
  refetch: () => Promise<void>;
};

const BattleContext = createContext<BattleContextValue | null>(null);

/**
 * One family's battle: live boss + party (Realtime), the typed event stream
 * and the boss stage machine, shared by everything inside — the battle
 * scene, its pinned strip, the parent's panel, and future listeners like the
 * hit overlay or sound effects (via useBattleEvents).
 */
export function BattleProvider({
  familyId,
  initialBoss,
  initialParty,
  recapPending = false,
  children,
}: {
  familyId: string;
  initialBoss: Boss | null;
  initialParty: PartyHealth | null;
  /** A recap will play on load: hold everything else back from the start. */
  recapPending?: boolean;
  children: React.ReactNode;
}) {
  const [emitter] = useState(createBattleEmitter);
  const live = useBattle({ familyId, initialBoss, initialParty, onEvent: emitter.emit });
  const [dev, setDev] = useState<{ boss?: Boss | null; party?: PartyHealth }>({});
  const boss = dev.boss !== undefined ? dev.boss : live.boss;
  const party = dev.party ?? live.party;

  const [stage, dispatch] = useReducer(stageReducer, initialBoss, initialStage);
  const [overlayActive, setOverlayActive] = useState(false);
  const [recapActive, setRecapActive] = useState(recapPending);
  const [questsLeftToday, setQuestsLeftToday] = useState<number | null>(null);
  // The stage machine is just another listener.
  useEffect(() => emitter.subscribe((event) => dispatch({ type: "event", event })), [emitter]);
  // The database's active boss (also covers refetches, not just events).
  useEffect(() => {
    dispatch({ type: "active", boss });
  }, [boss]);

  // Development only: drive the battle from the console / screenshot scripts
  // without touching the database. Stripped from production builds. Other
  // components (the hit overlay) add their own helpers to the same object.
  useEffect(() => {
    if (process.env.NODE_ENV !== "development") return;
    const tools = {
      emit: (event: BattleEvent) => emitter.emit(event),
      setBoss: (next: Boss | null) => setDev((d) => ({ ...d, boss: next })),
      setParty: (next: PartyHealth) => {
        setDev((d) => ({ ...d, party: next }));
        emitter.emit({ type: "party", hp: next.current_hp, max: next.max_hp });
      },
      /** Log / hook every event (e.g. to prototype sounds); returns an unsubscribe. */
      listen: (fn: BattleListener) => emitter.subscribe(fn),
      /**
       * Show one of the family's roster bosses as the active boss, at full
       * HP — by sprite_key ("trash_bag_slime") or 1-based roster position
       * (activation order: low → mid → epic). THIS TAB ONLY: nothing is
       * written, and real quest ticks still hit the database's active boss.
       * null follows the database again.
       */
      jumpToBoss: async (target: string | number | null) => {
        if (target === null) {
          setDev((d) => ({ ...d, boss: undefined }));
          return "Following the database's active boss again.";
        }
        const roster = await loadRoster(familyId);
        const i = typeof target === "number" ? target - 1 : roster.findIndex((b) => b.sprite_key === target);
        const row = roster[i];
        if (!row) {
          throw new Error(`No boss ${JSON.stringify(target)}. Roster: ${roster.map((b, n) => `${n + 1} ${b.sprite_key}`).join(", ")}`);
        }
        const boss: Boss = { ...row, status: "active", current_hp: row.max_hp };
        setDev((d) => ({ ...d, boss }));
        emitter.emit({ type: "activated", boss });
        return `${i + 1}. ${boss.name} (${boss.tier}, ${boss.max_hp} HP) — this tab only`;
      },
      /** The family's roster in activation order, with positions for jumpToBoss. */
      bosses: async () => {
        const roster = await loadRoster(familyId);
        console.table(roster.map((b, n) => ({ position: n + 1, sprite_key: b.sprite_key, name: b.name, tier: b.tier, status: b.status, hp: `${b.current_hp}/${b.max_hp}` })));
      },
    };
    return registerDevTools(tools);
  }, [emitter, familyId]);

  const onBossAnimationEnd = useCallback(() => dispatch({ type: "animation-end" }), []);
  const onBossFinished = useCallback(() => dispatch({ type: "swap" }), []);

  const value = useMemo<BattleContextValue>(
    () => ({
      boss,
      party,
      stage,
      onBossAnimationEnd,
      onBossFinished,
      subscribe: emitter.subscribe,
      emit: emitter.emit,
      overlayActive,
      setOverlayActive,
      recapActive,
      setRecapActive,
      questsLeftToday,
      setQuestsLeftToday,
      refetch: live.refetch,
    }),
    [boss, party, stage, onBossAnimationEnd, onBossFinished, emitter, overlayActive, recapActive, questsLeftToday, live.refetch],
  );

  return <BattleContext.Provider value={value}>{children}</BattleContext.Provider>;
}

export function useBattleContext() {
  const value = useContext(BattleContext);
  if (!value) throw new Error("useBattleContext must be used inside <BattleProvider>");
  return value;
}

/** The battle context, or null outside a <BattleProvider> (shared UI). */
export function useOptionalBattleContext() {
  return useContext(BattleContext);
}

/**
 * Subscribe to battle events (damage, miss, defeated, escaped, activated).
 * The listener can change between renders; the subscription doesn't.
 */
export function useBattleEvents(listener: BattleListener) {
  const { subscribe } = useBattleContext();
  const ref = useRef(listener);
  useEffect(() => {
    ref.current = listener;
  }, [listener]);
  useEffect(() => subscribe((event) => ref.current(event)), [subscribe]);
}

/**
 * Development only: merge helpers into window.__fqBattle (the console / test
 * hook). Returns a cleanup that removes them again. A no-op in production
 * builds, so no trace of the hook ships.
 */
const TIER_ORDER = { low: 1, mid: 2, epic: 3 } as const;

/** Dev only: the family's bosses in activation order (as activate_next_boss picks them). */
async function loadRoster(familyId: string): Promise<Boss[]> {
  const { data, error } = await createClient().from("bosses").select("*").eq("family_id", familyId);
  if (error) throw new Error(`Couldn't load the boss roster: ${error.message}`);
  return [...(data as Boss[])].sort(
    (a, b) =>
      TIER_ORDER[a.tier] - TIER_ORDER[b.tier] ||
      a.queue_position - b.queue_position ||
      a.created_at.localeCompare(b.created_at),
  );
}

export const registerDevTools: (tools: Record<string, unknown>) => () => void =
  process.env.NODE_ENV === "development"
    ? (tools) => {
        const w = window as unknown as { __fqBattle?: Record<string, unknown> };
        w.__fqBattle = { ...w.__fqBattle, ...tools };
        return () => {
          if (!w.__fqBattle) return;
          for (const key of Object.keys(tools)) delete w.__fqBattle[key];
          if (Object.keys(w.__fqBattle).length === 0) delete w.__fqBattle;
        };
      }
    : () => () => {};
