// Battle stage layout: where each character's FEET stand, as fixed stage
// positions. Characters are placed by their manifest anchor (feet x + ground
// line y, measured from the art by scripts/slice-sprites.mjs) via
// AnchoredSprite — never by image widths or flex gaps — so transparent
// padding in the frames can't push anyone around, and new art only needs a
// new manifest.
//
// Shared by everything that draws the battle: the scene now, the
// centre-screen hit overlay next, so positions match between them.
//
// Units: x positions are CSS lengths across the arena's width; heights and
// the Rogue offset are multiples of --arena (the arena height, set by the
// scene), so spacing scales with the characters from a phone to a desktop.

import type { Boss } from "@/lib/supabase/types";
import { bossAnimations } from "@/components/rpg/sprites/boss-animations";

/** Ground line: how far above the arena's bottom the feet stand. */
export const GROUND = 0.12;

/** Idle heights, as a share of the arena height. Epic bosses tower. */
export const HEIGHT = {
  hero: 0.56,
  rogue: 0.29,
  // Epic stops short of the arena top so tall idles (the Kraken) aren't clipped.
  boss: { low: 0.52, mid: 0.64, epic: 0.74 } satisfies Record<Boss["tier"], number>,
};

/** Widest a boss's idle pose may be, as a share of the arena width. */
export const BOSS_MAX_WIDTH = 0.46;

/** Feet x for each character, as CSS lengths from the arena's left edge. */
export const FEET_X = {
  hero: "29%",
  // Just behind the hero, about a dog-length (≈ Rogue's height) away.
  rogue: "calc(29% - var(--arena) * 0.3)",
  boss: "75%",
} as const;

/**
 * The hit overlay's strike: the party dashes in closer so the hero's swing
 * reaches the boss (the boss stays at FEET_X.boss). Rogue keeps the same
 * dog-length behind the hero.
 */
export const STRIKE_X = {
  hero: "46%",
  rogue: "calc(46% - var(--arena) * 0.3)",
} as const;

/**
 * Inline style for an arena container: its height (--arena) and ground line
 * (--ground). The arena must sit inside a `container-type: inline-size`
 * element, which the cqw sizing refers to.
 */
export const ARENA_STYLE = {
  "--arena": "min(270px, 58cqw)",
  "--ground": `calc(var(--arena) * ${GROUND})`,
  height: "var(--arena)",
} as React.CSSProperties;

/** A share of the arena height as a CSS length. */
export const arenaHeight = (share: number) => `calc(var(--arena) * ${share})`;

/** A boss's idle display height as a CSS length (tier size, capped by width). */
export function bossHeight(boss: Boss) {
  const idle = bossAnimations(boss.sprite_key)?.idle;
  const aspect = idle ? idle.width / idle.height : 1;
  return `min(${arenaHeight(HEIGHT.boss[boss.tier])}, ${((BOSS_MAX_WIDTH * 100) / aspect).toFixed(2)}cqw)`;
}

/**
 * A zero-width marker at a feet x (FEET_X), spanning from the ground line up.
 * Children that stand at "bottom centre" — AnchoredSprite, BossSprite, the
 * aura — land with their anchor exactly on that spot.
 */
export function FeetSpot({ x, className = "", children }: { x: string; className?: string; children: React.ReactNode }) {
  return (
    <div className={`absolute inset-y-0 w-0 ${className}`} style={{ left: x }}>
      {children}
    </div>
  );
}

/**
 * Where a hit lands: the boss's leading (left) edge, from its idle pose's
 * proportions — as a CSS length across the arena, plus a height share.
 */
export function impactPoint(boss: Boss) {
  const idle = bossAnimations(boss.sprite_key)?.idle;
  const aspect = idle ? idle.width / idle.height : 1;
  return { x: `calc(${FEET_X.boss} - ${bossHeight(boss)} * ${(aspect * 0.32).toFixed(3)})`, y: 0.42 };
}
