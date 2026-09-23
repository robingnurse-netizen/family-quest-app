"use client";

import { useEffect, useMemo, useRef } from "react";
import { SpriteAnimator } from "@/components/rpg/sprites/SpriteAnimator";
import { bossAnimations } from "@/components/rpg/sprites/boss-animations";
import type { StageMode } from "@/lib/rpg/boss-stage";

const DEFEAT_HOLD_MS = 1200; // last death frame stays up this long
const ESCAPE_MS = 1400; // matches the .boss-escape CSS animation

/**
 * One boss on stage, reacting to the stage mode:
 *   idle     → idle loop
 *   hurt     → hurt animation once (+ shake/red flash), then onHurtDone
 *   defeated → death animation once, hold, then onFinishDone
 *   escaped  → move loop while sliding off stage, then onFinishDone
 * Single-frame hurt/death strips just show their still frame; the CSS
 * flash/shake makes the reaction visible either way. `playKey` restarts the
 * animation (and the CSS effect) on every event.
 */
export function BossSprite({
  spriteKey,
  name,
  mode,
  playKey,
  height,
  onHurtDone,
  onFinishDone,
}: {
  spriteKey: string;
  name: string;
  mode: StageMode;
  playKey: number;
  /** Display height of the idle pose, in CSS px. */
  height: number;
  onHurtDone: () => void;
  onFinishDone: () => void;
}) {
  const anims = useMemo(() => bossAnimations(spriteKey), [spriteKey]);
  const holdTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(holdTimer.current), [playKey]);

  // Escape has no natural end (it loops while sliding away): time it.
  useEffect(() => {
    if (mode !== "escaped") return;
    const t = setTimeout(onFinishDone, ESCAPE_MS);
    return () => clearTimeout(t);
  }, [mode, playKey, onFinishDone]);

  if (!anims) {
    // Unknown sprite_key: still show *something* reacting.
    return (
      <div
        key={`${mode}-${playKey}`}
        className={`flex items-center justify-center rounded-xl border-2 border-dashed border-current text-3xl font-black opacity-70 boss-fx-${mode}`}
        style={{ width: height, height }}
        title={`No sprite for "${spriteKey}"`}
      >
        ?
      </div>
    );
  }

  const anim =
    mode === "hurt" ? anims.hurt : mode === "defeated" ? anims.death : mode === "escaped" ? anims.escape : anims.idle;
  // One scale per boss (from idle) so it doesn't resize between animations.
  const scale = height / anims.idle.height;

  const onComplete =
    mode === "hurt"
      ? onHurtDone
      : mode === "defeated"
        ? () => {
            holdTimer.current = setTimeout(onFinishDone, DEFEAT_HOLD_MS);
          }
        : undefined;

  return (
    // Feet on the stage's ground line, horizontally centred on the anchor.
    <div
      key={`${mode}-${playKey}`}
      className={`absolute bottom-0 boss-fx-${mode}`}
      style={{
        left: `calc(50% - ${anim.anchor.x * scale}px)`,
        transform: `translateY(${(anim.height - 1 - anim.anchor.y) * scale}px)`,
      }}
    >
      <SpriteAnimator animation={anim} scale={scale} alt={name} onComplete={onComplete} />
    </div>
  );
}
