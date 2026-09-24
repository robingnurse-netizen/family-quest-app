"use client";

import { useEffect, useRef } from "react";
import { frameReady, loadFrame } from "./frame-cache";
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
 * requestAnimationFrame clock (no React re-render per frame); users who
 * prefer reduced motion see the first frame only.
 *
 * Frames come from the frame cache (./frame-cache): each is downloaded once
 * per page and only shown once it's loaded and decoded. A frame that isn't
 * ready (a slow or failed request) is skipped — the last good frame stays
 * up, and the cache retries it — so a sprite never blinks out, and never
 * shows its alt text or a broken-image icon.
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

  // The last frame that actually loaded in this <img>: what an error falls
  // back to.
  const lastGoodRef = useRef<string | null>(null);

  useEffect(() => {
    const img = imgRef.current;
    const { frames, fps, loop } = animation;
    if (!img || frames.length === 0) return;
    let cancelled = false;

    /** Show frame `i` if it's ready (true); otherwise keep the current one. */
    const show = (i: number) => {
      const src = frames[i];
      if (!frameReady(src)) {
        void loadFrame(src); // retries a failed frame once its backoff is up
        return false;
      }
      if (img.getAttribute("src") !== src) img.src = src;
      img.style.visibility = "";
      return true;
    };
    // The server-rendered first frame may have failed before this code ran
    // (no error handler yet): hide it until a good frame is in.
    if (img.complete && img.naturalWidth === 0) img.style.visibility = "hidden";
    // The first frame: at once if it's ready, else as soon as it is.
    if (!show(0)) {
      void loadFrame(frames[0]).then((ok) => {
        if (ok && !cancelled && !img.dataset.animating) show(0);
      });
    }

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const stop = () => {
      cancelled = true;
    };
    if (paused) return stop;
    // Nothing to animate (one frame, or reduced motion): show the first frame
    // for the animation's normal duration, then report completion so callers
    // waiting on a one-shot (hurt → idle) still move on.
    if (reduced || frames.length === 1) {
      if (loop) return stop;
      const holdMs = Math.max(600, (frames.length / fps) * 1000);
      const timer = setTimeout(() => onCompleteRef.current?.(), holdMs);
      return () => {
        stop();
        clearTimeout(timer);
      };
    }

    // Load every frame (once per page) before starting the clock; frames
    // that failed are skipped until a retry succeeds.
    let raf = 0;
    let replayTimer: ReturnType<typeof setTimeout> | undefined;
    void Promise.all(frames.map(loadFrame)).then(() => {
      if (cancelled) return;
      img.dataset.animating = "1";
      const frameMs = 1000 / fps;
      let start: number | null = null;
      let last: number | null = null;
      let shown = frameReady(frames[0]) ? 0 : -1;
      const restart = () => {
        start = null;
        last = null;
        shown = show(0) ? 0 : -1;
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
        // Not ready yet: keep the last good frame, try again next tick.
        if (index !== shown && show(index)) shown = index;
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
      delete img.dataset.animating;
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
      onLoad={(e) => {
        lastGoodRef.current = e.currentTarget.getAttribute("src");
        e.currentTarget.style.visibility = "";
      }}
      // Never the alt text or a broken-image icon: back to the last frame
      // that loaded, or invisible until one does.
      onError={(e) => {
        const el = e.currentTarget;
        const good = lastGoodRef.current;
        if (good && el.getAttribute("src") !== good) el.src = good;
        else el.style.visibility = "hidden";
      }}
      // Pixel art: scale with hard pixels, never smoothed (every sprite).
      className={`sprite-pixelated select-none ${className}`}
    />
  );
}
