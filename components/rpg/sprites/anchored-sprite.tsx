"use client";

import { useCallback, useRef } from "react";
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
 *
 * A soft ground shadow sits where the character meets the ground, frame by
 * frame from the manifest's `shadow` (footprint centre and width, the
 * contact band's height, how high the frame is off the ground): centred on
 * the contact band so every foot — or a lying body — stands in it; wider
 * lying down, smaller and fainter in a jump. It's inside the positioning wrapper, so slides,
 * shakes and moves carry it along; body motion that should leave it on the
 * ground (a leap) animates `bodyRef` only.
 */
export function AnchoredSprite({
  animation,
  height,
  mirror = false,
  alt,
  className = "",
  frozen,
  paused,
  onComplete,
  shadow = true,
  bodyRef,
  shadowRef,
}: {
  animation: SpriteAnimation;
  /** CSS height of this animation's full canvas. */
  height: string;
  mirror?: boolean;
  alt: string;
  /** On the positioning wrapper — CSS effects (shake, slide) go here. */
  className?: string;
  /** Hold the current frame (hit-stop); see SpriteAnimator. */
  frozen?: boolean;
  /** Show the first frame only, until false; see SpriteAnimator. */
  paused?: boolean;
  onComplete?: () => void;
  /** Draw the ground shadow (default true). */
  shadow?: boolean;
  /** The sprite alone (not its shadow): for body motion like a leap. */
  bodyRef?: React.RefObject<HTMLDivElement | null>;
  /** The shadow element: to move it with body motion (a lunge) or shrink it (a leap). */
  shadowRef?: React.RefObject<HTMLDivElement | null>;
}) {
  const anchorX = mirror ? animation.width - animation.anchor.x : animation.anchor.x;
  const dx = (-anchorX / animation.width) * 100;
  const dy = ((animation.height - 1 - animation.anchor.y) / animation.height) * 100;

  const ownShadowRef = useRef<HTMLDivElement>(null);
  const shadowEl = shadowRef ?? ownShadowRef;
  const hasShadow = shadow && animation.shadow !== undefined;
  // Per frame, straight on the element (frames swap without re-rendering).
  const onFrame = useCallback(
    (src: string) => {
      const el = shadowEl.current;
      const style = shadowStyle(animation, mirror, src);
      if (el && style) Object.assign(el.style, style);
    },
    [animation, mirror, shadowEl],
  );

  return (
    <div
      className={`absolute bottom-0 left-1/2 ${className}`}
      style={{ transform: `translate(${dx}%, ${dy}%)` }}
    >
      {hasShadow && (
        <div
          ref={shadowEl}
          aria-hidden
          className="sprite-shadow"
          style={shadowStyle(animation, mirror, animation.frames[0]) ?? undefined}
        />
      )}
      <div ref={bodyRef}>
        <SpriteAnimator
          animation={animation}
          alt={alt}
          frozen={frozen}
          paused={paused}
          onComplete={onComplete}
          onFrame={hasShadow ? onFrame : undefined}
          style={{ height, width: "auto", maxWidth: "none", transform: mirror ? "scaleX(-1)" : undefined }}
        />
      </div>
    </div>
  );
}

/**
 * The shadow for one frame, as percentages of the sprite's box: centred
 * horizontally on the footprint and vertically on the contact band (from
 * the far feet down to the ground line), so the feet meet it; as wide as
 * the footprint, a little taller than the band (at most 10% of the canvas,
 * so lying-down shadows stay flat); smaller and fainter the higher the
 * frame is off the ground. Airborne frames keep the grounded band, on the
 * ground line.
 */
function shadowStyle(animation: SpriteAnimation, mirror: boolean, src: string) {
  const data = animation.shadow?.[src];
  if (!data) return null;
  const [cx, w, lift, band] = data;
  const { width: W, height: H } = animation;
  const x = mirror ? W - cx : cx;
  const ground = animation.anchor.y + 1; // the bottom edge of the ground-line pixels
  const tall = Math.min(Math.max(band * 1.4, 3), 0.1 * H);
  const centreY = ground - band / 2 + band * 0.15;
  const off = lift / (animation.bodyHeight ?? H);
  const scale = Math.max(0.55, 1 - 1.5 * off);
  return {
    left: `${(x / W) * 100}%`,
    top: `${(centreY / H) * 100}%`,
    width: `${(w / W) * 100}%`,
    height: `${(tall / H) * 100}%`,
    transform: `translate(-50%, -50%) scale(${scale.toFixed(3)})`,
    opacity: String(Math.max(0.3, 1 - 2.5 * off).toFixed(3)),
  };
}
