"use client";

// Pieces shared by everything that draws the battle arena: the scene, and
// the "while you were away" recap.

import { useState } from "react";
import { SPRITES } from "@/components/rpg/sprites/manifests";
import type { SpriteAnimation } from "@/components/rpg/sprites/types";
import { AnchoredSprite, needsMirror } from "@/components/rpg/sprites/anchored-sprite";
import { contactAnimation } from "@/lib/rpg/strike";
import {
  BOSS_ATTACK_IMPACT_MS,
  HURT_PEAK_FRAME,
  ROGUE_HURT_PEAK_FRAME,
  isDownPose,
  type HeroState,
  type RoguePose,
} from "@/lib/rpg/hero-stage";
import { FEET_X, FeetSpot, rogueHeight } from "./stage-layout";

const heroAnims = SPRITES.hero.animations;
const rogueAnims = SPRITES.rogue.animations;

/** The hero's poses as playable animations (stable objects: SpriteAnimator
 *  restarts when its animation changes). */
export const HERO_POSES = {
  idle: heroAnims.idle,
  // Timed so the flinch peaks as the boss's blow lands.
  hurt: contactAnimation(heroAnims.hurt, HURT_PEAK_FRAME, BOSS_ATTACK_IMPACT_MS),
  ko: heroAnims.ko,
  // Lying flat: the K.O.'s last frame, held.
  down: { ...heroAnims.ko, frames: heroAnims.ko.frames.slice(-1) },
  // Getting up: the K.O. in reverse.
  rise: { ...heroAnims.ko, frames: [...heroAnims.ko.frames].reverse() },
  victory: heroAnims.victory,
} satisfies Record<Exclude<HeroState["pose"], "attack">, SpriteAnimation>;

/** Rogue's poses, the same way (his hurt peaks on the same blow). */
export const ROGUE_POSES = {
  idle: rogueAnims.idle,
  hurt: contactAnimation(rogueAnims.hurt, ROGUE_HURT_PEAK_FRAME, BOSS_ATTACK_IMPACT_MS),
  ko: rogueAnims.ko,
  down: { ...rogueAnims.ko, frames: rogueAnims.ko.frames.slice(-1) },
  rise: { ...rogueAnims.ko, frames: [...rogueAnims.ko.frames].reverse() },
  bark: rogueAnims.bark,
} satisfies Record<RoguePose, SpriteAnimation>;

/**
 * Rogue at his spot behind the hero, in `pose` (lib/rpg/hero-stage.ts
 * roguePoseFor). `playKey` restarts the pose (the hero's pose key, so they
 * move together). A bark plays once, then he goes back to breathing.
 * Knocked out, he lies on the same ground line as the hero, drawn in front
 * of him so his paws stay visible (proper front/back depth comes with a
 * ground that has depth — see the day/night background note in CLAUDE.md).
 */
export function RogueSprite({ pose, playKey }: { pose: RoguePose; playKey: number }) {
  const [barkedAt, setBarkedAt] = useState<number | null>(null);
  const shown: RoguePose = pose === "bark" && barkedAt === playKey ? "idle" : pose;
  const anim = ROGUE_POSES[shown];
  return (
    <FeetSpot x={FEET_X.rogue} className={isDownPose(pose) ? "z-[1]" : ""}>
      <AnchoredSprite
        key={`${shown}-${playKey}`}
        animation={anim}
        height={rogueHeight(anim)}
        mirror={needsMirror(anim.facing, "right")}
        alt="Rogue the dog"
        onComplete={shown === "bark" ? () => setBarkedAt(playKey) : undefined}
      />
    </FeetSpot>
  );
}

/** Night sky with twinkling stars and drifting clouds, far and near pixel
 *  hills, then the ground strip. CSS only. */
export function ArenaBackdrop() {
  return (
    <div aria-hidden className="absolute inset-0">
      <div className="arena-sky absolute inset-0" />
      {/* Twinkling stars (two layers out of step) and slow clouds drifting
          at two speeds for parallax. Static under reduced motion. */}
      <div className="arena-stars arena-stars-a absolute inset-0" />
      <div className="arena-stars arena-stars-b absolute inset-0" />
      <div className="arena-clouds arena-clouds-far top-[6%]" />
      <div className="arena-clouds arena-clouds-near top-[24%]" />
      <div className="arena-hills-far absolute inset-x-0 bottom-(--ground) h-[38%]" />
      <div className="arena-hills-near absolute inset-x-0 bottom-(--ground) h-[24%]" />
      <div className="absolute inset-x-0 bottom-0 h-(--ground) border-t-[3px] border-[#69db7c] bg-[#2b8a3e] shadow-[inset_0_calc(var(--ground)*-0.45)_0_#5c3b1e]" />
    </div>
  );
}

