"use client";

// The battle arena's background: a day/night sky behind the meadow art.
//
// Layers, bottom to top: four skies (night, dawn, day, dusk — stacked so
// each shows by its weight from lib/rpg/sky.ts), the twinkling stars, the
// two drifting cloud layers, the meadow (public/backgrounds/meadow-day.png
// with its flat sky colour keyed out, tinted per period), and the lit
// cottage windows (meadow-night-windows.png, fading in at dusk and night).
// Crossfades follow lib/sun-times.ts's dawn / dusk windows in the family's
// timezone, re-checked every minute.
//
// Every value that depends on the time is a CSS variable, from
// useArenaSky(), which the arena box spreads into its style: the backdrop
// reads them, and so does the party (.arena-party: the hero and Rogue are
// dimmed at night too, less than the background). The markup itself is the
// same on server and client.

import { useEffect, useState, useSyncExternalStore } from "react";
import type { SkyPeriod } from "@/lib/sun-times";
import { todayKey, zonedToUtc } from "@/lib/calendar/dates";
import { blendLook, periodWeights, skyWeights, stackedOpacities, type SkyWeights } from "@/lib/rpg/sky";

const MEADOW_SRC = "/backgrounds/meadow-day.png";
const WINDOWS_SRC = "/backgrounds/meadow-night-windows.png";
/** The meadow art's flat sky colour (#a3cddb), keyed out at render time. */
const SKY_KEY = [163, 205, 219] as const;
/** Per-channel slack for the key (nothing else in the art is within 60). */
const KEY_TOLERANCE = 4;
/** families.timezone's default (for the dev day-cycle preview). */
const DEFAULT_TIME_ZONE = "Europe/London";

// ---- Sky key: one canvas pass per page, shared by every backdrop ----------

const keyed = new Map<string, Promise<string>>();

/** An object URL of `src` with its sky-coloured pixels made transparent. */
function keyOutSky(src: string): Promise<string> {
  let url = keyed.get(src);
  if (!url) {
    url = (async () => {
      const img = new Image();
      img.src = src;
      await img.decode();
      const canvas = document.createElement("canvas");
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx) throw new Error("no 2d canvas");
      ctx.drawImage(img, 0, 0);
      const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const px = data.data;
      for (let i = 0; i < px.length; i += 4) {
        if (
          Math.abs(px[i] - SKY_KEY[0]) <= KEY_TOLERANCE &&
          Math.abs(px[i + 1] - SKY_KEY[1]) <= KEY_TOLERANCE &&
          Math.abs(px[i + 2] - SKY_KEY[2]) <= KEY_TOLERANCE
        ) {
          px[i + 3] = 0;
        }
      }
      ctx.putImageData(data, 0, 0);
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
      if (!blob) throw new Error("canvas.toBlob failed");
      return URL.createObjectURL(blob);
    })();
    // A failure isn't cached: the next backdrop tries again.
    url.catch(() => keyed.delete(src));
    keyed.set(src, url);
  }
  return url;
}

/** The keyed meadow's URL once ready; the unkeyed art if keying fails. */
function useKeyedMeadow() {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    keyOutSky(MEADOW_SRC).then(
      (u) => live && setUrl(u),
      () => live && setUrl(MEADOW_SRC),
    );
    return () => {
      live = false;
    };
  }, []);
  return url;
}

// ---- Dev preview: force a period or a time (window.__fqBattle.sky) ---------

type SkyOverride = { period: SkyPeriod } | { at: Date } | null;
let override: SkyOverride = null;
let cycleTimer: ReturnType<typeof setInterval> | undefined;
const listeners = new Set<() => void>();
const setOverride = (next: SkyOverride) => {
  override = next;
  for (const l of listeners) l();
};
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

/**
 * Dev only (registered on __fqBattle by the battle scene): show one period
 * ("night" | "dawn" | "day" | "dusk"), the sky at a time (a Date or an ISO
 * string, e.g. "2026-09-24T19:10"), or follow the clock again (null).
 */
export function previewSky(target: SkyPeriod | Date | string | null) {
  clearInterval(cycleTimer);
  if (target === null) setOverride(null);
  else if (target === "night" || target === "dawn" || target === "day" || target === "dusk") setOverride({ period: target });
  else setOverride({ at: new Date(target) });
}

/** Dev only: play today from midnight to midnight in `seconds`, then follow the clock. */
export function previewSkyCycle(seconds = 60, timeZone = DEFAULT_TIME_ZONE) {
  clearInterval(cycleTimer);
  const midnight = zonedToUtc(todayKey(timeZone), "00:00", timeZone);
  const start = Date.now();
  const tick = () => {
    const f = (Date.now() - start) / (seconds * 1000);
    if (f >= 1) return previewSky(null);
    setOverride({ at: new Date(midnight.getTime() + f * 86_400_000) });
  };
  tick();
  cycleTimer = setInterval(tick, 100);
}

function useSkyWeights(timeZone: string): SkyWeights {
  const forced = useSyncExternalStore(subscribe, () => override, () => null);
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);
  if (forced && "period" in forced) return periodWeights(forced.period);
  return skyWeights(forced ? forced.at : now, timeZone);
}

// ---- The backdrop -----------------------------------------------------------

/**
 * The arena's day/night CSS variables at this moment in `timeZone` (the
 * family's), re-checked every minute. Spread into the arena box's style,
 * with suppressHydrationWarning: the server renders its own "now", which the
 * client's differs from by moments (and follows within a minute).
 */
export function useArenaSky(timeZone: string): React.CSSProperties {
  const weights = useSkyWeights(timeZone);
  const look = blendLook(weights);
  const layers = stackedOpacities(weights);
  const filter = (b: number, s: number) => `brightness(${b.toFixed(3)}) saturate(${s.toFixed(3)})`;
  return {
    "--sky-night": layers.night,
    "--sky-dawn": layers.dawn,
    "--sky-day": layers.day,
    "--sky-dusk": layers.dusk,
    "--stars": look.stars,
    "--windows": look.windows,
    "--fg-filter": filter(look.brightness, look.saturate),
    "--char-filter": filter(look.characters.brightness, look.characters.saturate),
    "--cloud-far-body": look.clouds.far.body,
    "--cloud-far-light": look.clouds.far.light,
    "--cloud-far-shade": look.clouds.far.shade,
    "--cloud-near-body": look.clouds.near.body,
    "--cloud-near-light": look.clouds.near.light,
    "--cloud-near-shade": look.clouds.near.shade,
  } as React.CSSProperties;
}

/** The sky and meadow layers. Needs useArenaSky()'s variables on the arena box. */
export function ArenaBackdrop() {
  const meadow = useKeyedMeadow();

  return (
    <div aria-hidden className="absolute inset-0">
      <div className="sky-layer arena-sky" style={{ opacity: "var(--sky-night)" }} />
      <div className="sky-layer sky-dawn" style={{ opacity: "var(--sky-dawn)" }} />
      <div className="sky-layer sky-day" style={{ opacity: "var(--sky-day)" }} />
      <div className="sky-layer sky-dusk" style={{ opacity: "var(--sky-dusk)" }} />
      {/* Twinkling stars (two layers out of step), faded by period. */}
      <div className="sky-layer" style={{ opacity: "var(--stars)" }}>
        <div className="arena-stars arena-stars-a absolute inset-0" />
        <div className="arena-stars arena-stars-b absolute inset-0" />
      </div>
      {/* Slow clouds drifting at two speeds for parallax. Static under reduced motion. */}
      <div className="arena-clouds arena-clouds-far top-[6%]">
        <span className="cloud-tone cloud-far-body" />
        <span className="cloud-tone cloud-far-light" />
        <span className="cloud-tone cloud-far-shade" />
      </div>
      <div className="arena-clouds arena-clouds-near top-[24%]">
        <span className="cloud-tone cloud-near-body" />
        <span className="cloud-tone cloud-near-light" />
        <span className="cloud-tone cloud-near-shade" />
      </div>
      <div
        className="arena-fg arena-fg-meadow"
        style={{ backgroundImage: meadow ? `url(${meadow})` : undefined, opacity: meadow ? 1 : 0 }}
      />
      <div className="arena-fg arena-fg-windows" style={{ backgroundImage: `url(${WINDOWS_SRC})` }} />
    </div>
  );
}
