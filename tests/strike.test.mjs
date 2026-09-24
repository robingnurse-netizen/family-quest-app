// Hit overlay choreography (lib/rpg/strike.ts): hit tiers by quest length,
// the hero's three attacks and his flinch timing, against the real hero
// manifest.
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
const anims = hero.animations;
const { BOSS_ATTACK_IMPACT_MS, HURT_PEAK_FRAME } = await importTs(
  fileURLToPath(new URL("../lib/rpg/hero-stage.ts", import.meta.url)),
);

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

test("three attacks — chop, thrust, slash — each its own animation", () => {
  const variants = strike.STRIKE_VARIANTS;
  assert.deepEqual(variants.map((v) => v.animation), ["chop", "thrust", "slash"]);
  for (const v of variants) {
    const anim = anims[v.animation];
    assert.ok(anim, `${v.name}: hero manifest has "${v.animation}"`);
    assert.equal(anim.loop, false, `${v.name}: one-shot`);
    assert.ok(v.contact > 0 && v.contact < anim.frames.length, `${v.name}: contact inside the swing`);
  }
});

test("contact frames are the sheet's (thrust and slash skip sheet frames 1–2)", () => {
  // Sheet frame numbers (0-based, per row) the user specified: chop 6, thrust 6, slash 7.
  const sheetFrame = { chop: 6, thrust: 6, slash: 7 };
  const dropped = { chop: 0, thrust: 2, slash: 2 };
  for (const v of strike.STRIKE_VARIANTS) {
    assert.equal(v.contact + dropped[v.animation], sheetFrame[v.animation], v.name);
    assert.equal(anims[v.animation].frames.length, 9 - dropped[v.animation], `${v.name}: frame count`);
  }
});

test("each swing's contact frame is on screen at the moment of impact", () => {
  for (const v of strike.STRIKE_VARIANTS) {
    const anim = anims[v.animation];
    const contactFrame = anim.frames[v.contact];
    // First hit (after the 280ms dash), a combo hit (no lead), and a long lead.
    for (const lead of [280, 0, 50, 99, 100, 1000]) {
      const timed = strike.contactAnimation(anim, v.contact, lead);
      assert.equal(frameAt(timed, lead), contactFrame, `${v.name} at ${lead}ms`);
    }
  }
});

test("a first hit shows some wind-up before contact", () => {
  for (const v of strike.STRIKE_VARIANTS) {
    const timed = strike.contactAnimation(anims[v.animation], v.contact, 280);
    const contactAt = timed.frames.indexOf(anims[v.animation].frames[v.contact]);
    assert.ok(contactAt >= 3, `${v.name}: ${contactAt} wind-up frames`);
  }
});

test("a timed swing keeps the manifest's canvas, anchor and facing (feet stay planted)", () => {
  for (const v of strike.STRIKE_VARIANTS) {
    const anim = anims[v.animation];
    const timed = strike.contactAnimation(anim, v.contact, 280);
    assert.deepEqual(
      { w: timed.width, h: timed.height, anchor: timed.anchor, facing: timed.facing, fps: timed.fps, loop: timed.loop },
      { w: anim.width, h: anim.height, anchor: anim.anchor, facing: anim.facing, fps: anim.fps, loop: false },
    );
    for (const f of timed.frames) assert.ok(anim.frames.includes(f));
  }
});

test("the hurt flinch peaks (sheet frame 5) as the boss's blow lands", () => {
  const hurt = strike.contactAnimation(anims.hurt, HURT_PEAK_FRAME, BOSS_ATTACK_IMPACT_MS);
  assert.equal(frameAt(hurt, BOSS_ATTACK_IMPACT_MS), anims.hurt.frames[5]);
  // …and still recovers to idle afterwards (sheet frames 6–8).
  assert.deepEqual(hurt.frames.slice(-3), anims.hurt.frames.slice(6));
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
  assert.ok(lunge.keyframes.every((k) => k.translate.endsWith(" 0")), "horizontal only");
  const peak = lunge.keyframes.find((k) => Math.abs((k.offset ?? -1) - 280 / lunge.duration) < 1e-9);
  assert.ok(peak, "furthest forward exactly at contact");
  assert.match(peak.translate, /^\d+px 0$/);
  assert.equal(lunge.keyframes.at(-1).translate, "0 0", "settles back");
  const offsets = lunge.keyframes.map((k) => k.offset).filter((o) => o !== undefined);
  assert.deepEqual(offsets, [...offsets].sort((a, b) => a - b), "offsets in order");
});

// --- Boss attacks -------------------------------------------------------------------

test("a boss attack with a contact frame lands its blow as the lunge peaks", () => {
  const slime = JSON.parse(
    readFileSync(fileURLToPath(new URL("../components/rpg/sprites/manifests/trash_bag_slime.json", import.meta.url)), "utf8"),
  ).animations.attack;
  assert.equal(slime.contact, 5, "the slime's manifest marks its contact frame");
  const played = strike.bossAttackAnimation(slime);
  assert.equal(frameAt(played, BOSS_ATTACK_IMPACT_MS), slime.frames[slime.contact], "contact on screen at the impact");
  assert.equal(played.loop, false);
  // Everything from contact on still plays (the recovery isn't cut).
  assert.deepEqual(played.frames.slice(-(slime.frames.length - slime.contact)), slime.frames.slice(slime.contact));
});

test("a boss attack without a contact frame plays as drawn", () => {
  const anim = { frames: ["a", "b", "c"], fps: 6, loop: true, width: 1, height: 1, anchor: { x: 0, y: 0 }, facing: "left" };
  const played = strike.bossAttackAnimation(anim);
  assert.deepEqual(played.frames, anim.frames);
  assert.equal(played.loop, false);
});
