#!/usr/bin/env node
// One-off sprite pipeline: slices the AI-generated sheets in /assets into
// per-frame transparent PNGs and writes one manifest per character.
//
//   node scripts/slice-sprites.mjs            # all characters
//   node scripts/slice-sprites.mjs hero rogue # just these
//
// Output:
//   public/sprites/<character>/<animation>/frame-NN.png
//   components/rpg/sprites/manifests/<character>.json
//
// How it works (per animation row):
//   1. Background removal by flood fill from the row's edges through
//      "background-coloured" pixels (a flat colour, or paper + grid-line
//      colour for grid-paper sheets). Flood fill stops at the sprites' dark
//      outlines, so interior colours close to the background survive.
//      Enclosed background pockets (e.g. paper showing between cables) above
//      a size threshold are removed too.
//   2. Connected components. Each component is assigned to the frame whose
//      x-range holds most of its pixels, so a sword or beam that pokes into
//      the neighbouring cell stays with its owner. A component with a large
//      share of pixels on both sides of a split (frames that physically touch)
//      is cut at the split instead.
//   3. Frames are aligned horizontally on the main body's feet (bottom rows
//      of the largest component) and keep their vertical position within the
//      row (so jumps still rise), then padded to one shared canvas per
//      animation.
//
// Coordinates are in source-sheet pixels and were measured from the sheets;
// they're the thing to tweak if a crop looks wrong.
//
// GROUNDING (both kinds of sheet): every frame's lowest opaque pixel is put
// exactly on the ground line, frame by frame, except frames an animation
// lists as `airborne` (indices into its sliced frames: jumps, leaps,
// flying, hovering) — tests/grounding.test.mjs checks every manifest.
// Frame URLs in the manifests carry a content hash (?v=…, added by
// scripts/sprite-manifests.mjs) for long-lived caching.
//
// Grid sheets (`grid: { cell }`: transparent, one frame per cell, e.g. the
// PixelLab hero) skip all of the above: see sliceGridAnimation.

import sharp from "sharp";
import { finishManifest } from "./sprite-manifests.mjs";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const ASSETS = join(ROOT, "assets");
const OUT_PUBLIC = join(ROOT, "public", "sprites");
const OUT_MANIFESTS = join(ROOT, "components", "rpg", "sprites", "manifests");

const PAD = 4; // transparent padding around each animation's canvas
const HOLE_MIN = 150; // enclosed background pockets larger than this are removed
const MIN_COMPONENT = 30; // specks smaller than this (JPEG noise) are dropped
const CUT_SHARE = 0.2; // a component with ≥20% of its pixels on each side of a split is cut

// Playback defaults per animation name (overridable per animation).
const PLAYBACK = {
  idle: { fps: 6, loop: true },
  move: { fps: 8, loop: true },
  attack: { fps: 10, loop: false },
  bark: { fps: 10, loop: false },
  bark_front: { fps: 10, loop: false },
  pounce: { fps: 12, loop: false },
  idle_front: { fps: 4, loop: true },
  hurt: { fps: 8, loop: false },
  chop: { fps: 10, loop: false },
  thrust: { fps: 10, loop: false },
  slash: { fps: 10, loop: false },
  ko: { fps: 10, loop: false },
  victory: { fps: 10, loop: false },
  death: { fps: 6, loop: false },
  defeated: { fps: 8, loop: false },
};

// ---------------------------------------------------------------------------
// Sheet config
// ---------------------------------------------------------------------------
// bg: [paperRGB, lineRGB] — background is anything close to the segment
// between them. tol: max RGB distance from that segment.
// Each animation: y0/y1 row band, splits (frame boundaries, N+1 values),
// optional exclude rects (labels inside the band), assign rects (components
// whose centre falls inside go to the given 0-based frame, for effects that
// sit over a neighbour's column) and dropBottom (removes small components
// sitting entirely in the band's bottom strip — frame numbers). A character
// spread over several rows lists several bands. dropFrames (1-based, in
// sheet order) leaves frames out of an animation.

const SHEETS = [
  {
    // PixelLab export: a transparent grid of 112×112 cells, 9 columns × 8
    // rows, no labels or background. Grid animations take a `row` and an
    // optional `frames` list (0-based columns; default: every non-empty
    // cell). Column 0 of every action row is his idle pose, the reference
    // the row's feet anchor is measured from. Row 0 (static rotations) isn't
    // used in game.
    file: "hero-pixellab.png",
    grid: { cell: 112 },
    characters: {
      hero: {
        idle: { row: 7 },
        // Attacks (lib/rpg/strike.ts STRIKE_VARIANTS holds each contact frame).
        chop: { row: 1, fps: 16 },
        // Columns 1–2 are near-identical to idle and make the start sluggish.
        thrust: { row: 2, frames: [0, 3, 4, 5, 6, 7, 8], fps: 16 },
        slash: { row: 4, frames: [0, 3, 4, 5, 6, 7, 8], fps: 16 },
        hurt: { row: 5, fps: 12 },
        // Falls forward onto his face; the last frames lie flat. Frame 5 is
        // mid-fall (off the ground).
        ko: { row: 3, fps: 10, airborne: [5] },
        // The victory hop: frames 3–5 in the air.
        victory: { row: 6, fps: 10, airborne: [3, 4, 5] },
      },
    },
  },
  {
    // PixelLab export: 96×96 cells, 9 columns × 8 rows, transparent. Row 0
    // (static rotations) isn't used in game. The in-game rows face right
    // (three-quarter view); the "_front" rows face the viewer and aren't
    // used yet (kept for later).
    file: "rogue-pixellab.png",
    grid: { cell: 96 },
    characters: {
      rogue: {
        // Breathing and a slow tail wag (the tail rises in frames 4–5), at
        // the hero's idle pace. Same proportions as the action rows (its
        // frame 0 is their frame 0).
        idle: { row: 5, fps: 6 },
        // His victory cheer.
        bark: { row: 1, fps: 10 },
        hurt: { row: 3, fps: 12 },
        // Contact frame 6 (paws furthest forward): see ROGUE_POUNCE_CONTACT.
        // Frames 3–7 are the leap.
        pounce: { row: 6, fps: 12, airborne: [3, 4, 5, 6, 7] },
        // Ends lying flat on his belly, chin down (frames 6–8 lifted 1px).
        ko: { row: 7, fps: 10 },
        // A little hop while barking (frames 1–5 rise off the ground).
        bark_front: { row: 2, fps: 10, airborne: [1, 2, 3, 4, 5] },
        idle_front: { row: 4, fps: 4 },
      },
    },
  },
  {
    // PixelLab export (the boss art redo pilot; docs/pixellab-style.md):
    // 84×84 cells (the v3 animations' canvas around a 64px character),
    // 9 columns, one row per animation, all facing left (south-west, 3/4
    // view). Frame 0 of every row is the standing pose.
    file: "trash-bag-slime-pixellab.png",
    grid: { cell: 84 },
    characters: {
      trash_bag_slime: {
        idle: { row: 0 },
        // Rears up, then a hopping lunge with its tongue out: frames 4–5 are
        // off the ground; contact (furthest reach toward the party) is frame 5.
        // 16 fps: timed to the blow (bossAttackAnimation), it keeps the
        // wind-up from frame 2 (10 fps would start at 3).
        attack: { row: 1, airborne: [4, 5], contact: 5, fps: 16 },
        // Squashes and squints; peak from frame 3 (held to 7), 8 recovers.
        hurt: { row: 2 },
        // Deflates onto its side, the knot flopping over; holds frame 8.
        death: { row: 3 },
        // A small squash-and-hop (frame 4 just leaves the ground); the escape
        // slide does the travelling.
        move: { row: 4, airborne: [4] },
      },
    },
  },
  {
    // PixelLab (docs/pixellab-style.md): 96×96 cells, 9 columns, rows idle /
    // attack / hurt / death / move, facing left (south-west). Assembled from
    // the PixelLab frames with the south-west rotation at the same spot in
    // every cell (frame 0 of every row is that rotation) and stray specks
    // cleaned (see the style guide's record). A ring of six flying clocks:
    // it hovers, so every row shares one ground line, `ground` (cell row 78,
    // the idle bob's lowest point) — each row's frame 0 floats 4px above it.
    file: "alarm-clock-swarm-pixellab.png",
    grid: { cell: 96 },
    characters: {
      alarm_clock_swarm: {
        idle: { row: 0, ground: 78, airborne: [0, 1, 2, 3, 4, 5, 6, 7, 8] },
        // Bunches up tight (frame 3), bursts ringing on contact (frame 4),
        // spreads back out.
        attack: { row: 1, ground: 78, airborne: [0, 1, 2, 3, 4, 5, 6, 7, 8], contact: 4 },
        // Scatters apart and snaps back together; peak spread frame 4.
        hurt: { row: 2, ground: 78, airborne: [0, 1, 2, 3, 4, 5, 6, 7, 8] },
        // Collapses out of the air (frames 0–6 still hovering) and lands as
        // a heap of broken clocks on the ground (7–8; 8 is hand-drawn).
        death: { row: 3, ground: 78, airborne: [0, 1, 2, 3, 4, 5, 6] },
        move: { row: 4, ground: 78, airborne: [0, 1, 2, 3, 4, 5, 6, 7, 8] },
      },
    },
  },
  {
    // PixelLab (docs/pixellab-style.md): 88×88 cells (the v3 canvas around
    // the 64px character), 9 columns, rows idle / attack / hurt / death /
    // move, facing left (south-west); built by
    // scripts/pixellab-helpers/build-boss-sheet.cjs (specks cleaned).
    file: "laundry-goblin-pixellab.png",
    grid: { cell: 88 },
    characters: {
      laundry_goblin: {
        idle: { row: 0 },
        // Raises the wet sock overhead (2–4), whips it down in a splash on
        // contact (frame 5) in a small lunge hop (5–7 off the ground, 3px).
        // 16 fps keeps the raise (like the slime).
        attack: { row: 1, contact: 5, fps: 16, airborne: [5, 6, 7] },
        // Knocked back in a little hop (3–7 off the ground); peak frame 4.
        hurt: { row: 2, airborne: [3, 4, 5, 6, 7] },
        // Topples over backward and lies flat on his back (holds frame 8).
        death: { row: 3 },
        move: { row: 4 },
      },
    },
  },
  {
    // PixelLab, built like the goblin's (88px cells, same rows, facing left).
    // Stands on eight cable legs; every row is grounded by its lowest plug.
    file: "cable-spider-pixellab.png",
    grid: { cell: 88 },
    characters: {
      cable_spider: {
        idle: { row: 0 },
        // Crouches (1–2), pounces left with its front plugs sparking: contact
        // frame 4 (furthest reach); the leap (3–7) is off the ground.
        attack: { row: 1, contact: 4, airborne: [3, 4, 5, 6, 7] },
        // Jolts back, legs splaying, sparks fly (peak 4–5).
        hurt: { row: 2 },
        // Short-circuits, legs buckle and splay (4–6), the body drops flat
        // onto the ground, eyes dark, smoke (holds frame 8: hand-drawn end
        // frame, scripts/pixellab-helpers/spider-heap.cjs).
        death: { row: 3 },
        move: { row: 4 },
      },
    },
  },
  {
    file: "Gemini_Generated_Image_e4486e4486e4486e.jpeg",
    bg: [[78, 84, 92], [86, 86, 94]],
    tol: 40,
    characters: {
      magma_behemoth: {
        idle: {
          y0: 188, y1: 512, splits: [20, 392, 782, 1181, 1585, 2000],
          exclude: [{ x: 0, y: 186, w: 200, h: 54 }], // "IDLE"
        },
        move: {
          y0: 522, y1: 832, splits: [20, 402, 770, 1170, 1560, 1980, 2300],
          exclude: [{ x: 0, y: 518, w: 400, h: 58 }], // "MOVE/WALK"
        },
        attack: {
          y0: 842, y1: 1162, splits: [20, 425, 820, 1310, 1625, 2002, 2380, 2800],
          exclude: [{ x: 0, y: 838, w: 260, h: 56 }], // "ATTACK"
        },
        defeated: { y0: 1216, y1: 1522, splits: [40, 462, 890, 1330, 1800, 2270, 2800] },
      },
    },
  },
  {
    file: "Gemini_Generated_Image_2fyqj12fyqj12fyq.jpeg",
    bg: [[78, 82, 92], [76, 76, 92]],
    tol: 40,
    characters: {
      chronosphinx: {
        idle: {
          y0: 62, y1: 372, splits: [40, 410, 760, 1117, 1560], fps: 3,
          dropBottom: { height: 40, maxArea: 1500 }, // frame numbers
          exclude: [{ x: 1273, y: 345, w: 24, h: 24 }], // "4" touching the scythe tip
          // Hovers: the body stays at one height while the scythe swings
          // below it — grounding by the lowest pixel would bob it ~30px.
          airborne: [0, 1, 2, 3],
        },
        move: {
          y0: 376, y1: 758, splits: [0, 430, 916, 1395, 1865, 2322, 2800],
          exclude: [{ x: 0, y: 372, w: 800, h: 51 }], // "MOVE/HOVER - SIDE PROFILE VIEW"
          dropBottom: { height: 40, maxArea: 1500 },
        },
        attack: {
          y0: 762, y1: 1097, splits: [0, 345, 700, 1100, 1395, 1785, 2105, 2455, 2816],
          exclude: [{ x: 0, y: 758, w: 560, h: 50 }], // "ATTACK - 3/4 FRONT VIEW"
        },
        // Numbered 1–7, 9, 10 on the sheet (there is no "8"): 9 frames.
        defeated: { y0: 1188, y1: 1493, splits: [0, 310, 612, 901, 1190, 1500, 1837, 2175, 2485, 2816] },
      },
    },
  },
  {
    file: "Gemini_Generated_Image_hgc2iehgc2iehgc2.jpeg",
    bg: [[77, 86, 101], [158, 176, 190]],
    tol: 30,
    characters: {
      abyssal_kraken: {
        idle: {
          y0: 92, y1: 478, splits: [0, 475, 940, 1407, 1875, 2340, 2816],
          exclude: [{ x: 0, y: 90, w: 120, h: 40 }], // "IDLE"
        },
        move: {
          y0: 508, y1: 776, splits: [0, 463, 922, 1389, 1848, 2325, 2816],
          exclude: [{ x: 0, y: 506, w: 235, h: 44 }], // "MOVE/HOVER"
          airborne: [0, 1, 2, 3, 4, 5], // it hovers (the sheet's label)
        },
        attack: {
          y0: 810, y1: 1160, splits: [0, 355, 710, 1071, 1405, 1760, 2113, 2463, 2816],
          exclude: [{ x: 0, y: 806, w: 170, h: 42 }], // "ATTACK"
          airborne: [3], // springs up before the splash
        },
        // 7 frames, not aligned to the drawn cell lines.
        defeated: {
          y0: 1181, y1: 1522, splits: [0, 340, 700, 1040, 1490, 1960, 2375, 2816],
          exclude: [{ x: 0, y: 1179, w: 320, h: 40 }], // "HURT/DEFEATED"
          airborne: [1], // blown up off the ground by the hit
        },
      },
    },
  },
  {
    file: "Gemini_Generated_Image_5nmbb35nmbb35nmb.jpeg",
    bg: [[86, 92, 100], [52, 54, 62]],
    tol: 35,
    characters: {
      shogun_bot: {
        // Sheet frames 5 and 7 flash the glowing sword, which flickers in a
        // loop; they're dropped, leaving the 6-frame steady stance.
        idle: {
          y0: 226, y1: 500, splits: [0, 359, 708, 1056, 1409, 1759, 2108, 2457, 2816], fps: 4,
          dropFrames: [5, 7],
        },
        move: { y0: 568, y1: 852, splits: [0, 316, 664, 1040, 1391, 1730, 2082, 2422, 2816], fps: 6 },
        attack: { y0: 908, y1: 1192, splits: [0, 325, 686, 1061, 1425, 1767, 2085, 2411, 2816] },
        defeated: { y0: 1254, y1: 1528, splits: [0, 345, 655, 1014, 1387, 1767, 2140, 2478, 2816] },
      },
    },
  },
];

// ---------------------------------------------------------------------------
// Image processing
// ---------------------------------------------------------------------------

async function loadSheet(file) {
  const { data, info } = await sharp(join(ASSETS, file))
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { data, W: info.width, H: info.height };
}

function makeBgTest(bg, tol) {
  const [A, B] = bg;
  const d = [B[0] - A[0], B[1] - A[1], B[2] - A[2]];
  const dd = d[0] ** 2 + d[1] ** 2 + d[2] ** 2 || 1;
  return (r, g, b) => {
    const p0 = r - A[0], p1 = g - A[1], p2 = b - A[2];
    let t = (p0 * d[0] + p1 * d[1] + p2 * d[2]) / dd;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    return Math.hypot(p0 - t * d[0], p1 - t * d[1], p2 - t * d[2]) < tol;
  };
}

/** Foreground mask for one row band (1 = sprite pixel). */
function bandMask(sheet, isBg, y0, y1, exclude = []) {
  const { data, W } = sheet;
  const h = y1 - y0 + 1;
  const bgLike = new Uint8Array(W * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < W; x++) {
      const i = ((y0 + y) * W + x) * 3;
      bgLike[y * W + x] = isBg(data[i], data[i + 1], data[i + 2]) ? 1 : 0;
    }
  }
  // Labels inside the band are treated as background.
  for (const r of exclude) {
    for (let y = Math.max(r.y, y0); y < Math.min(r.y + r.h, y1 + 1); y++) {
      for (let x = Math.max(r.x, 0); x < Math.min(r.x + r.w, W); x++) bgLike[(y - y0) * W + x] = 1;
    }
  }

  // Flood fill background from the band's edges.
  const reached = new Uint8Array(W * h);
  const stack = [];
  const seed = (x, y) => {
    const k = y * W + x;
    if (bgLike[k] && !reached[k]) { reached[k] = 1; stack.push(k); }
  };
  for (let x = 0; x < W; x++) { seed(x, 0); seed(x, h - 1); }
  for (let y = 0; y < h; y++) { seed(0, y); seed(W - 1, y); }
  while (stack.length) {
    const k = stack.pop();
    const x = k % W, y = (k - x) / W;
    if (x > 0) seed(x - 1, y);
    if (x < W - 1) seed(x + 1, y);
    if (y > 0) seed(x, y - 1);
    if (y < h - 1) seed(x, y + 1);
  }

  // Enclosed background pockets: remove the large ones.
  const mask = new Uint8Array(W * h);
  for (let k = 0; k < mask.length; k++) mask[k] = reached[k] ? 0 : 1;
  const seen = new Uint8Array(W * h);
  for (let k = 0; k < mask.length; k++) {
    if (!mask[k] || !bgLike[k] || seen[k]) continue;
    const pocket = [k];
    seen[k] = 1;
    for (let j = 0; j < pocket.length; j++) {
      const q = pocket[j], x = q % W, y = (q - x) / W;
      for (const n of [x > 0 ? q - 1 : -1, x < W - 1 ? q + 1 : -1, y > 0 ? q - W : -1, y < h - 1 ? q + W : -1]) {
        if (n >= 0 && mask[n] && bgLike[n] && !seen[n]) { seen[n] = 1; pocket.push(n); }
      }
    }
    if (pocket.length > HOLE_MIN) for (const q of pocket) mask[q] = 0;
  }
  return { mask, W, h };
}

/** 8-connected components of the mask. */
function components({ mask, W, h }) {
  const label = new Int32Array(W * h).fill(-1);
  const comps = [];
  for (let k = 0; k < mask.length; k++) {
    if (!mask[k] || label[k] >= 0) continue;
    const id = comps.length;
    const px = [k];
    label[k] = id;
    for (let j = 0; j < px.length; j++) {
      const q = px[j], x = q % W, y = (q - x) / W;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= h) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= W || (dx === 0 && dy === 0)) continue;
          const n = yy * W + xx;
          if (mask[n] && label[n] < 0) { label[n] = id; px.push(n); }
        }
      }
    }
    let minX = W, maxX = 0, minY = h, maxY = 0;
    for (const q of px) {
      const x = q % W, y = (q - x) / W;
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
    comps.push({ px, minX, maxX, minY, maxY });
  }
  return comps;
}

// (push(...big) overflows the call stack for large sprites.)
const append = (target, items) => { for (const v of items) target.push(v); };

/** Assign component pixels to frames (whole, or cut at splits if shared). */
function assignToFrames(comps, splits, W, bandH, dropBottom, assign = [], y0 = 0) {
  const n = splits.length - 1;
  const frames = Array.from({ length: n }, () => ({ px: [], comps: [] }));
  const frameOf = (x) => {
    for (let f = 0; f < n; f++) if (x >= splits[f] && x < splits[f + 1]) return f;
    return -1;
  };
  for (const c of comps) {
    if (c.px.length < MIN_COMPONENT) continue;
    if (dropBottom && c.minY >= bandH - dropBottom.height && c.px.length <= dropBottom.maxArea) continue;
    const cx = (c.minX + c.maxX) / 2, cy = y0 + (c.minY + c.maxY) / 2;
    const forced = assign.find((r) => cx >= r.x && cx < r.x + r.w && cy >= r.y && cy < r.y + r.h);
    if (forced) {
      append(frames[forced.frame].px, c.px);
      frames[forced.frame].comps.push(c.px);
      continue;
    }
    const counts = new Array(n).fill(0);
    for (const q of c.px) { const f = frameOf(q % W); if (f >= 0) counts[f]++; }
    const total = counts.reduce((a, b) => a + b, 0);
    if (!total) continue; // entirely outside the frames (portraits, labels)
    const shared = counts.filter((v) => v / total >= CUT_SHARE).length;
    if (shared >= 2) {
      // Frames that physically touch: cut at the split lines.
      const parts = Array.from({ length: n }, () => []);
      for (const q of c.px) { const f = frameOf(q % W); if (f >= 0) parts[f].push(q); }
      parts.forEach((p, f) => {
        if (p.length >= MIN_COMPONENT) { append(frames[f].px, p); frames[f].comps.push(p); }
      });
    } else {
      const f = counts.indexOf(Math.max(...counts));
      append(frames[f].px, c.px);
      frames[f].comps.push(c.px);
    }
  }
  return frames;
}

/** Horizontal anchor: centre of the main body's bottom 15% (its feet/base). */
/**
 * Anchor for "mass" alignment: the main body's centre of mass. Better for
 * cycles where the feet move a lot (runs), at the cost of a little bounce.
 */
function massAnchor(frame, W) {
  const main = frame.comps.reduce((a, b) => (b.length > a.length ? b : a), []);
  let sx = 0, sy = 0;
  for (const q of main) { sx += q % W; sy += Math.floor(q / W); }
  return { x: sx / (main.length || 1), y: sy / (main.length || 1) };
}

function footAnchorX(frame, W) {
  const main = frame.comps.reduce((a, b) => (b.length > a.length ? b : a), []);
  let minY = Infinity, maxY = -Infinity;
  for (const q of main) { const y = Math.floor(q / W); if (y < minY) minY = y; if (y > maxY) maxY = y; }
  const cutoff = maxY - Math.max(4, Math.round((maxY - minY) * 0.15));
  let sum = 0, cnt = 0;
  for (const q of main) { const y = Math.floor(q / W); if (y >= cutoff) { sum += q % W; cnt++; } }
  return cnt ? sum / cnt : 0;
}

async function sliceAnimation(sheet, isBg, name, anim) {
  const rows = anim.rows ?? [anim];
  const frames = [];
  for (const row of rows) {
    const band = bandMask(sheet, isBg, row.y0, row.y1, row.exclude);
    const assigned = assignToFrames(
      components(band), row.splits, band.W, band.h, row.dropBottom, row.assign, row.y0,
    );
    assigned.forEach((f, i) => {
      if (!f.px.length) {
        console.warn(`  ! ${name}: frame ${frames.length + 1} (split ${i}) is empty — skipped`);
        return;
      }
      // "feet" (default): x on the feet, y as drawn in the row (jumps rise).
      // "mass": x and y on the body's centre of mass (runs in place).
      const mass = (anim.align ?? "feet") === "mass" ? massAnchor(f, band.W) : null;
      frames.push({
        ...f, y0: row.y0, W: band.W,
        anchorX: mass ? mass.x : footAnchorX(f, band.W),
        anchorY: mass ? Math.round(mass.y) : 0,
      });
    });
  }

  if (anim.dropFrames?.length) {
    const drop = new Set(anim.dropFrames);
    const kept = frames.filter((_, i) => !drop.has(i + 1));
    frames.length = 0;
    frames.push(...kept);
  }

  // Shared canvas: x relative to each frame's foot anchor, y relative to its band.
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const f of frames) {
    for (const q of f.px) {
      const x = (q % f.W) - f.anchorX, y = Math.floor(q / f.W) - f.anchorY;
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
  }
  const width = Math.ceil(maxX - minX) + 1 + PAD * 2;
  const height = maxY - minY + 1 + PAD * 2;
  const originX = -minX + PAD; // canvas x of the foot anchor
  const originY = -minY + PAD;

  // Grounding: every frame not listed in `airborne` is moved down so its
  // lowest pixel sits on the ground line (the lowest pixel across frames),
  // instead of floating where the sheet happened to draw it.
  const ground = height - PAD - 1;
  const airborne = new Set(anim.airborne ?? []);
  const drop = frames.map((f, i) => {
    if (airborne.has(i)) return 0;
    let low = -Infinity;
    for (const q of f.px) low = Math.max(low, Math.floor(q / f.W) - f.anchorY + originY);
    return ground - low;
  });
  drop.forEach((d, i) => d && console.log(`  ${name}: frame ${i} grounded (${d}px down)`));

  const buffers = frames.map((f, i) => {
    const out = Buffer.alloc(width * height * 4);
    for (const q of f.px) {
      const bx = q % f.W, by = Math.floor(q / f.W);
      const cx = Math.round(bx - f.anchorX + originX), cy = by - f.anchorY + originY + drop[i];
      if (cx < 0 || cx >= width || cy < 0 || cy >= height) continue;
      const si = ((f.y0 + by) * sheet.W + bx) * 3, di = (cy * width + cx) * 4;
      out[di] = sheet.data[si];
      out[di + 1] = sheet.data[si + 1];
      out[di + 2] = sheet.data[si + 2];
      out[di + 3] = 255;
    }
    return out;
  });

  // Foot anchor: horizontally the aligned feet; vertically the lowest body
  // pixel across frames (the "ground" line).
  return { buffers, width, height, anchor: { x: Math.round(originX), y: ground } };
}

// ---------------------------------------------------------------------------
// Grid sheets
// ---------------------------------------------------------------------------

async function loadGridSheet(file) {
  const { data, info } = await sharp(join(ASSETS, file))
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { data, W: info.width, H: info.height };
}

/** One cell as a foreground mask (alpha > 0) plus its bounds; null if empty. */
function gridCell(sheet, cell, row, col) {
  const mask = new Uint8Array(cell * cell);
  let minX = cell, maxX = -1, minY = cell, maxY = -1;
  for (let y = 0; y < cell; y++) {
    for (let x = 0; x < cell; x++) {
      if (sheet.data[((row * cell + y) * sheet.W + col * cell + x) * 4 + 3] === 0) continue;
      mask[y * cell + x] = 1;
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
  }
  return maxX < 0 ? null : { row, col, mask, minX, maxX, minY, maxY };
}

/**
 * A grid-sheet animation: one row of cells. The cells are padded, and the
 * feet don't sit on the same line in every row, so each row is anchored on
 * its first frame (column 0 is the idle pose on every action row): feet x
 * from the bottom of its main body, the ground line at its lowest pixel.
 * Frames keep their drawn horizontal position (lunges move as drawn), and
 * every grounded frame is moved so its lowest pixel sits exactly on the
 * ground line — lifted if the sheet drew it lower (a body lying flat),
 * dropped if it floats. Frames listed in `airborne` (indices into the
 * sliced frames: jumps, a pounce, a fall) keep their height, but still may
 * not sink below the line. The canvas is the frames' union, no padding.
 * `ground` (a cell row) overrides the ground line for a hovering character
 * whose frame 0 floats: every row of it then shares that line.
 */
function sliceGridAnimation(sheet, cell, name, anim) {
  const cols = anim.frames ?? Array.from({ length: Math.floor(sheet.W / cell) }, (_, c) => c);
  const cells = cols.map((c) => gridCell(sheet, cell, anim.row, c)).filter(Boolean);
  if (!cells.length) throw new Error(`${name}: row ${anim.row} is empty`);

  const ref = cells[0];
  const main = components({ mask: ref.mask, W: cell, h: cell }).reduce((a, b) => (b.px.length > a.px.length ? b : a));
  const footX = footAnchorX({ comps: [main.px] }, cell);
  const ground = anim.ground ?? ref.maxY;
  const airborne = new Set(anim.airborne ?? []);
  const frames = cells.map((c, i) => {
    const dy = airborne.has(i) ? -Math.max(0, c.maxY - ground) : ground - c.maxY;
    if (dy) console.log(`  ${name}: column ${c.col} ${dy < 0 ? `lifted ${-dy}` : `dropped ${dy}`}px onto the ground line`);
    return { ...c, dy };
  });

  const ax = Math.round(footX);
  const minX = Math.min(...frames.map((f) => f.minX)), maxX = Math.max(...frames.map((f) => f.maxX));
  const minY = Math.min(...frames.map((f) => f.minY + f.dy)), maxY = Math.max(...frames.map((f) => f.maxY + f.dy));
  const width = maxX - minX + 1, height = maxY - minY + 1;

  const buffers = frames.map((f) => {
    const out = Buffer.alloc(width * height * 4);
    for (let y = f.minY; y <= f.maxY; y++) {
      for (let x = f.minX; x <= f.maxX; x++) {
        if (!f.mask[y * cell + x]) continue;
        const si = ((f.row * cell + y) * sheet.W + f.col * cell + x) * 4;
        const di = ((y + f.dy - minY) * width + (x - minX)) * 4;
        sheet.data.copy(out, di, si, si + 4);
      }
    }
    return out;
  });
  // The reference frame's height: the standing body (a tail wag or a raised
  // sword in later frames makes the canvas taller than the character).
  return { buffers, width, height, anchor: { x: ax - minX, y: ground - minY }, bodyHeight: ref.maxY - ref.minY + 1 };
}

// ---------------------------------------------------------------------------

// Which way every animation faces as drawn ("right" | "left" | "front"),
// judged per animation by where the face/eyes point and which way attacks
// and projectiles travel (sheets mix views, e.g. a front idle with side-on
// moves). Written into the manifests; the battle scene mirrors side-facing
// poses so the party faces right and bosses face left. Every sliced
// animation must be listed here.
const FACING = {
  hero: { idle: "right", chop: "right", thrust: "right", slash: "right", hurt: "right", ko: "right", victory: "right" },
  rogue: {
    idle: "right", bark: "right", hurt: "right", pounce: "right", ko: "right",
    bark_front: "front", idle_front: "front",
  },
  trash_bag_slime: { idle: "left", attack: "left", hurt: "left", death: "left", move: "left" },
  alarm_clock_swarm: { idle: "left", attack: "left", hurt: "left", death: "left", move: "left" },
  laundry_goblin: { idle: "left", attack: "left", hurt: "left", death: "left", move: "left" },
  cable_spider: { idle: "left", attack: "left", hurt: "left", death: "left", move: "left" },
  magma_behemoth: { idle: "right", move: "right", attack: "right", defeated: "right" },
  chronosphinx: { idle: "front", move: "right", attack: "right", defeated: "right" },
  abyssal_kraken: { idle: "front", move: "right", attack: "front", defeated: "front" },
  shogun_bot: { idle: "right", move: "right", attack: "right", defeated: "right" },
};

const only = new Set(process.argv.slice(2));
mkdirSync(OUT_MANIFESTS, { recursive: true });

for (const sheetCfg of SHEETS) {
  const wanted = Object.keys(sheetCfg.characters).filter((c) => !only.size || only.has(c));
  if (!wanted.length) continue;
  const grid = sheetCfg.grid;
  const sheet = grid ? await loadGridSheet(sheetCfg.file) : await loadSheet(sheetCfg.file);
  const isBg = grid ? null : makeBgTest(sheetCfg.bg, sheetCfg.tol);

  for (const character of wanted) {
    const charDir = join(OUT_PUBLIC, character);
    rmSync(charDir, { recursive: true, force: true });
    const manifest = { character, animations: {} };

    for (const [animName, anim] of Object.entries(sheetCfg.characters[character])) {
      const facing = FACING[character]?.[animName];
      if (!facing) throw new Error(`No FACING entry for ${character}/${animName}`);
      const label = `${character}/${animName}`;
      const { buffers, width, height, anchor, bodyHeight } = grid
        ? sliceGridAnimation(sheet, grid.cell, label, anim)
        : await sliceAnimation(sheet, isBg, label, anim);
      const dir = join(charDir, animName);
      mkdirSync(dir, { recursive: true });
      const paths = [];
      for (let i = 0; i < buffers.length; i++) {
        const fileName = `frame-${String(i + 1).padStart(2, "0")}.png`;
        await sharp(buffers[i], { raw: { width, height, channels: 4 } })
          // Grid sheets are clean pixel art (too many colours for a
          // palette PNG to keep exactly): lossless.
          .png(grid ? { compressionLevel: 9 } : { compressionLevel: 9, palette: true, quality: 95 })
          .toFile(join(dir, fileName));
        paths.push(`/sprites/${character}/${animName}/${fileName}`);
      }
      manifest.animations[animName] = {
        frames: paths,
        width,
        height,
        anchor,
        ...(bodyHeight ? { bodyHeight } : {}),
        // Frames exempt from grounding (jumps, hovering…): tests/grounding.
        ...(anim.airborne?.length ? { airborne: anim.airborne } : {}),
        // An attack's contact frame: the game times the blow to it.
        ...(anim.contact !== undefined ? { contact: anim.contact } : {}),
        ...PLAYBACK[animName],
        ...(anim.fps ? { fps: anim.fps } : {}),
        ...(anim.loop !== undefined ? { loop: anim.loop } : {}),
        facing,
      };
      console.log(`${character}/${animName}: ${paths.length} frames, ${width}x${height}`);
    }
    writeFileSync(join(OUT_MANIFESTS, `${character}.json`), JSON.stringify(manifest, null, 2) + "\n");
    // Versioned frame URLs + ground shadows (scripts/sprite-manifests.mjs).
    await finishManifest(character);
  }
}
