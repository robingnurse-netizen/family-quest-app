"use client";

import { useEffect, useState } from "react";

const TRAIL_DELAY_MS = 450;

const tones = {
  boss: { fill: "bg-boss", label: "text-boss-text" },
  party: { fill: "bg-party", label: "text-party-text" },
} as const;

/**
 * Framed, segmented HP bar for the battle scene: `segments` fixed chunks in
 * an inset well, the last one partly filled. When HP drops, the lost part
 * stays lit as a pale "damage trail" for a moment, then drains (like a
 * fighting game). HP numbers use the body font (Stage 1's digit rule).
 */
export function HudBar({
  label,
  icon,
  current,
  max,
  segments,
  tone,
  size = "md",
}: {
  label: string;
  icon: React.ReactNode;
  current: number;
  max: number;
  segments: number;
  tone: keyof typeof tones;
  size?: "md" | "sm";
}) {
  const pct = max > 0 ? Math.max(0, Math.min(1, current / max)) : 0;

  // The trail follows HP up immediately and down after a short delay.
  const [trail, setTrail] = useState(pct);
  if (pct > trail) setTrail(pct);
  useEffect(() => {
    if (trail <= pct) return;
    const t = setTimeout(() => setTrail(pct), TRAIL_DELAY_MS);
    return () => clearTimeout(t);
  }, [pct, trail]);

  const chunk = (value: number, i: number) => Math.max(0, Math.min(1, value * segments - i)) * 100;
  const t = tones[tone];

  return (
    <div className="min-w-0">
      <div className={`flex items-center justify-between gap-2 ${size === "md" ? "mb-1" : "mb-0.5"}`}>
        <span className={`flex min-w-0 items-center gap-1.5 font-display text-sm font-semibold uppercase ${t.label}`}>
          {icon}
          <span className="truncate">{label}</span>
        </span>
        <span className={`shrink-0 font-extrabold tabular-nums text-white ${size === "md" ? "text-base" : "text-sm"}`}>
          {current}
          <span className="text-stone-text"> / {max}</span>
        </span>
      </div>
      <div
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={max}
        aria-valuenow={current}
        className={`flex gap-[2px] rounded-[3px] border-2 border-stone-edge bg-well p-[2px] shadow-[inset_2px_2px_0_rgb(0_0_0/0.6),0_1px_0_rgb(255_255_255/0.08)] ${
          size === "md" ? "h-5" : "h-3.5"
        }`}
      >
        {Array.from({ length: segments }, (_, i) => (
          <div key={i} className="relative flex-1 overflow-hidden rounded-[1px] bg-white/[0.07]">
            <div
              className="absolute inset-y-0 left-0 bg-[#fff5f5]/85 transition-[width] duration-500 ease-in motion-reduce:transition-none"
              style={{ width: `${chunk(trail, i)}%` }}
            />
            <div
              className={`bar-fill absolute inset-y-0 left-0 transition-[width] duration-150 motion-reduce:transition-none ${t.fill}`}
              style={{ width: `${chunk(pct, i)}%` }}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
