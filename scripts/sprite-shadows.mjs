#!/usr/bin/env node
// Ground shadows for every sprite frame, measured from the frame PNGs and
// written into the manifests (components/rpg/sprites/manifests/<key>.json)
// as each animation's `shadow`: frame path → [centreX, width, lift, band],
// in canvas pixels. AnchoredSprite draws a soft ellipse from it where the
// character meets the ground, frame by frame (smaller and fainter while
// airborne).
//
//   node scripts/sprite-shadows.mjs              # every manifest
//   node scripts/sprite-shadows.mjs hero rogue   # just these
//
// Reads frames only — never re-slices them. scripts/slice-sprites.mjs runs
// it for the characters it slices, so re-slicing keeps shadows current.
//
// Per frame: the footprint is every column whose lowest opaque pixel lies in
// the frame's bottom band (the lowest ~12% of the canvas, at least 4 rows):
// all the feet when standing — the far ones drawn higher in three-quarter
// view too — or the whole body when lying down. centreX and width are its
// extent (+10% padding); band is how tall it is, from the highest of those
// column bottoms down to the lowest pixel — the contact band the shadow
// covers, so every foot (or a lying body) visibly meets it. lift is how far
// the frame's lowest pixel is above the ground line (anchor.y): 0 when
// grounded, more in a jump. Airborne frames (the manifest's `airborne`)
// keep the animation's first-frame band: their shadow stays on the ground.

import sharp from "sharp";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PUBLIC = join(ROOT, "public");
const MANIFESTS = join(ROOT, "components", "rpg", "sprites", "manifests");

/** [centreX, width, lift, band] for one frame, in canvas pixels. */
export async function frameShadow(file, anchorY) {
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width: W, height: H } = info;
  // Each column's lowest opaque pixel (-1: empty column).
  const bottoms = Array.from({ length: W }, (_, x) => {
    for (let y = H - 1; y >= 0; y--) if (data[(y * W + x) * 4 + 3] > 0) return y;
    return -1;
  });
  const low = Math.max(...bottoms);
  if (low < 0) return [W / 2, 0, 0, 0];
  const bandRows = Math.max(4, Math.round(H * 0.12));
  const feet = bottoms.map((b, x) => [b, x]).filter(([b]) => b >= 0 && b > low - bandRows);
  const minX = Math.min(...feet.map(([, x]) => x));
  const maxX = Math.max(...feet.map(([, x]) => x));
  const top = Math.min(...feet.map(([b]) => b));
  return [
    +((minX + maxX + 1) / 2).toFixed(1),
    +((maxX - minX + 1) * 1.1).toFixed(1),
    Math.max(0, anchorY - low),
    low - top + 1,
  ];
}

/** The `shadow` map for one manifest animation. */
export async function animationShadows(anim) {
  const shadow = {};
  const airborne = new Set(anim.airborne ?? []);
  let firstBand = null;
  for (const [i, frame] of anim.frames.entries()) {
    const s = await frameShadow(join(PUBLIC, frame), anim.anchor.y);
    firstBand ??= s[3];
    if (airborne.has(i)) s[3] = firstBand;
    shadow[frame] = s;
  }
  return shadow;
}

/** Add shadows to a manifest file in place. */
export async function writeManifestShadows(key) {
  const path = join(MANIFESTS, `${key}.json`);
  const manifest = JSON.parse(readFileSync(path, "utf8"));
  for (const anim of Object.values(manifest.animations)) anim.shadow = await animationShadows(anim);
  writeFileSync(path, JSON.stringify(manifest, null, 2) + "\n");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const only = process.argv.slice(2);
  const keys = only.length
    ? only
    : readdirSync(MANIFESTS).filter((f) => f.endsWith(".json")).map((f) => f.replace(/\.json$/, ""));
  for (const key of keys) {
    await writeManifestShadows(key);
    console.log(`${key}: shadows written`);
  }
}
