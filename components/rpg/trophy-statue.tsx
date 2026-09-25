"use client";

import { useEffect, useRef } from "react";
import { armSounds, playSound } from "@/lib/sound/sound-manager";

// The Trophy Case's statues are buttons. A beaten boss presses down like a
// physical button (shrinks and dips, then springs back) and chimes; an
// unbeaten one stays rigid and clunks — it can't be activated yet. Sounds
// go through the app's sound manager (mute setting, rate limits).

/** Start loading sounds on the first tap/keypress (the app's convention); render once per page. */
export function TrophyCaseSounds() {
  useEffect(() => armSounds(), []);
  return null;
}

export function TrophyStatue({
  unlocked,
  label,
  children,
}: {
  unlocked: boolean;
  /** Accessible name (the boss's name once beaten, "Unknown boss" before). */
  label: string;
  children: React.ReactNode;
}) {
  const pressRef = useRef<HTMLSpanElement>(null);

  const onClick = () => {
    if (!unlocked) {
      playSound("trophyLocked");
      return;
    }
    playSound("trophyUnlocked");
    // Restart the press by re-adding its class (as the scene does for .hero-hit).
    const el = pressRef.current;
    if (!el) return;
    el.classList.remove("trophy-press");
    void el.offsetWidth;
    el.classList.add("trophy-press");
  };

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-disabled={!unlocked}
      className={`relative flex h-full w-full items-end justify-center rounded-[3px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold ${
        unlocked ? "cursor-pointer" : "cursor-not-allowed"
      }`}
    >
      <span
        ref={pressRef}
        className="relative flex h-full w-full origin-bottom flex-col items-center justify-end"
        onAnimationEnd={(e) => {
          if (e.animationName.startsWith("trophy-press")) e.currentTarget.classList.remove("trophy-press");
        }}
      >
        {children}
      </span>
    </button>
  );
}
