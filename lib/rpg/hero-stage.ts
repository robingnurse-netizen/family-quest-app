// Hero pose state machine: what the hero in the battle scene is doing.
//
// Driven by the battle event stream (damage, miss, defeated, party) plus
// "end" when a one-shot animation finishes and "swap" when the next boss
// takes the stage. Reactions queue behind the one playing, so a missed
// quest that empties the party still shows the flinch before he falls.
//
// Pure (no React) so the sequences can be tested (tests/hero-stage.test.mjs).

import type { BattleEvent } from "./battle-events";

/**
 * When a boss's attack connects, in ms after the miss event: the peak of the
 * boss's lunge (.boss-fx-attack in app/globals.css: 600ms, furthest at 35%).
 * The hero's flinch peak, red flash and shove land on it, and the
 * party-damage sound (components/rpg/battle/battle-sounds.tsx).
 */
export const BOSS_ATTACK_IMPACT_MS = 210;

/** The hurt animation's flinch peak (hero manifest `hurt`, sheet frame 5). */
export const HURT_PEAK_FRAME = 5;

/** Knocked out, he stays down at least this long before standing back up. */
export const DOWN_HOLD_MS = 1500;

/**
 *   idle    → idle loop
 *   attack  → one of his attacks (a quest struck the boss)
 *   hurt    → flinch (a missed quest: the boss hits the party)
 *   ko      → knocked out: falls onto his face (party HP reached 0)
 *   down    → lying flat, holding the last K.O. frame
 *   rise    → the K.O. in reverse (the party refilled)
 *   victory → victory pose, holding its last frame until the next boss
 */
export type HeroPose = "idle" | "attack" | "hurt" | "ko" | "down" | "rise" | "victory";

export type HeroState = {
  pose: HeroPose;
  /** Bumped whenever the pose's animation must restart from frame 1. */
  key: number;
  /** Which attack (index into STRIKE_VARIANTS) the current attack plays. */
  variant: number;
  /** Party HP as last seen (null: unknown). */
  partyHp: number | null;
  /** Queued behind the reaction playing: fall down / cheer. */
  pendingKo: boolean;
  pendingVictory: boolean;
  /** The party refilled while he was falling or down: stand up after the hold. */
  pendingRise: boolean;
};

export type HeroAction =
  /** A battle event; `variant` picks the attack for a damage event. */
  | { type: "event"; event: BattleEvent; variant?: number }
  /** The pose's one-shot animation finished. */
  | { type: "end" }
  /** Down long enough and the party's refilled: stand up (the scene
   *  schedules it DOWN_HOLD_MS after both are true). */
  | { type: "rise" }
  /** A different boss took the stage (or none is left). */
  | { type: "swap" }
  /** Development only: play a pose on demand. */
  | { type: "play"; pose: HeroPose; variant?: number };

export function initialHero(partyHp: number | null): HeroState {
  return {
    pose: partyHp === 0 ? "down" : "idle",
    key: 0,
    variant: 0,
    partyHp,
    pendingKo: false,
    pendingVictory: false,
    pendingRise: false,
  };
}

/** Out of the fight: knocked out, lying down or getting up. */
const downed = (pose: HeroPose) => pose === "ko" || pose === "down" || pose === "rise";
/** Short reactions that finish before anything queued plays. */
const reacting = (pose: HeroPose) => pose === "attack" || pose === "hurt";

const play = (state: HeroState, pose: HeroPose, extra: Partial<HeroState> = {}): HeroState => ({
  ...state,
  ...extra,
  pose,
  key: state.key + 1,
});

export function heroReducer(state: HeroState, action: HeroAction): HeroState {
  switch (action.type) {
    case "event": {
      const { event } = action;
      switch (event.type) {
        case "damage":
          return downed(state.pose) ? state : play(state, "attack", { variant: action.variant ?? 0 });
        case "miss":
          return downed(state.pose) ? state : play(state, "hurt");
        case "defeated":
          if (downed(state.pose)) return state;
          return reacting(state.pose) ? { ...state, pendingVictory: true } : play(state, "victory");
        case "party": {
          const was = state.partyHp;
          const next = { ...state, partyHp: event.hp };
          if (event.hp === 0 && was !== 0) {
            if (downed(state.pose)) return next;
            return reacting(state.pose) ? { ...next, pendingKo: true } : play(next, "ko", { pendingVictory: false });
          }
          if (event.hp > 0 && was === 0) {
            if (state.pose === "down") return { ...next, pendingRise: true };
            if (state.pose === "ko" || state.pendingKo) return { ...next, pendingRise: true };
          }
          return next;
        }
        default:
          return state;
      }
    }

    case "end":
      switch (state.pose) {
        case "attack":
        case "hurt":
          if (state.pendingKo) return play(state, "ko", { pendingKo: false, pendingVictory: false });
          if (state.pendingVictory) return play(state, "victory", { pendingVictory: false });
          return play(state, "idle");
        case "ko":
          // Same animation, held on its last frame: no restart.
          return { ...state, pose: "down" };
        case "rise":
          return play(state, "idle");
        default:
          return state;
      }

    case "rise":
      return state.pose === "down" && state.pendingRise ? play(state, "rise", { pendingRise: false }) : state;

    case "swap":
      return state.pose === "victory" ? play(state, "idle") : { ...state, pendingVictory: false };

    case "play":
      return play(state, action.pose, {
        variant: action.variant ?? state.variant,
        pendingKo: false,
        pendingVictory: false,
        pendingRise: false,
      });
  }
}
