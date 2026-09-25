// Grounding: in every grounded frame, a character's lowest opaque pixel sits
// exactly on its ground line (the manifest anchor's y — drawn on the top of
// the grass) — no floating above it, no sinking below it. Frames an
// animation lists as `airborne` (jumps, a pounce, a mid-fall frame, flying,
// hovering) are exempt from floating, but still may not sink. Checked frame
// by frame for the hero, Rogue and every boss (scripts/slice-sprites.mjs
// grounds them).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const sharp = createRequire(import.meta.url)("sharp");
const CHARACTERS = [
  "hero", "rogue", "trash_bag_slime", "alarm_clock_swarm", "laundry_goblin", "cable_spider",
  "swamp_bag_ooze", "tupperware_troll", "scatter_brick_serpent", "mud_track_minotaur",
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
    "trash_bag_slime/attack": [4, 5], // the hopping lunge
    "trash_bag_slime/move": [4], // a small hop
    // A ring of flying clocks: hovers above its shared ground line
    // (frame 0 of every row 4px up); only the death's heap lands (7–8).
    "alarm_clock_swarm/idle": [0, 1, 2, 3, 4, 5, 6, 7, 8],
    "alarm_clock_swarm/attack": [0, 1, 2, 3, 4, 5, 6, 7, 8],
    "alarm_clock_swarm/hurt": [0, 1, 2, 3, 4, 5, 6, 7, 8],
    "alarm_clock_swarm/death": [0, 1, 2, 3, 4, 5, 6],
    "alarm_clock_swarm/move": [0, 1, 2, 3, 4, 5, 6, 7, 8],
    "laundry_goblin/attack": [5, 6, 7], // a small lunge hop with the sock
    "laundry_goblin/hurt": [3, 4, 5, 6, 7], // knocked back in a hop
    "cable_spider/attack": [3, 4, 5, 6, 7], // the pounce
    // The winged sphinx hovers above its shared ground line (frame 0 of
    // every row 8px up); only the death's landing (7–8) touches it.
    "chronosphinx/idle": [0, 1, 2, 3, 4, 5, 6, 7, 8],
    "chronosphinx/attack": [0, 1, 2, 3, 4, 5, 6, 7, 8],
    "chronosphinx/hurt": [0, 1, 2, 3, 4, 5, 6, 7, 8],
    "chronosphinx/death": [0, 1, 2, 3, 4, 5, 6],
    "chronosphinx/move": [0, 1, 2, 3, 4, 5, 6, 7, 8],
    // The octopus floats the same way (frame 0 8px up); the death's
    // sprawl (7–8) lands.
    "abyssal_kraken/idle": [0, 1, 2, 3, 4, 5, 6, 7, 8],
    "abyssal_kraken/attack": [0, 1, 2, 3, 4, 5, 6, 7, 8],
    "abyssal_kraken/hurt": [0, 1, 2, 3, 4, 5, 6, 7, 8],
    "abyssal_kraken/death": [0, 1, 2, 3, 4, 5, 6],
    "abyssal_kraken/move": [0, 1, 2, 3, 4, 5, 6, 7, 8],
  });
});
