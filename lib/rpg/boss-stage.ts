// Boss stage state machine: which boss is on screen and what it's doing.
//
// The active boss (from the database) and the boss on stage can differ for a
// moment: when a boss is defeated, the same transaction also activates the
// next one, and all those Realtime events arrive together. The stage keeps
// showing the finished boss until its death animation and hold are over,
// then swaps in whoever is active by then. A boss never escapes (…16).
//
// Pure (no React) so the event sequences can be tested directly.

import type { Boss } from "@/lib/supabase/types";
import type { BattleEvent } from "./battle-events";

/**
 * What the boss on stage is doing: hurt (a quest or a Night Raid struck it),
 * attack (DORMANT since …16 — only the dev hurt() preview sends a "miss"),
 * or playing out its defeat.
 */
export type StageMode = "idle" | "hurt" | "attack" | "defeated";

export type StageState = {
  /** The boss drawn on stage (drives sprite, name and HP bar). */
  shown: Boss | null;
  /** The latest active boss from the database. */
  active: Boss | null;
  /** Latest known row per boss id. */
  rows: Record<string, Boss>;
  mode: StageMode;
  /** Bumped whenever an animation must restart from frame 1. */
  playKey: number;
  /** Plain-language line describing the last event (the scene's banner). */
  caption: string | null;
};

export type StageAction =
  /** The database's active boss (also refreshes HP). */
  | { type: "active"; boss: Boss | null }
  | { type: "event"; event: BattleEvent }
  /** The boss's one-shot hurt / attack animation finished. */
  | { type: "animation-end" }
  /** The finished boss's defeat has played out. */
  | { type: "swap" };

export function initialStage(active: Boss | null): StageState {
  return {
    shown: active,
    active,
    rows: active ? { [active.id]: active } : {},
    mode: "idle",
    playKey: 0,
    caption: null,
  };
}

const finishing = (mode: StageMode) => mode === "defeated";

function finish(state: StageState): StageState {
  const name = state.shown?.name ?? "The boss";
  return {
    ...state,
    mode: "defeated",
    playKey: state.playKey + 1,
    caption: `${name} has fallen!`,
  };
}

export function stageReducer(state: StageState, action: StageAction): StageState {
  switch (action.type) {
    case "active": {
      const boss = action.boss;
      const rows = boss ? { ...state.rows, [boss.id]: boss } : state.rows;
      const next = { ...state, active: boss, rows };
      // Nothing on stage yet: show the new boss straight away.
      if (!state.shown) {
        return boss ? { ...next, shown: boss, mode: "idle", playKey: state.playKey + 1 } : next;
      }
      // Same boss, new numbers (HP).
      if (boss && boss.id === state.shown.id) {
        return { ...next, shown: boss };
      }
      // A different boss (or none) is active: the one on stage is beaten
      // (its own status update normally arrived first).
      return finishing(state.mode) ? next : finish(next);
    }

    case "event": {
      const { event } = action;
      if (event.type === "defeated") {
        const row = event.boss;
        const next = { ...state, rows: { ...state.rows, [row.id]: row } };
        if (!state.shown || row.id !== state.shown.id) return next;
        const withRow = { ...next, shown: row };
        return finishing(state.mode) ? withRow : finish(withRow);
      }
      if (event.type === "damage" || event.type === "raid" || event.type === "miss") {
        if (!state.shown || event.bossId !== state.shown.id || finishing(state.mode)) return state;
        const name = state.shown.name;
        if (event.type === "miss") {
          // DORMANT (…16): kept for later seasons; only the dev preview sends it.
          return { ...state, mode: "attack", playKey: state.playKey + 1, caption: `${name} attacks!` };
        }
        return {
          ...state,
          mode: "hurt",
          playKey: state.playKey + 1,
          // PLACEHOLDER COPY (the raid line).
          caption: event.type === "raid" ? `Rogue's Night Raid! ${name} takes ${event.amount} damage!` : `${name} takes ${event.amount} damage!`,
        };
      }
      // "activated" arrives with the matching "active" action, which does the work.
      return state;
    }

    case "animation-end":
      // Hurt / attack return to idle; a defeat waits for "swap" (after a hold).
      return state.mode === "hurt" || state.mode === "attack"
        ? { ...state, mode: "idle", playKey: state.playKey + 1 }
        : state;

    case "swap": {
      if (!finishing(state.mode)) return state;
      const incoming = state.active;
      return {
        ...state,
        shown: incoming,
        mode: "idle",
        playKey: state.playKey + 1,
        caption: incoming ? `${incoming.name} has entered the arena!` : "Every boss in the realm has fallen!",
      };
    }
  }
}
