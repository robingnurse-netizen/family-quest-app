// The battle background's day/night mix (lib/rpg/sky.ts): crossfades on
// lib/sun-times.ts's windows, the stacked-layer opacities and the blended look.
import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { importTs } from "./helpers/load-ts.mjs";

const sky = await importTs(fileURLToPath(new URL("../lib/rpg/sky.ts", import.meta.url)));
const sun = await importTs(fileURLToPath(new URL("../lib/sun-times.ts", import.meta.url)));
const TZ = "Europe/London";
const DAY = new Date("2026-09-24T12:00:00Z");
const { sunrise, sunset } = sun.sunTimes(DAY, TZ);
const plus = (d, min) => new Date(d.getTime() + min * 60_000);
const w = (d) => sky.skyWeights(d, TZ);
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} vs ${b}`);

test("weights always sum to 1", () => {
  for (let min = 0; min < 24 * 60; min += 7) {
    const weights = w(plus(new Date("2026-09-24T00:00:00+01:00"), min));
    close(Object.values(weights).reduce((a, b) => a + b, 0), 1);
  }
});

test("crossfades run between the window edges and sunrise / sunset", () => {
  const { DAWN_WINDOW: dawn, DUSK_WINDOW: dusk } = sun;
  assert.deepEqual(w(plus(sunrise, -dawn.beforeMin - 1)), { night: 1, dawn: 0, day: 0, dusk: 0 });
  assert.equal(w(sunrise).dawn, 1);
  close(w(plus(sunrise, -dawn.beforeMin / 2)).dawn, 0.5);
  close(w(plus(sunrise, dawn.afterMin / 2)).day, 0.5);
  assert.equal(w(plus(sunrise, dawn.afterMin)).day, 1);
  assert.equal(w(DAY).day, 1);
  close(w(plus(sunset, -dusk.beforeMin / 2)).dusk, 0.5);
  assert.equal(w(sunset).dusk, 1);
  close(w(plus(sunset, dusk.afterMin / 2)).night, 0.5);
  assert.equal(w(plus(sunset, dusk.afterMin)).night, 1);
});

test("stacked layer opacities show each period by exactly its weight", () => {
  const cases = [
    { night: 1, dawn: 0, day: 0, dusk: 0 },
    { night: 0.25, dawn: 0.75, day: 0, dusk: 0 },
    { night: 0, dawn: 0.4, day: 0.6, dusk: 0 },
    { night: 0.7, dawn: 0, day: 0, dusk: 0.3 },
    { night: 0, dawn: 0, day: 0.5, dusk: 0.5 },
  ];
  for (const weights of cases) {
    const op = sky.stackedOpacities(weights);
    // Composite bottom to top: each layer covers what's below by its opacity.
    const shown = { night: 0, dawn: 0, day: 0, dusk: 0 };
    for (const p of sky.SKY_PERIODS) {
      for (const q of sky.SKY_PERIODS) shown[q] *= 1 - op[p];
      shown[p] += op[p];
    }
    for (const p of sky.SKY_PERIODS) close(shown[p], weights[p]);
  }
});

test("the look blends between periods", () => {
  const night = sky.blendLook(sky.periodWeights("night"));
  assert.equal(night.clouds.far.body, sky.SKY_LOOKS.night.clouds.far.body);
  assert.equal(night.brightness, sky.SKY_LOOKS.night.brightness);
  const half = sky.blendLook({ night: 0.5, dawn: 0, day: 0.5, dusk: 0 });
  close(half.brightness, (sky.SKY_LOOKS.night.brightness + sky.SKY_LOOKS.day.brightness) / 2);
  close(half.stars, 0.5);
  close(half.characters.brightness, (0.75 + 1) / 2);
  // The characters are dimmed less than the background at every period.
  for (const p of sky.SKY_PERIODS) {
    const look = sky.SKY_LOOKS[p];
    assert.ok(look.characters.brightness >= look.brightness && look.characters.saturate >= look.saturate, p);
  }
  // #5b4da0 and #e6f1f5 half and half.
  assert.equal(half.clouds.far.body, "#a19fcb");
});
