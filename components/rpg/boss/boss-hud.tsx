"use client";

import { useLayoutEffect, useRef, useState } from "react";

// Below this share of the panel on screen, it pins to the bottom instead.
const MIN_VISIBLE = 0.9;

/**
 * Keeps the boss panel in view on the player dashboard: in its normal spot
 * while that's on screen, otherwise pinned to the bottom of the viewport as
 * a compact bar (the `compact` variant also matches [data-pinned]).
 *
 * Bottom rather than top: Chrome's toolbar slides over the top of the page
 * when it hides on scroll (ChromeOS tablet mode, touch), so a top-pinned
 * panel ended up underneath it. The children stay mounted either way — only
 * classes change — so sprite animations and Realtime aren't interrupted.
 */
export function BossHud({ className = "", children }: { className?: string; children: React.ReactNode }) {
  const slotRef = useRef<HTMLDivElement>(null);
  const [pinned, setPinned] = useState(false);
  // Slide in only when scrolling pins the panel — not when the page loads
  // already scrolled past it, where it should simply be there.
  const [slideIn, setSlideIn] = useState(false);
  // While pinned, the slot keeps the panel's in-flow height so the page
  // doesn't jump (and the observer keeps measuring the same box).
  const [slotHeight, setSlotHeight] = useState<number | null>(null);

  // Layout effect, not a plain effect: the first decision is made before the
  // browser paints the hydrated page. The observer's first callback only
  // arrives after a paint, which showed the panel in-flow below the fold and
  // then slid it up from under the screen edge on every load.
  useLayoutEffect(() => {
    const slot = slotRef.current;
    if (!slot) return;
    let wasPinned = false;
    const apply = (height: number, ratio: number, animate: boolean) => {
      const pin = ratio < MIN_VISIBLE;
      if (pin) setSlotHeight((h) => h ?? height);
      else setSlotHeight(null);
      if (pin && !wasPinned) setSlideIn(animate);
      wasPinned = pin;
      setPinned(pin);
    };

    const rect = slot.getBoundingClientRect();
    const onScreen = Math.max(0, Math.min(rect.bottom, window.innerHeight) - Math.max(rect.top, 0));
    apply(rect.height, rect.height > 0 ? onScreen / rect.height : 1, false);

    const observer = new IntersectionObserver(
      ([entry]) => apply(entry.boundingClientRect.height, entry.intersectionRatio, true),
      { threshold: [0, MIN_VISIBLE, 1] },
    );
    observer.observe(slot);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={slotRef} className={className} style={slotHeight ? { height: slotHeight } : undefined}>
      <div
        data-pinned={pinned || undefined}
        className={
          pinned
            ? `${slideIn ? "boss-hud-in " : ""}fixed inset-x-0 bottom-0 z-30 px-4 pb-[max(0.5rem,env(safe-area-inset-bottom))]`
            : ""
        }
      >
        <div className={pinned ? "mx-auto w-full max-w-3xl" : ""}>{children}</div>
      </div>
    </div>
  );
}
