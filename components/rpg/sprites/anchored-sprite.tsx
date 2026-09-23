"use client";

import { SpriteAnimator } from "./SpriteAnimator";
import type { Facing, SpriteAnimation } from "./types";

/**
 * Should a pose drawn facing `drawn` be mirrored to face `want`? Front-facing
 * poses (and callers that don't care which way things face) never mirror.
 */
export function needsMirror(drawn: Facing, want: "left" | "right" | undefined) {
  return want !== undefined && drawn !== "front" && drawn !== want;
}

/**
 * A sprite standing on the ground line of its (relatively positioned)
 * parent: the animation's anchor — the character's feet — sits at the
 * parent's bottom centre. Offsets are percentages of the sprite's own box, so
 * `height` can be any CSS length (px, container units, calc) and the anchor
 * still lines up. `mirror` flips it horizontally around its feet.
 */
export function AnchoredSprite({
  animation,
  height,
  mirror = false,
  alt,
  className = "",
  onComplete,
}: {
  animation: SpriteAnimation;
  /** CSS height of this animation's full canvas. */
  height: string;
  mirror?: boolean;
  alt: string;
  /** On the positioning wrapper — CSS effects (shake, slide) go here. */
  className?: string;
  onComplete?: () => void;
}) {
  const anchorX = mirror ? animation.width - animation.anchor.x : animation.anchor.x;
  const dx = (-anchorX / animation.width) * 100;
  const dy = ((animation.height - 1 - animation.anchor.y) / animation.height) * 100;
  return (
    <div
      className={`absolute bottom-0 left-1/2 ${className}`}
      style={{ transform: `translate(${dx}%, ${dy}%)` }}
    >
      <SpriteAnimator
        animation={animation}
        alt={alt}
        onComplete={onComplete}
        style={{ height, width: "auto", maxWidth: "none", transform: mirror ? "scaleX(-1)" : undefined }}
      />
    </div>
  );
}
