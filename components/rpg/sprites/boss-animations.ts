import { SPRITES } from "./manifests";
import type { SpriteAnimation, SpriteManifest } from "./types";
import { bossAttackAnimation } from "@/lib/rpg/strike";

/** One of a boss's stage poses (each carries its own drawn `facing`). */
export type BossPose = SpriteAnimation;

/** The animations a boss needs on stage, resolved from its manifest. */
export type BossAnimations = {
  idle: BossPose;
  hurt: BossPose;
  /** The boss's attack, played once (DORMANT since …16: kept for later seasons). */
  attack: BossPose;
  death: BossPose;
};

const cache = new Map<string, BossAnimations | null>();

/**
 * Every boss's manifest has idle / attack / hurt / death / move (PixelLab
 * sheets); missing ones fall back to idle (or hurt, for death). Returns null for an
 * unknown sprite key so the caller can show a placeholder instead of failing.
 *
 * The same objects every time for a key: SpriteAnimator restarts whenever
 * its animation object changes, so a fresh object per render would restart
 * the boss's animation on every re-render (the hit overlay re-renders a lot).
 */
export function bossAnimations(spriteKey: string): BossAnimations | null {
  if (!cache.has(spriteKey)) cache.set(spriteKey, buildBossAnimations(spriteKey));
  return cache.get(spriteKey) ?? null;
}

function buildBossAnimations(spriteKey: string): BossAnimations | null {
  const manifest = (SPRITES as Record<string, SpriteManifest>)[spriteKey];
  if (!manifest) return null;
  const a = manifest.animations;
  const idle = a.idle;
  if (!idle) return null;

  const pose = (anim: SpriteAnimation, loop: boolean): BossPose => ({ ...anim, loop });
  const oneShot = (anim: SpriteAnimation): SpriteAnimation => ({ ...anim, loop: false });
  const hurt = a.hurt ?? oneShot(idle);
  const death = a.death ?? hurt;

  return {
    idle: pose(idle, true),
    hurt: pose(hurt, false),
    // Timed to the blow when the art marks a contact frame.
    attack: a.attack ? bossAttackAnimation(a.attack) : pose(idle, false),
    death: pose(death, false),
  };
}
