// Hit overlay choreography (lib/rpg/strike.ts): hit tiers by quest length
// and the hero's attack variants, against the real hero manifest.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { importTs } from "./helpers/load-ts.mjs";

const strike = await importTs(fileURLToPath(new URL("../lib/rpg/strike.ts", import.meta.url)));
const { createNoRepeatPicker } = await importTs(fileURLToPath(new URL("../lib/random.ts", import.meta.url)));
const hero = JSON.parse(
  readFileSync(fileURLToPath(new URL("../components/rpg/sprites/manifests/hero.json", import.meta.url)), "utf8"),
);
const attack = hero.animations.attack;

/** The frame a (one-shot) animation shows `ms` after it starts. */
const frameAt = (anim, ms) => anim.frames[Math.min(anim.frames.length - 1, Math.floor((ms * anim.fps) / 1000))];

// --- Tiers ----------------------------------------------------------------------------

test("tier boundaries: light ≤15 min, medium 16–44, heavy 45+", () => {
  const cases = [[1, "light"], [5, "light"], [15, "light"], [16, "medium"], [30, "medium"], [44, "medium"], [45, "heavy"], [60, "heavy"], [500, "heavy"]];
  for (const [minutes, tier] of cases) assert.equal(strike.hitTier(minutes), tier, `${minutes} min`);
});

test("heavier tiers never land softer, and stay quick", () => {
  const order = ["light", "medium", "heavy"].map((t) => strike.HIT_TIERS[t]);
  for (const key of ["hitStopMs", "shake", "burstScale", "debris", "debrisSpread", "flash"]) {
    for (let i = 1; i < order.length; i++) assert.ok(order[i][key] >= order[i - 1][key], `${key} rises with the tier`);
  }
  // Tasteful: a short freeze at most, a faint flash, and a visible step between tiers.
  assert.ok(strike.HIT_TIERS.heavy.hitStopMs <= 250);
  assert.ok(strike.HIT_TIERS.heavy.flash <= 0.35);
  assert.equal(strike.HIT_TIERS.light.flash, 0);
  assert.ok(strike.HIT_TIERS.heavy.shake > strike.HIT_TIERS.light.shake);
});

// --- Attack variants ------------------------------------------------------------------

test("there are 2–3 distinct swings, all cut from real attack frames", () => {
  const variants = strike.STRIKE_VARIANTS;
  assert.ok(variants.length >= 2 && variants.length <= 3);
  assert.equal(new Set(variants.map((v) => v.frames.join(","))).size, variants.length, "no two swings alike");
  for (const v of variants) {
    for (const i of v.frames) assert.ok(i >= 0 && i < attack.frames.length, `${v.name}: frame ${i}`);
    assert.ok(v.contact >= 0 && v.contact < v.frames.length, `${v.name}: contact`);
  }
});

test("each swing's contact frame is on screen at the moment of impact", () => {
  for (const v of strike.STRIKE_VARIANTS) {
    const contactFrame = attack.frames[v.frames[v.contact]];
    // First hit (after the 280ms dash), a combo hit (no lead), and a long lead.
    for (const lead of [280, 0, 50, 99, 100, 1000]) {
      const anim = strike.strikeAnimation(attack, v, lead);
      assert.equal(frameAt(anim, lead), contactFrame, `${v.name} at ${lead}ms`);
    }
  }
});

test("a swing keeps the manifest's canvas, anchor and facing (feet stay planted)", () => {
  for (const v of strike.STRIKE_VARIANTS) {
    const anim = strike.strikeAnimation(attack, v, 280);
    assert.deepEqual(
      { w: anim.width, h: anim.height, anchor: anim.anchor, facing: anim.facing, fps: anim.fps, loop: anim.loop },
      { w: attack.width, h: attack.height, anchor: attack.anchor, facing: attack.facing, fps: attack.fps, loop: false },
    );
    for (const f of anim.frames) assert.ok(attack.frames.includes(f));
  }
});

test("repeated ticks don't repeat a swing back to back", () => {
  const pick = createNoRepeatPicker(strike.STRIKE_VARIANTS.length);
  const seen = new Set();
  let last = -1;
  for (let i = 0; i < 300; i++) {
    const v = pick();
    assert.notEqual(v, last);
    seen.add(v);
    last = v;
  }
  assert.equal(seen.size, strike.STRIKE_VARIANTS.length);
});

// --- Body motion ------------------------------------------------------------------------

test("motion only with a run-up, and it lands on contact", () => {
  for (const motion of ["none", "lunge", "leap"]) {
    assert.equal(strike.strikeMotion(motion, 0, 150, 200), null, `${motion}: no motion on combo hits`);
  }
  assert.equal(strike.strikeMotion("none", 280, 150, 200), null);

  const leap = strike.strikeMotion("leap", 280, 150, 200);
  assert.equal(leap.duration, 280, "back on the ground at impact");
  assert.equal(leap.keyframes.at(-1).translate, "0 0");

  const lunge = strike.strikeMotion("lunge", 280, 150, 200);
  const peak = lunge.keyframes.find((k) => Math.abs((k.offset ?? -1) - 280 / lunge.duration) < 1e-9);
  assert.ok(peak, "furthest forward exactly at contact");
  assert.match(peak.translate, /^\d+px 0$/);
  assert.equal(lunge.keyframes.at(-1).translate, "0 0", "settles back");
  const offsets = lunge.keyframes.map((k) => k.offset).filter((o) => o !== undefined);
  assert.deepEqual(offsets, [...offsets].sort((a, b) => a - b), "offsets in order");
});
