// The hero's pose machine (lib/rpg/hero-stage.ts) and his sliced sprite
// frames (public/sprites/hero, from assets/hero-pixellab.png).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { importTs } from "./helpers/load-ts.mjs";

const { heroReducer, initialHero } = await importTs(fileURLToPath(new URL("../lib/rpg/hero-stage.ts", import.meta.url)));

const miss = { type: "event", event: { type: "miss", bossId: "b", amount: 30, childId: "c", slotId: null, at: "" } };
const damage = (variant = 1) => ({
  type: "event",
  event: { type: "damage", bossId: "b", amount: 15, childId: "c", slotId: null, at: "" },
  variant,
});
const defeated = { type: "event", event: { type: "defeated", boss: { id: "b" } } };
const party = (hp) => ({ type: "event", event: { type: "party", hp, max: 100 } });
const run = (actions, state = initialHero(100)) => actions.reduce(heroReducer, state);

// --- Reactions ------------------------------------------------------------------------

test("damage plays the picked attack, then back to idle", () => {
  const s = run([damage(2)]);
  assert.equal(s.pose, "attack");
  assert.equal(s.variant, 2);
  assert.equal(run([{ type: "end" }], s).pose, "idle");
});

test("every new reaction restarts the animation (key bumps)", () => {
  const a = run([damage()]);
  const b = run([damage()], a);
  assert.equal(b.pose, "attack");
  assert.ok(b.key > a.key);
});

test("a missed quest plays hurt", () => {
  const s = run([miss]);
  assert.equal(s.pose, "hurt");
  assert.equal(run([{ type: "end" }], s).pose, "idle");
});

// --- Knocked out ----------------------------------------------------------------------

test("party at 0 knocks him out; he stays down, holding the last frame", () => {
  let s = run([party(0)]);
  assert.equal(s.pose, "ko");
  const key = s.key;
  s = run([{ type: "end" }], s);
  assert.equal(s.pose, "down");
  assert.equal(s.key, key, "no restart: the K.O. holds its last frame");
  // Down: no attacks, flinches or cheering.
  for (const a of [damage(), miss, defeated]) assert.equal(run([a], s).pose, "down");
});

test("the nightly wipe: flinch first, then fall, then (after the hold) get up", () => {
  // miss → party 0 → party refilled, all arriving back to back.
  let s = run([miss, party(0), party(100)]);
  assert.equal(s.pose, "hurt", "the flinch plays out first");
  assert.equal(s.pendingKo, true);
  s = run([{ type: "end" }], s);
  assert.equal(s.pose, "ko");
  s = run([{ type: "end" }], s);
  assert.equal(s.pose, "down");
  assert.equal(s.pendingRise, true, "the scene stands him up after DOWN_HOLD_MS");
  s = run([{ type: "rise" }], s);
  assert.equal(s.pose, "rise");
  assert.equal(s.pendingRise, false);
  s = run([{ type: "end" }], s);
  assert.equal(s.pose, "idle");
});

test("refilled while already down: stand up; not refilled: stay down", () => {
  const down = run([party(0), { type: "end" }]);
  assert.equal(down.pendingRise, false);
  assert.equal(run([{ type: "rise" }], down).pose, "down", "no rise without a refill");
  const refilled = run([party(100)], down);
  assert.equal(refilled.pendingRise, true);
  assert.equal(run([{ type: "rise" }], refilled).pose, "rise");
});

test("HP changes above 0 don't knock him out; loading at 0 starts him down", () => {
  assert.equal(run([party(40), party(10)]).pose, "idle");
  assert.equal(initialHero(0).pose, "down");
  assert.equal(run([party(100)], initialHero(0)).pendingRise, true);
});

// --- Victory --------------------------------------------------------------------------

test("a boss falls: victory, held until the next boss takes the stage", () => {
  let s = run([defeated]);
  assert.equal(s.pose, "victory");
  assert.equal(run([{ type: "end" }], s).pose, "victory", "holds the last frame");
  s = run([{ type: "swap" }], s);
  assert.equal(s.pose, "idle");
});

test("the final blow's attack finishes before the victory pose", () => {
  let s = run([damage(), defeated]);
  assert.equal(s.pose, "attack");
  s = run([{ type: "end" }], s);
  assert.equal(s.pose, "victory");
});

test("a swap before the queued victory plays cancels it", () => {
  const s = run([damage(), defeated, { type: "swap" }, { type: "end" }]);
  assert.equal(s.pose, "idle");
});

// --- Sprite frames ----------------------------------------------------------------------

const sharp = createRequire(import.meta.url)("sharp");
const manifest = JSON.parse(
  readFileSync(fileURLToPath(new URL("../components/rpg/sprites/manifests/hero.json", import.meta.url)), "utf8"),
);

/** Lowest opaque row of a frame PNG. */
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

test("hero manifest: the poses the game plays, all facing right", () => {
  assert.deepEqual(Object.keys(manifest.animations).sort(), ["chop", "hurt", "idle", "ko", "slash", "thrust", "victory"]);
  for (const [name, a] of Object.entries(manifest.animations)) assert.equal(a.facing, "right", name);
  assert.equal(manifest.animations.idle.loop, true);
  assert.equal(manifest.animations.idle.frames.length, 8);
});

test("no hero frame sinks below his ground line (the K.O. lies on it, not in it)", async () => {
  for (const [name, a] of Object.entries(manifest.animations)) {
    for (const [i, frame] of a.frames.entries()) {
      assert.ok((await lowestRow(frame)) <= a.anchor.y, `${name} frame ${i + 1}`);
    }
  }
  // Lying flat, he rests exactly on the line.
  const ko = manifest.animations.ko;
  assert.equal(await lowestRow(ko.frames.at(-1)), ko.anchor.y);
});
