// Rogue's PixelLab art (assets/rogue-pixellab.png → public/sprites/rogue):
// the manifest, his timing against the hero's blows and swings, and how his
// poses follow the hero's (lib/rpg/hero-stage.ts roguePoseFor).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { importTs } from "./helpers/load-ts.mjs";

const strike = await importTs(fileURLToPath(new URL("../lib/rpg/strike.ts", import.meta.url)));
const stage = await importTs(fileURLToPath(new URL("../lib/rpg/hero-stage.ts", import.meta.url)));
const read = (name) =>
  JSON.parse(readFileSync(fileURLToPath(new URL(`../components/rpg/sprites/manifests/${name}.json`, import.meta.url)), "utf8"));
const rogue = read("rogue").animations;
const hero = read("hero").animations;

/** The frame a (one-shot) animation shows `ms` after it starts. */
const frameAt = (anim, ms) => anim.frames[Math.min(anim.frames.length - 1, Math.floor((ms * anim.fps) / 1000))];

test("rogue manifest: every sheet row the game uses, plus the front-facing ones kept for later", () => {
  assert.deepEqual(Object.keys(rogue).sort(), ["bark", "bark_front", "hurt", "idle", "idle_front", "ko", "pounce"]);
  const facing = Object.fromEntries(Object.entries(rogue).map(([k, a]) => [k, a.facing]));
  assert.deepEqual(facing, {
    idle: "right", bark: "right", hurt: "right", pounce: "right", ko: "right",
    bark_front: "front", idle_front: "front",
  });
  assert.deepEqual(
    Object.fromEntries(Object.entries(rogue).map(([k, a]) => [k, a.frames.length])),
    { idle: 9, bark: 9, hurt: 9, pounce: 9, ko: 9, bark_front: 6, idle_front: 8 },
  );
  assert.equal(rogue.idle.loop, true);
  for (const k of ["bark", "hurt", "pounce", "ko"]) assert.equal(rogue[k].loop, false, k);
});

test("his idle runs at the hero's idle pace", () => {
  assert.equal(rogue.idle.fps, hero.idle.fps);
  const loopMs = (rogue.idle.frames.length / rogue.idle.fps) * 1000;
  assert.ok(loopMs >= 1200 && loopMs <= 2000, `${loopMs}ms per loop`);
});

test("no height jump between his idle and his action poses (same standing body)", () => {
  // The standing body (each row's frame 0) is the same height in every
  // right-facing row — and he's scaled from it.
  for (const k of ["idle", "bark", "hurt", "pounce", "ko"]) assert.equal(rogue[k].bodyHeight, rogue.idle.bodyHeight, k);
});

test("his pounce lands its contact frame (sheet 6) at impact, with the hero's swing", () => {
  assert.equal(strike.ROGUE_POUNCE_CONTACT, 6);
  const contact = rogue.pounce.frames[6];
  for (const lead of [280, 0, 50, 99, 1000]) {
    const timed = strike.contactAnimation(rogue.pounce, strike.ROGUE_POUNCE_CONTACT, lead);
    assert.equal(frameAt(timed, lead), contact, `lead ${lead}ms`);
  }
  // A first hit shows the leap building up, not just the landing.
  const first = strike.contactAnimation(rogue.pounce, 6, 280);
  assert.ok(first.frames.indexOf(contact) >= 3);
});

test("his hurt peaks (sheet frame 5) on the same blow as the hero's", () => {
  const at = stage.BOSS_ATTACK_IMPACT_MS;
  const rogueHurt = strike.contactAnimation(rogue.hurt, stage.ROGUE_HURT_PEAK_FRAME, at);
  const heroHurt = strike.contactAnimation(hero.hurt, stage.HURT_PEAK_FRAME, at);
  assert.equal(frameAt(rogueHurt, at), rogue.hurt.frames[5]);
  assert.equal(frameAt(heroHurt, at), hero.hurt.frames[5]);
  assert.deepEqual(rogueHurt.frames.slice(-3), rogue.hurt.frames.slice(6), "then recovers");
});

test("he falls, lies and gets up at the hero's pace", () => {
  const ms = (a) => (a.frames.length / a.fps) * 1000;
  assert.equal(ms(rogue.ko), ms(hero.ko));
  assert.equal(ms(rogue.bark), ms(hero.victory), "his bark lasts as long as the victory pose");
});

test("Rogue's pose follows the hero's", () => {
  const map = Object.fromEntries(
    ["idle", "attack", "hurt", "ko", "down", "rise", "victory"].map((p) => [p, stage.roguePoseFor(p)]),
  );
  assert.deepEqual(map, {
    idle: "idle", attack: "idle", hurt: "hurt", ko: "ko", down: "down", rise: "rise", victory: "bark",
  });
  for (const p of ["ko", "down", "rise"]) assert.ok(stage.isDownPose(p), p);
  for (const p of ["idle", "hurt", "bark"]) assert.ok(!stage.isDownPose(p), p);
});

// --- Frames -------------------------------------------------------------------------------

const sharp = createRequire(import.meta.url)("sharp");
async function lowestRow(path) {
  const { data, info } = await sharp(fileURLToPath(new URL(`../public${path}`, import.meta.url)))
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  for (let y = info.height - 1; y >= 0; y--) {
    for (let x = 0; x < info.width; x++) if (data[(y * info.width + x) * 4 + 3]) return y;
  }
  return -1;
}

test("no Rogue frame sinks below his ground line; lying flat he rests on it", async () => {
  for (const [name, a] of Object.entries(rogue)) {
    for (const [i, frame] of a.frames.entries()) {
      assert.ok((await lowestRow(frame)) <= a.anchor.y, `${name} frame ${i + 1}`);
    }
  }
  assert.equal(await lowestRow(rogue.ko.frames.at(-1)), rogue.ko.anchor.y);
});

test("his idle's first frame is pixel for pixel his action rows' first frame, on the same feet", async () => {
  const pixels = async (anim) => {
    const { data, info } = await sharp(fileURLToPath(new URL(`../public${anim.frames[0]}`, import.meta.url)))
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const out = new Set();
    for (let y = 0; y < info.height; y++) {
      for (let x = 0; x < info.width; x++) {
        const i = (y * info.width + x) * 4;
        // Relative to the feet anchor, so different canvases compare.
        if (data[i + 3]) out.add(`${x - anim.anchor.x},${y - anim.anchor.y},${data.readUInt32BE(i)}`);
      }
    }
    return out;
  };
  const idle = await pixels(rogue.idle);
  for (const k of ["bark", "hurt", "pounce", "ko"]) assert.deepEqual(await pixels(rogue[k]), idle, k);
});
