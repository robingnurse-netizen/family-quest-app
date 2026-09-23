"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef, useState } from "react";
import type { Boss, PartyHealth } from "@/lib/supabase/types";
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
  children,
}: {
  familyId: string;
  initialBoss: Boss | null;
  initialParty: PartyHealth | null;
  children: React.ReactNode;
}) {
  const [emitter] = useState(createBattleEmitter);
  const live = useBattle({ familyId, initialBoss, initialParty, onEvent: emitter.emit });
  const [dev, setDev] = useState<{ boss?: Boss | null; party?: PartyHealth }>({});
  const boss = dev.boss !== undefined ? dev.boss : live.boss;
  const party = dev.party ?? live.party;

  const [stage, dispatch] = useReducer(stageReducer, initialBoss, initialStage);
  // The stage machine is just another listener.
  useEffect(() => emitter.subscribe((event) => dispatch({ type: "event", event })), [emitter]);
  // The database's active boss (also covers refetches, not just events).
  useEffect(() => {
    dispatch({ type: "active", boss });
  }, [boss]);

  // Development only: drive the battle from the console / screenshot scripts
  // without touching the database. Stripped from production builds.
  useEffect(() => {
    if (process.env.NODE_ENV !== "development") return;
    const w = window as unknown as { __fqBattle?: unknown };
    w.__fqBattle = {
      emit: (event: BattleEvent) => emitter.emit(event),
      setBoss: (next: Boss | null) => setDev((d) => ({ ...d, boss: next })),
      setParty: (next: PartyHealth) => setDev((d) => ({ ...d, party: next })),
    };
    return () => {
      delete w.__fqBattle;
    };
  }, [emitter]);

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
      refetch: live.refetch,
    }),
    [boss, party, stage, onBossAnimationEnd, onBossFinished, emitter, live.refetch],
  );

  return <BattleContext.Provider value={value}>{children}</BattleContext.Provider>;
}

export function useBattleContext() {
  const value = useContext(BattleContext);
  if (!value) throw new Error("useBattleContext must be used inside <BattleProvider>");
  return value;
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
