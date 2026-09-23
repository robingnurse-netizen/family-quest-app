// Hit overlay choreography: how hard a hit lands (tiers by quest length) and
// which of the hero's swings plays (attack variants). Pure data + maths — the
// overlay (components/rpg/battle/hit-overlay.tsx) renders it; tests/
// strike.test.mjs checks it. No React / browser imports.

import type { SpriteAnimation } from "@/components/rpg/sprites/types";

// --- Hit weight -----------------------------------------------------------------

export type HitTier = "light" | "medium" | "heavy";

/**
 * A hit's tier from the quest's minutes (a damage event's amount: 1 minute =
 * 1 damage, the same duration_minutes behind damage and XP). Reuben's
 * quests are mostly 15 / 30 / 60 minutes, so those land in one tier each.
 */
export const HIT_TIER_MAX_MINUTES = { light: 15, medium: 44 } as const;

export function hitTier(minutes: number): HitTier {
  if (minutes <= HIT_TIER_MAX_MINUTES.light) return "light";
  if (minutes <= HIT_TIER_MAX_MINUTES.medium) return "medium";
  return "heavy";
}

export type HitTierStyle = {
  /** Hit-stop freeze on contact (ms). The overlay's later beats (and their
   *  sounds) are timed from OVERLAY_TIMING.hitStop, not this, so a heavier
   *  pause never delays the show or the next quick tick. */
  hitStopMs: number;
  /** Layer shake distance (px); combos add a little on top. */
  shake: number;
  /** Starburst size multiplier. */
  burstScale: number;
  /** Debris chunks thrown (of the overlay's set) and how far. */
  debris: number;
  debrisSpread: number;
  /** Peak opacity of a brief white screen flash on contact (0 = none). */
  flash: number;
};

/** Deliberately close together: heavier reads as weightier, not slower. */
export const HIT_TIERS: Record<HitTier, HitTierStyle> = {
  light: { hitStopMs: 100, shake: 6, burstScale: 0.8, debris: 4, debrisSpread: 0.85, flash: 0 },
  medium: { hitStopMs: 150, shake: 9, burstScale: 1, debris: 6, debrisSpread: 1, flash: 0.12 },
  heavy: { hitStopMs: 200, shake: 12, burstScale: 1.2, debris: 6, debrisSpread: 1.3, flash: 0.28 },
};

// --- Attack variants ------------------------------------------------------------

/**
 * One of the hero's swings, cut from the frames of his `attack` animation
 * (the sheet has one attack row; the other rows have no sword). Frame
 * indices are into that animation's frames: 0 ready (sword forward),
 * 1 overhead wind-up, 2 back-swing behind the head, 3 raised, 4 chop down.
 * Every frame shares the attack canvas and feet anchor, so any cut stands
 * on the same spot.
 */
export type StrikeVariant = {
  name: string;
  frames: number[];
  /** Position in `frames` of the frame that meets the boss (on screen at impact). */
  contact: number;
  /** Body motion under the swing (first hit only: combo hits land at once). */
  motion: "none" | "lunge" | "leap";
};

export const STRIKE_VARIANTS: StrikeVariant[] = [
  { name: "overhead chop", frames: [0, 1, 4], contact: 2, motion: "none" },
  { name: "lunging thrust", frames: [1, 2, 0], contact: 2, motion: "lunge" },
  { name: "leaping chop", frames: [2, 3, 4], contact: 2, motion: "leap" },
];

/**
 * The variant as a playable animation whose contact frame is the one on
 * screen `leadMs` after it starts (the impact: the dash for a first hit, 0
 * for a combo hit). Wind-up frames that don't fit are dropped from the
 * front; a long lead holds the first frame. Canvas and anchor come from the
 * manifest's attack animation unchanged.
 */
export function strikeAnimation(attack: SpriteAnimation, variant: StrikeVariant, leadMs: number): SpriteAnimation {
  const frameMs = 1000 / attack.fps;
  const before = Math.max(0, Math.floor(leadMs / frameMs));
  const windUp = variant.frames.slice(0, variant.contact);
  const lead =
    windUp.length >= before
      ? windUp.slice(windUp.length - before)
      : [...Array(before - windUp.length).fill(windUp[0] ?? variant.frames[variant.contact]), ...windUp];
  const sequence = [...lead, ...variant.frames.slice(variant.contact)];
  return { ...attack, frames: sequence.map((i) => attack.frames[i]), loop: false };
}

/** Motion needs a run-up: below this lead (combo hits) the hero just swings. */
export const MOTION_MIN_LEAD_MS = 150;

export type StrikeMotion = { keyframes: Keyframe[]; duration: number };

/**
 * Web Animations keyframes (CSS `translate`, px) for a variant's body motion,
 * landing on contact at `leadMs`. `size` is the stage height in px (the
 * hero's feet spot), so distances scale with the arena. Null: stand still.
 */
export function strikeMotion(
  motion: StrikeVariant["motion"],
  leadMs: number,
  hitStopMs: number,
  size: number,
): StrikeMotion | null {
  if (motion === "none" || leadMs < MOTION_MIN_LEAD_MS) return null;
  const px = (share: number) => `${Math.round(share * size)}px`;
  if (motion === "leap") {
    // Up during the dash, back on the ground exactly at contact.
    return {
      duration: leadMs,
      keyframes: [
        { translate: "0 0", easing: "cubic-bezier(0.2, 0.8, 0.4, 1)" },
        { translate: `0 -${px(0.16)}`, offset: 0.55, easing: "cubic-bezier(0.6, 0, 0.9, 0.4)" },
        { translate: "0 0" },
      ],
    };
  }
  // Lunge: a small draw back, drive forward into contact, hold through the
  // hit-stop, then settle back.
  const duration = leadMs + hitStopMs + 220;
  const contact = leadMs / duration;
  return {
    duration,
    keyframes: [
      { translate: "0 0" },
      { translate: `-${px(0.03)} 0`, offset: contact * 0.5 },
      { translate: `${px(0.09)} 0`, offset: contact },
      { translate: `${px(0.09)} 0`, offset: (leadMs + hitStopMs) / duration },
      { translate: "0 0" },
    ],
  };
}
