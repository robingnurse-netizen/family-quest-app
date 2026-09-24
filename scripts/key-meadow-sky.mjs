#!/usr/bin/env node
// Cuts the flat sky out of the battle arena's meadow art, once, as a static
// file: assets/bg-meadow-day-final.png → public/backgrounds/meadow-day.png,
// every pixel within KEY_TOLERANCE of the sky colour (#a3cddb, per channel)
// made transparent. The arena's own day/night sky layers show through
// (components/rpg/battle/arena-backdrop.tsx). This used to be a canvas pass
// in the browser on every page load, which left a visible gap (sky only,
// no hills) until it finished.
//
//   node scripts/key-meadow-sky.mjs
//
// Re-run after editing the meadow art; tests/meadow-key.test.mjs checks the
// public file is the current art with exactly its sky removed.

import sharp from "sharp";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const MEADOW_SOURCE = join(ROOT, "assets", "bg-meadow-day-final.png");
export const MEADOW_PUBLIC = join(ROOT, "public", "backgrounds", "meadow-day.png");
/** The meadow art's flat sky colour (#a3cddb). */
export const SKY_KEY = [163, 205, 219];
/** Per-channel slack for the key (no other colour in the art is within 40). */
export const KEY_TOLERANCE = 4;

export const isSky = (r, g, b) =>
  Math.abs(r - SKY_KEY[0]) <= KEY_TOLERANCE &&
  Math.abs(g - SKY_KEY[1]) <= KEY_TOLERANCE &&
  Math.abs(b - SKY_KEY[2]) <= KEY_TOLERANCE;

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { data, info } = await sharp(MEADOW_SOURCE).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let keyed = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (isSky(data[i], data[i + 1], data[i + 2])) {
      data[i + 3] = 0;
      keyed++;
    }
  }
  // Lossless (a palette PNG could shift the art's colours).
  await sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } })
    .png({ compressionLevel: 9 })
    .toFile(MEADOW_PUBLIC);
  console.log(`${MEADOW_PUBLIC}: ${info.width}×${info.height}, ${keyed} sky pixels made transparent`);
}
