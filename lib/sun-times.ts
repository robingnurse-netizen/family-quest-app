// Sunrise / sunset for the battle background's day/night cycle, and the
// sky period ("dawn" | "day" | "dusk" | "night") at a given moment.
//
// NOAA's solar position equations (the NOAA Solar Calculator's), with the
// standard -0.833° sunrise/sunset altitude (refraction + the sun's radius):
// good to about a minute at these latitudes. No dependencies. Pure — tested
// in tests/sun-times.test.mjs.
//
// Days are the *family's* days (families.timezone): sunTimes() returns the
// sunrise and sunset that fall on that calendar date there. The location is
// fixed for now (SUN_LOCATION); making it a family setting is a later task.

import { addDays, dayKeyOf, parseDayKey } from "@/lib/calendar/dates";

export type SunLocation = { name: string; lat: number; lon: number };

/** Where the sun is calculated for. Hardcoded until it's a family setting. */
export const SUN_LOCATION: SunLocation = { name: "Aberdeen", lat: 57.15, lon: -2.09 };

/**
 * The dawn / dusk windows, in minutes either side of sunrise / sunset.
 * Tune here. Dawn: sunrise − before … sunrise + after; dusk likewise.
 */
export const DAWN_WINDOW = { beforeMin: 45, afterMin: 45 };
export const DUSK_WINDOW = { beforeMin: 45, afterMin: 45 };

export type SkyPeriod = "dawn" | "day" | "dusk" | "night";

export type SunTimes = {
  /** The family-timezone date these are for, "YYYY-MM-DD". */
  dayKey: string;
  sunrise: Date | null;
  sunset: Date | null;
  /** Set when the sun doesn't rise or set that day (not at Aberdeen). */
  polar: "midnight-sun" | "polar-night" | null;
};

const RAD = Math.PI / 180;
const MS_PER_DAY = 86_400_000;
const SUNRISE_ZENITH = 90.833;

/** Sun's declination (degrees) and the equation of time (minutes). */
function solarPosition(ms: number) {
  const jd = ms / MS_PER_DAY + 2440587.5;
  const t = (jd - 2451545) / 36525; // Julian centuries since J2000
  const l0 = (280.46646 + t * (36000.76983 + t * 0.0003032)) % 360;
  const m = 357.52911 + t * (35999.05029 - 0.0001537 * t);
  const e = 0.016708634 - t * (0.000042037 + 0.0000001267 * t);
  const c =
    Math.sin(m * RAD) * (1.914602 - t * (0.004817 + 0.000014 * t)) +
    Math.sin(2 * m * RAD) * (0.019993 - 0.000101 * t) +
    Math.sin(3 * m * RAD) * 0.000289;
  const omega = 125.04 - 1934.136 * t;
  const lambda = l0 + c - 0.00569 - 0.00478 * Math.sin(omega * RAD);
  const eps0 = 23 + (26 + (21.448 - t * (46.815 + t * (0.00059 - t * 0.001813))) / 60) / 60;
  const eps = eps0 + 0.00256 * Math.cos(omega * RAD);
  const decl = Math.asin(Math.sin(eps * RAD) * Math.sin(lambda * RAD)) / RAD;
  const y = Math.tan((eps / 2) * RAD) ** 2;
  const eqTime =
    4 *
    (y * Math.sin(2 * l0 * RAD) -
      2 * e * Math.sin(m * RAD) +
      4 * e * y * Math.sin(m * RAD) * Math.cos(2 * l0 * RAD) -
      0.5 * y * y * Math.sin(4 * l0 * RAD) -
      1.25 * e * e * Math.sin(2 * m * RAD)) /
    RAD;
  return { decl, eqTime };
}

/**
 * Sunrise or sunset on the UTC date starting at `utcMidnight` (ms), or the
 * reason there isn't one. Refined twice at the event's own time.
 */
function sunEvent(utcMidnight: number, loc: SunLocation, kind: "rise" | "set") {
  let ms = utcMidnight + MS_PER_DAY / 2;
  for (let i = 0; i < 3; i++) {
    const { decl, eqTime } = solarPosition(ms);
    const cosH =
      Math.cos(SUNRISE_ZENITH * RAD) / (Math.cos(loc.lat * RAD) * Math.cos(decl * RAD)) -
      Math.tan(loc.lat * RAD) * Math.tan(decl * RAD);
    if (cosH > 1) return "polar-night" as const;
    if (cosH < -1) return "midnight-sun" as const;
    const hourAngle = Math.acos(cosH) / RAD;
    const noon = 720 - 4 * loc.lon - eqTime; // minutes after 00:00 UTC
    const minutes = kind === "rise" ? noon - 4 * hourAngle : noon + 4 * hourAngle;
    ms = utcMidnight + minutes * 60_000;
  }
  return new Date(ms);
}

/** The sunrise / sunset that fall on `date`'s calendar day in `timeZone`. */
export function sunTimes(date: Date, timeZone: string, loc: SunLocation = SUN_LOCATION): SunTimes {
  const dayKey = dayKeyOf(date, timeZone);
  let polar: SunTimes["polar"] = null;
  // The event for a family day can land on the neighbouring UTC date when
  // the timezone is far from the longitude: try both sides, keep the match.
  const find = (kind: "rise" | "set") => {
    for (const offset of [0, -1, 1]) {
      const { year, month, day } = parseDayKey(addDays(dayKey, offset));
      const event = sunEvent(Date.UTC(year, month - 1, day), loc, kind);
      if (typeof event === "string") {
        polar = event;
        return null;
      }
      if (dayKeyOf(event, timeZone) === dayKey) return event;
    }
    return null;
  };
  const sunrise = find("rise");
  const sunset = find("set");
  return { dayKey, sunrise, sunset, polar: sunrise && sunset ? null : polar };
}

const addMinutes = (d: Date, min: number) => new Date(d.getTime() + min * 60_000);

/** The sky period at `now` in `timeZone`, with the day's times and windows. */
export function skyPeriod(now: Date, timeZone: string, loc: SunLocation = SUN_LOCATION) {
  const times = sunTimes(now, timeZone, loc);
  const { sunrise, sunset } = times;
  if (!sunrise || !sunset) {
    const period: SkyPeriod = times.polar === "midnight-sun" ? "day" : "night";
    return { period, times, windows: null };
  }
  const windows = {
    dawnStart: addMinutes(sunrise, -DAWN_WINDOW.beforeMin),
    dawnEnd: addMinutes(sunrise, DAWN_WINDOW.afterMin),
    duskStart: addMinutes(sunset, -DUSK_WINDOW.beforeMin),
    duskEnd: addMinutes(sunset, DUSK_WINDOW.afterMin),
  };
  const t = now.getTime();
  let period: SkyPeriod = "night";
  if (t >= windows.dawnStart.getTime() && t < windows.dawnEnd.getTime()) period = "dawn";
  else if (t >= windows.dawnEnd.getTime() && t < windows.duskStart.getTime()) period = "day";
  else if (t >= windows.duskStart.getTime() && t < windows.duskEnd.getTime()) period = "dusk";
  return { period, times, windows };
}
