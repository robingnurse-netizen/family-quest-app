// The battle background's day/night look: how much of each sky period
// ("dawn" | "day" | "dusk" | "night") shows at a moment, and the colours,
// star / lit-window strength and foreground tint that mix gives. Pure —
// tested in tests/sky.test.mjs. Drawn by components/rpg/battle/arena-backdrop.tsx.
//
// Crossfades follow lib/sun-times.ts's windows: night → dawn from the dawn
// window's start to sunrise, dawn → day from sunrise to the window's end;
// day → dusk from the dusk window's start to sunset, dusk → night from
// sunset to its end. In between, one period shows alone.

import { skyPeriod, type SkyPeriod, type SunLocation } from "@/lib/sun-times";

export const SKY_PERIODS = ["night", "dawn", "day", "dusk"] as const satisfies readonly SkyPeriod[];

/** How much each period shows (0–1, summing to 1). */
export type SkyWeights = Record<SkyPeriod, number>;

type CloudTones = { body: string; light: string; shade: string };

export type SkyLook = {
  /** Foreground (cottage, hills, floor) CSS filter amounts. */
  brightness: number;
  saturate: number;
  /** The hero and Rogue: dimmed less than the background, so they still read. */
  characters: { brightness: number; saturate: number };
  /** Opacity of the twinkling star layers. */
  stars: number;
  /** Opacity of the lit cottage windows. */
  windows: number;
  /** The two cloud layers' tones (the pixel art's body, top highlight, underside). */
  clouds: { far: CloudTones; near: CloudTones };
};

/**
 * Each period's look. Tune here. Night's clouds are the scene's original
 * purple ones; day's are white on the art's own sky blue.
 */
export const SKY_LOOKS: Record<SkyPeriod, SkyLook> = {
  night: {
    brightness: 0.5,
    saturate: 0.55,
    characters: { brightness: 0.75, saturate: 0.8 },
    stars: 1,
    windows: 1,
    clouds: {
      far: { body: "#5b4da0", light: "#7d70c4", shade: "#463a85" },
      near: { body: "#7466b8", light: "#9a8fd6", shade: "#5b4da0" },
    },
  },
  dawn: {
    brightness: 0.85,
    saturate: 0.85,
    characters: { brightness: 0.925, saturate: 0.93 },
    stars: 0.3,
    windows: 0.5,
    clouds: {
      far: { body: "#e8b8b0", light: "#f8d9c4", shade: "#b58a9e" },
      near: { body: "#f4c9b4", light: "#fde6d2", shade: "#c89aa4" },
    },
  },
  day: {
    brightness: 1,
    saturate: 1,
    characters: { brightness: 1, saturate: 1 },
    stars: 0,
    windows: 0,
    clouds: {
      far: { body: "#e6f1f5", light: "#ffffff", shade: "#c4dce5" },
      near: { body: "#f5fafb", light: "#ffffff", shade: "#d3e5ec" },
    },
  },
  dusk: {
    brightness: 0.8,
    saturate: 0.85,
    characters: { brightness: 0.9, saturate: 0.93 },
    stars: 0.3,
    windows: 0.5,
    clouds: {
      far: { body: "#b86a8a", light: "#e08e86", shade: "#7e4a7e" },
      near: { body: "#d98a8c", light: "#f4b28a", shade: "#9a5a86" },
    },
  },
};

const only = (period: SkyPeriod): SkyWeights => ({ night: 0, dawn: 0, day: 0, dusk: 0, [period]: 1 });

/** Share of the way from `a` to `b` that `t` is (0–1). */
const progress = (t: number, a: Date, b: Date) =>
  Math.min(1, Math.max(0, (t - a.getTime()) / (b.getTime() - a.getTime())));

/** The period mix at `now`, in the family's timezone. */
export function skyWeights(now: Date, timeZone: string, loc?: SunLocation): SkyWeights {
  const { period, times, windows } = skyPeriod(now, timeZone, loc);
  if (!windows || !times.sunrise || !times.sunset) return only(period);
  const t = now.getTime();
  const mix = (from: SkyPeriod, to: SkyPeriod, f: number): SkyWeights => ({
    ...only(from),
    [from]: 1 - f,
    [to]: f,
  });
  if (t < windows.dawnStart.getTime()) return only("night");
  if (t < times.sunrise.getTime()) return mix("night", "dawn", progress(t, windows.dawnStart, times.sunrise));
  if (t < windows.dawnEnd.getTime()) return mix("dawn", "day", progress(t, times.sunrise, windows.dawnEnd));
  if (t < windows.duskStart.getTime()) return only("day");
  if (t < times.sunset.getTime()) return mix("day", "dusk", progress(t, windows.duskStart, times.sunset));
  if (t < windows.duskEnd.getTime()) return mix("dusk", "night", progress(t, times.sunset, windows.duskEnd));
  return only("night");
}

/** One period alone (the dev preview). */
export const periodWeights = only;

const hexToRgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const mixHex = (weights: SkyWeights, pick: (look: SkyLook) => string) => {
  const rgb = [0, 0, 0];
  for (const p of SKY_PERIODS) {
    const c = hexToRgb(pick(SKY_LOOKS[p]));
    for (let i = 0; i < 3; i++) rgb[i] += c[i] * weights[p];
  }
  return `#${rgb.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}`;
};
const mixNum = (weights: SkyWeights, pick: (look: SkyLook) => number) =>
  SKY_PERIODS.reduce((sum, p) => sum + pick(SKY_LOOKS[p]) * weights[p], 0);

/** The look for a period mix: every value blended by the weights. */
export function blendLook(weights: SkyWeights): SkyLook {
  const tones = (layer: "far" | "near"): CloudTones => ({
    body: mixHex(weights, (l) => l.clouds[layer].body),
    light: mixHex(weights, (l) => l.clouds[layer].light),
    shade: mixHex(weights, (l) => l.clouds[layer].shade),
  });
  return {
    brightness: mixNum(weights, (l) => l.brightness),
    saturate: mixNum(weights, (l) => l.saturate),
    characters: {
      brightness: mixNum(weights, (l) => l.characters.brightness),
      saturate: mixNum(weights, (l) => l.characters.saturate),
    },
    stars: mixNum(weights, (l) => l.stars),
    windows: mixNum(weights, (l) => l.windows),
    clouds: { far: tones("far"), near: tones("near") },
  };
}

/**
 * Opacities for the four sky layers stacked in SKY_PERIODS order (night at
 * the bottom), so the stack shows each period by exactly its weight: a layer
 * covers everything below it by its weight's share of the total so far.
 */
export function stackedOpacities(weights: SkyWeights): SkyWeights {
  const out = { night: 0, dawn: 0, day: 0, dusk: 0 };
  let below = 0;
  for (const p of SKY_PERIODS) {
    below += weights[p];
    out[p] = below > 0 ? weights[p] / below : 0;
  }
  return out;
}
