// Sunrise / sunset and sky periods (lib/sun-times.ts) for Aberdeen.
// Reference times: Aberdeen's solstice sunrise / sunset (to the minute,
// allowing 3 min for rounding and refraction differences between sources).
import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { importTs } from "./helpers/load-ts.mjs";

const sun = await importTs(fileURLToPath(new URL("../lib/sun-times.ts", import.meta.url)));
const { timeOf } = await importTs(fileURLToPath(new URL("../lib/calendar/dates.ts", import.meta.url)));
const TZ = "Europe/London";

const minutes = (hhmm) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
};
function near(date, hhmm, tz = TZ, tol = 3) {
  const got = timeOf(date, tz);
  assert.ok(Math.abs(minutes(got) - minutes(hhmm)) <= tol, `${got} is not within ${tol} min of ${hhmm}`);
}

test("solstices match Aberdeen's known times", () => {
  const summer = sun.sunTimes(new Date("2026-06-21T12:00:00Z"), TZ);
  near(summer.sunrise, "04:12");
  near(summer.sunset, "22:07");
  const winter = sun.sunTimes(new Date("2026-12-21T12:00:00Z"), TZ);
  near(winter.sunrise, "08:47");
  near(winter.sunset, "15:27");
  assert.equal(summer.polar, null);
});

test("times are for the family's calendar day, across the clock changes", () => {
  for (const iso of ["2026-03-29T00:30:00Z", "2026-03-29T22:30:00Z", "2026-10-25T00:30:00+01:00", "2026-10-25T23:30:00Z"]) {
    const t = sun.sunTimes(new Date(iso), TZ);
    assert.equal(timeOf(t.sunrise, TZ) < timeOf(t.sunset, TZ), true);
    assert.equal(t.dayKey, iso.slice(0, 10));
  }
  // Clocks go forward on 29 Mar: sunrise moves about an hour later.
  const before = sun.sunTimes(new Date("2026-03-28T12:00:00Z"), TZ).sunrise;
  const after = sun.sunTimes(new Date("2026-03-29T12:00:00Z"), TZ).sunrise;
  assert.ok(minutes(timeOf(after, TZ)) - minutes(timeOf(before, TZ)) > 50);
});

test("a timezone far from the longitude still gets its own day's events", () => {
  // Aberdeen's sun seen from Auckland's calendar: both events on that date.
  const tz = "Pacific/Auckland";
  const t = sun.sunTimes(new Date("2026-06-21T00:00:00Z"), tz);
  assert.ok(t.sunrise && t.sunset);
  assert.equal(new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(t.sunrise), t.dayKey);
  assert.equal(new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(t.sunset), t.dayKey);
});

test("sky periods follow the dawn / dusk windows", () => {
  const day = new Date("2026-09-24T12:00:00Z");
  const { sunrise, sunset } = sun.sunTimes(day, TZ);
  const at = (base, min) => sun.skyPeriod(new Date(base.getTime() + min * 60_000), TZ).period;
  const { DAWN_WINDOW: dawn, DUSK_WINDOW: dusk } = sun;
  assert.equal(at(sunrise, -dawn.beforeMin - 1), "night");
  assert.equal(at(sunrise, -dawn.beforeMin), "dawn");
  assert.equal(at(sunrise, dawn.afterMin - 1), "dawn");
  assert.equal(at(sunrise, dawn.afterMin), "day");
  assert.equal(at(sunset, -dusk.beforeMin - 1), "day");
  assert.equal(at(sunset, -dusk.beforeMin), "dusk");
  assert.equal(at(sunset, dusk.afterMin - 1), "dusk");
  assert.equal(at(sunset, dusk.afterMin), "night");
  assert.equal(sun.skyPeriod(new Date("2026-09-24T01:00:00+01:00"), TZ).period, "night");
});

test("no sunrise inside the polar circle in midwinter", () => {
  const t = sun.sunTimes(new Date("2026-12-21T12:00:00Z"), "UTC", { name: "Svalbard", lat: 78.2, lon: 15.6 });
  assert.equal(t.sunrise, null);
  assert.equal(t.polar, "polar-night");
  assert.equal(sun.skyPeriod(new Date("2026-12-21T12:00:00Z"), "UTC", { name: "Svalbard", lat: 78.2, lon: 15.6 }).period, "night");
});
