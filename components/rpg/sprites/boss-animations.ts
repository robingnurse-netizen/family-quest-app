import { SPRITES } from "./manifests";
import type { SpriteAnimation, SpriteManifest } from "./types";

/** One of a boss's stage poses (each carries its own drawn `facing`). */
export type BossPose = SpriteAnimation;

/** The animations a boss needs on stage, resolved from its manifest. */
export type BossAnimations = {
  idle: BossPose;
  hurt: BossPose;
  /** Played once when a missed quest lets the boss hit the party. */
  attack: BossPose;
  death: BossPose;
  /** Played (looping, while sliding off) when the boss escapes. */
  escape: BossPose;
};

// Epic sheets combine hurt and defeat in one strip ("HURT/DEFEATED"); its
// first frames are the flinch.
const EPIC_HURT_FRAMES = 3;

/**
 * Low-tier bosses have their own hurt/death strips (often a single frame);
 * epic bosses derive hurt from the start of `defeated`. Returns null for an
 * unknown sprite key so the caller can show a placeholder instead of failing.
 */
export function bossAnimations(spriteKey: string): BossAnimations | null {
  const manifest = (SPRITES as Record<string, SpriteManifest>)[spriteKey];
  if (!manifest) return null;
  const a = manifest.animations;
  const idle = a.idle;
  if (!idle) return null;

  const pose = (anim: SpriteAnimation, loop: boolean): BossPose => ({ ...anim, loop });
  const oneShot = (anim: SpriteAnimation): SpriteAnimation => ({ ...anim, loop: false });
  const defeated = a.defeated;
  const hurt =
    a.hurt ??
    (defeated
      ? { ...defeated, frames: defeated.frames.slice(0, EPIC_HURT_FRAMES), loop: false }
      : oneShot(idle));
  const death = a.death ?? defeated ?? hurt;

  return {
    idle: pose(idle, true),
    hurt: pose(hurt, false),
    attack: pose(a.attack ?? idle, false),
    death: pose(death, false),
    escape: pose(a.move ?? idle, true),
  };
}
