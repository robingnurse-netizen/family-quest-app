"use client";

import { useEffect, useRef } from "react";
import type { SpriteAnimation } from "./types";

type Props = {
  animation: SpriteAnimation;
  /** Display scale relative to the source frames (e.g. 0.4). */
  scale?: number;
  alt: string;
  className?: string;
  /** Extra inline style for the <img> (e.g. a CSS height instead of `scale`). */
  style?: React.CSSProperties;
  /** Show the first frame only (no animation). */
  paused?: boolean;
  /**
   * Hold the current frame (a hit-stop) and carry on from it afterwards —
   * the clock doesn't advance while frozen, and nothing restarts.
   */
  frozen?: boolean;
  /** Called when a non-looping animation reaches its last frame. */
  onComplete?: () => void;
  /**
   * Non-looping animations (attack, hurt, death…) play once and hold their
   * last frame. Set this to replay them after holding the last frame for
   * this many ms — for previews; gameplay triggers them explicitly.
   */
  replayDelayMs?: number;
};

/**
 * Plays a sprite animation by swapping an <img>'s src on a
 * requestAnimationFrame clock (no React re-render per frame). Frames are
 * preloaded first so the loop doesn't flicker; users who prefer reduced
 * motion see the first frame only.
 */
export function SpriteAnimator({
  animation,
  scale = 1,
  alt,
  className = "",
  style,
  paused = false,
  frozen = false,
  onComplete,
  replayDelayMs,
}: Props) {
  const imgRef = useRef<HTMLImageElement>(null);
  const frozenRef = useRef(frozen);
  useEffect(() => {
    frozenRef.current = frozen;
  }, [frozen]);
  const onCompleteRef = useRef(onComplete);
  useEffect(() => {
    onCompleteRef.current = onComplete;
  }, [onComplete]);

  useEffect(() => {
    const img = imgRef.current;
    const { frames, fps, loop } = animation;
    if (!img || frames.length === 0) return;
    img.src = frames[0];

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (paused) return;
    // Nothing to animate (one frame, or reduced motion): show the first frame
    // for the animation's normal duration, then report completion so callers
    // waiting on a one-shot (hurt → idle) still move on.
    if (reduced || frames.length === 1) {
      if (loop) return;
      const holdMs = Math.max(600, (frames.length / fps) * 1000);
      const timer = setTimeout(() => onCompleteRef.current?.(), holdMs);
      return () => clearTimeout(timer);
    }

    // Preload every frame before starting the clock.
    let cancelled = false;
    let raf = 0;
    let replayTimer: ReturnType<typeof setTimeout> | undefined;
    const preload = frames.map(
      (src) =>
        new Promise<void>((resolve) => {
          const im = new Image();
          im.onload = im.onerror = () => resolve();
          im.src = src;
        }),
    );

    void Promise.all(preload).then(() => {
      if (cancelled) return;
      const frameMs = 1000 / fps;
      let start: number | null = null;
      let last: number | null = null;
      let shown = 0;
      const restart = () => {
        start = null;
        last = null;
        shown = 0;
        img.src = frames[0];
        raf = requestAnimationFrame(tick);
      };
      const tick = (now: number) => {
        start ??= now;
        // Frozen: push the start forward so the clock stands still.
        if (frozenRef.current && last !== null) start += now - last;
        last = now;
        let index = Math.floor((now - start) / frameMs);
        if (loop) index %= frames.length;
        else if (index >= frames.length - 1) index = frames.length - 1;
        if (index !== shown) {
          shown = index;
          img.src = frames[index];
        }
        if (!loop && index === frames.length - 1) {
          onCompleteRef.current?.();
          if (replayDelayMs !== undefined) replayTimer = setTimeout(restart, replayDelayMs);
          return;
        }
        raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    });

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      clearTimeout(replayTimer);
    };
  }, [animation, paused, replayDelayMs]);

  return (
    // eslint-disable-next-line @next/next/no-img-element -- frames are swapped imperatively
    <img
      ref={imgRef}
      src={animation.frames[0]}
      alt={alt}
      width={Math.round(animation.width * scale)}
      height={Math.round(animation.height * scale)}
      draggable={false}
      style={style}
      // Pixel art: scale with hard pixels, never smoothed (every sprite).
      className={`sprite-pixelated select-none ${className}`}
    />
  );
}
