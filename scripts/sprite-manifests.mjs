#!/usr/bin/env node
// Finishes the sprite manifests (components/rpg/sprites/manifests/<key>.json)
// from the frame PNGs, without re-slicing anything: VERSIONED FRAME URLS —
// every frame path gets ?v=<first 10 hex of the file's SHA-256>. /sprites is
// served with a one-year immutable cache (next.config.ts), so a browser
// downloads each frame once and never re-asks; new art means a new hash, so
// a new URL.
//
//   node scripts/sprite-manifests.mjs              # every manifest
//   node scripts/sprite-manifests.mjs hero rogue   # just these
//
// scripts/slice-sprites.mjs runs it for the characters it slices. Run it
// by hand after editing any frame PNG (the hash — so the URL — changes).
// (It used to write each animation's ground `shadow` map too; the drawn
// ground shadows are gone, and it removes any left in a manifest.)

import { createHash } from "node:crypto";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PUBLIC = join(ROOT, "public");
const MANIFESTS = join(ROOT, "components", "rpg", "sprites", "manifests");

/** A frame URL without its ?v= version (the file's path under public/). */
export const framePath = (url) => url.split("?")[0];

/** The frame URL with its content version: /sprites/…/frame-01.png?v=… */
export function versionedFrame(url) {
  const path = framePath(url);
  const hash = createHash("sha256").update(readFileSync(join(PUBLIC, path))).digest("hex").slice(0, 10);
  return `${path}?v=${hash}`;
}

/** Version the frame URLs, in place. */
export function finishManifest(key) {
  const path = join(MANIFESTS, `${key}.json`);
  const manifest = JSON.parse(readFileSync(path, "utf8"));
  for (const anim of Object.values(manifest.animations)) {
    anim.frames = anim.frames.map(versionedFrame);
    delete anim.shadow;
  }
  writeFileSync(path, JSON.stringify(manifest, null, 2) + "\n");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const only = process.argv.slice(2);
  const keys = only.length
    ? only
    : readdirSync(MANIFESTS).filter((f) => f.endsWith(".json")).map((f) => f.replace(/\.json$/, ""));
  for (const key of keys) {
    finishManifest(key);
    console.log(`${key}: frame versions written`);
  }
}
