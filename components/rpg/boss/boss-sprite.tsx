"use client";

import { useEffect, useMemo, useRef } from "react";
import { AnchoredSprite, needsMirror } from "@/components/rpg/sprites/anchored-sprite";
import { bossAnimations } from "@/components/rpg/sprites/boss-animations";
import type { StageMode } from "@/lib/rpg/boss-stage";

const DEFEAT_HOLD_MS = 1200; // last death frame stays up this long
const ESCAPE_MS = 1400; // matches the .boss-escape CSS animation

/**
 * One boss on stage, reacting to the stage mode:
 *   idle     → idle loop
 *   hurt     → hurt animation once (+ shake/red flash), then onReactionDone
 *   attack   → attack animation once (a missed quest), then onReactionDone
 *   defeated → death animation once, hold, then onFinishDone
 *   escaped  → move loop while sliding off, then onFinishDone
 * Single-frame strips just show their still frame; the CSS effect makes the
 * reaction visible either way. `playKey` restarts the animation (and the CSS
 * effect) on every event.
 *
 * `height` is the idle pose's display height as any CSS length; other poses
 * scale with it so the boss doesn't resize between animations. `face` turns
 * side-facing poses that way (escaping, it faces the way it runs: off to the
 * right, away from the hero); omit it to show poses as drawn.
 */
export function BossSprite({
  spriteKey,
  name,
  mode,
  playKey,
  height,
  face,
  onReactionDone,
  onFinishDone,
}: {
  spriteKey: string;
  name: string;
  mode: StageMode;
  playKey: number;
  height: number | string;
  face?: "left" | "right";
  onReactionDone: () => void;
  onFinishDone: () => void;
}) {
  const anims = useMemo(() => bossAnimations(spriteKey), [spriteKey]);
  const holdTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(holdTimer.current), [playKey]);
  const idleHeight = typeof height === "number" ? `${height}px` : height;

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
        className={`absolute bottom-0 left-1/2 flex aspect-square -translate-x-1/2 items-center justify-center rounded-xl border-2 border-dashed border-current text-3xl font-black opacity-70 boss-fx-${mode}`}
        style={{ height: idleHeight }}
        title={`No sprite for "${spriteKey}"`}
      >
        ?
      </div>
    );
  }

  const anim =
    mode === "hurt"
      ? anims.hurt
      : mode === "attack"
        ? anims.attack
        : mode === "defeated"
          ? anims.death
          : mode === "escaped"
            ? anims.escape
            : anims.idle;
  const want = mode === "escaped" && face ? (face === "left" ? "right" : "left") : face;

  const onComplete =
    mode === "hurt" || mode === "attack"
      ? onReactionDone
      : mode === "defeated"
        ? () => {
            holdTimer.current = setTimeout(onFinishDone, DEFEAT_HOLD_MS);
          }
        : undefined;

  return (
    <AnchoredSprite
      key={`${mode}-${playKey}`}
      animation={anim}
      // One scale per boss (from idle) so it doesn't resize between poses.
      height={`calc(${idleHeight} * ${anim.height / anims.idle.height})`}
      mirror={needsMirror(anim.facing, want)}
      alt={name}
      className={`boss-fx-${mode}`}
      onComplete={onComplete}
    />
  );
}
