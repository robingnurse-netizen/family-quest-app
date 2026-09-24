// Grounding: in every grounded frame, a character's lowest opaque pixel sits
// exactly on its ground line (the manifest anchor's y — drawn on the top of
// the grass) — no floating above it, no sinking below it. Frames an
// animation lists as `airborne` (jumps, a pounce, a mid-fall frame, flying,
// hovering) are exempt from floating, but still may not sink. Checked frame
// by frame for the hero, Rogue and every boss (scripts/slice-sprites.mjs
// grounds them; scripts/sprite-shadows.mjs records the same lift).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const sharp = createRequire(import.meta.url)("sharp");
const CHARACTERS = [
  "hero", "rogue", "trash_bag_slime", "alarm_clock_swarm", "laundry_goblin", "cable_spider",
  "magma_behemoth", "chronosphinx", "abyssal_kraken", "shogun_bot",
];
const manifest = (key) =>
  JSON.parse(readFileSync(fileURLToPath(new URL(`../components/rpg/sprites/manifests/${key}.json`, import.meta.url)), "utf8"));

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

for (const key of CHARACTERS) {
  test(`${key}: grounded frames sit exactly on the ground line; none sink`, async () => {
    for (const [name, anim] of Object.entries(manifest(key).animations)) {
      const airborne = new Set(anim.airborne ?? []);
      for (const [i, frame] of anim.frames.entries()) {
        const low = await lowestRow(frame);
        assert.ok(low <= anim.anchor.y, `${name} frame ${i}: sinks ${low - anim.anchor.y}px below the line`);
        if (!airborne.has(i)) {
          assert.equal(low, anim.anchor.y, `${name} frame ${i}: floats ${anim.anchor.y - low}px above the line`);
        }
        // The shadow data agrees.
        assert.equal(anim.shadow[frame][2], anim.anchor.y - low, `${name} frame ${i}: shadow lift`);
      }
    }
  });
}

test("the airborne exemptions are the deliberate ones", () => {
  const exempt = {};
  for (const key of CHARACTERS) {
    for (const [name, anim] of Object.entries(manifest(key).animations)) {
      if (anim.airborne?.length) exempt[`${key}/${name}`] = anim.airborne;
    }
  }
  assert.deepEqual(exempt, {
    "hero/ko": [5], // mid-fall
    "hero/victory": [3, 4, 5], // the hop
    "rogue/pounce": [3, 4, 5, 6, 7], // the leap
    "rogue/bark_front": [1, 2, 3, 4, 5], // a hop while barking (not used yet)
    "alarm_clock_swarm/attack": [0], // a clock flying at the party
    "chronosphinx/idle": [0, 1, 2, 3], // hovers; the scythe swings below it
    "abyssal_kraken/move": [0, 1, 2, 3, 4, 5], // hovers
    "abyssal_kraken/attack": [3], // springs up
    "abyssal_kraken/defeated": [1], // blown off the ground
  });
});
