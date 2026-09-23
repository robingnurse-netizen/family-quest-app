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

import sharp from "sharp";
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
  run: { fps: 12, loop: true },
  running: { fps: 12, loop: true },
  move: { fps: 8, loop: true },
  jump: { fps: 8, loop: false },
  attack: { fps: 10, loop: false },
  pouncing: { fps: 8, loop: false },
  barking: { fps: 8, loop: false },
  hurt: { fps: 8, loop: false },
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
    file: "Gemini_Generated_Image_4emgkn4emgkn4emg.png",
    bg: [[206, 214, 222], [116, 132, 148]],
    tol: 40,
    characters: {
      hero: {
        idle: { y0: 95, y1: 495, splits: [60, 420, 790, 1200] },
        run: { y0: 595, y1: 1000, splits: [60, 385, 710, 1030, 1355, 1670, 2000] },
        jump: {
          y0: 1028, y1: 1515, splits: [100, 520, 1000, 1500, 2000],
          exclude: [{ x: 0, y: 1020, w: 330, h: 75 }], // "JUMPING"
        },
        attack: {
          y0: 1555, y1: 2030, splits: [0, 420, 820, 1220, 1620, 2048],
          exclude: [{ x: 0, y: 1550, w: 280, h: 62 }], // "ATTACK"
        },
      },
    },
  },
  {
    file: "Gemini_Generated_Image_tccey0tccey0tcce.jpeg",
    bg: [[196, 200, 212], [124, 132, 148]],
    tol: 38,
    characters: {
      rogue: {
        idle: { y0: 100, y1: 412, splits: [30, 380, 722, 1050, 1378, 1700, 2030] },
        running: {
          align: "mass",
          rows: [
            { y0: 503, y1: 782, splits: [60, 540, 1060, 1535, 2040] },
            { y0: 786, y1: 1066, splits: [40, 565, 1035, 1550, 2040] },
          ],
        },
        pouncing: {
          y0: 1110, y1: 1548, splits: [30, 490, 1010, 1610, 2040],
          exclude: [{ x: 0, y: 1105, w: 680, h: 68 }], // "POUNCING ANIMATION"
        },
        barking: {
          y0: 1600, y1: 2046, splits: [20, 435, 870, 1245, 1640, 2040],
          exclude: [
            { x: 0, y: 1596, w: 640, h: 68 }, // "BARKING ANIMATION"
            { x: 1950, y: 1870, w: 98, h: 178 }, // palette swatches
          ],
          // "WOOF" (separate letters) belongs to frame 2's bark but sits over
          // frame 3's column.
          assign: [{ x: 770, y: 1640, w: 190, h: 75, frame: 1 }],
        },
      },
    },
  },
  {
    file: "Gemini_Generated_Image_8cf69b8cf69b8cf6.jpeg",
    bg: [[241, 241, 241], [128, 128, 128]],
    tol: 22,
    characters: {
      trash_bag_slime: {
        idle: { y0: 185, y1: 418, splits: [600, 852, 1052, 1265], fps: 3 },
        attack: { y0: 185, y1: 418, splits: [1265, 1470, 1757, 2114], fps: 6 },
        hurt: { y0: 185, y1: 418, splits: [2114, 2437] },
        death: { y0: 185, y1: 418, splits: [2437, 2800] },
      },
      alarm_clock_swarm: {
        idle: { y0: 488, y1: 762, splits: [560, 980] },
        move: { y0: 488, y1: 762, splits: [980, 1450] },
        attack: { y0: 488, y1: 762, splits: [1450, 1668, 2035], fps: 3 },
        hurt: { y0: 488, y1: 762, splits: [2035, 2420] },
        death: { y0: 488, y1: 762, splits: [2420, 2800] },
      },
      laundry_goblin: {
        idle: { y0: 859, y1: 1126, splits: [565, 768, 983], fps: 2 },
        move: { y0: 859, y1: 1126, splits: [983, 1178, 1336, 1505] },
        attack: { y0: 859, y1: 1126, splits: [1505, 1798, 2027], fps: 4 },
        hurt: { y0: 859, y1: 1126, splits: [2027, 2256, 2445], fps: 4 },
        death: { y0: 859, y1: 1126, splits: [2445, 2800] },
      },
      cable_spider: {
        idle: { y0: 1238, y1: 1510, splits: [570, 1022] },
        move: { y0: 1238, y1: 1510, splits: [1022, 1494] },
        attack: { y0: 1238, y1: 1510, splits: [1494, 1985] },
        hurt: { y0: 1238, y1: 1510, splits: [1985, 2393] },
        death: { y0: 1238, y1: 1510, splits: [2393, 2800] },
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
        },
        attack: {
          y0: 810, y1: 1160, splits: [0, 355, 710, 1071, 1405, 1760, 2113, 2463, 2816],
          exclude: [{ x: 0, y: 806, w: 170, h: 42 }], // "ATTACK"
        },
        // 7 frames, not aligned to the drawn cell lines.
        defeated: {
          y0: 1181, y1: 1522, splits: [0, 340, 700, 1040, 1490, 1960, 2375, 2816],
          exclude: [{ x: 0, y: 1179, w: 320, h: 40 }], // "HURT/DEFEATED"
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

  const buffers = frames.map((f) => {
    const out = Buffer.alloc(width * height * 4);
    for (const q of f.px) {
      const bx = q % f.W, by = Math.floor(q / f.W);
      const cx = Math.round(bx - f.anchorX + originX), cy = by - f.anchorY + originY;
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
  return { buffers, width, height, anchor: { x: Math.round(originX), y: height - PAD - 1 } };
}

// ---------------------------------------------------------------------------

const only = new Set(process.argv.slice(2));
mkdirSync(OUT_MANIFESTS, { recursive: true });

for (const sheetCfg of SHEETS) {
  const wanted = Object.keys(sheetCfg.characters).filter((c) => !only.size || only.has(c));
  if (!wanted.length) continue;
  const sheet = await loadSheet(sheetCfg.file);
  const isBg = makeBgTest(sheetCfg.bg, sheetCfg.tol);

  for (const character of wanted) {
    const charDir = join(OUT_PUBLIC, character);
    rmSync(charDir, { recursive: true, force: true });
    const manifest = { character, animations: {} };

    for (const [animName, anim] of Object.entries(sheetCfg.characters[character])) {
      const { buffers, width, height, anchor } = await sliceAnimation(sheet, isBg, `${character}/${animName}`, anim);
      const dir = join(charDir, animName);
      mkdirSync(dir, { recursive: true });
      const paths = [];
      for (let i = 0; i < buffers.length; i++) {
        const fileName = `frame-${String(i + 1).padStart(2, "0")}.png`;
        await sharp(buffers[i], { raw: { width, height, channels: 4 } })
          .png({ compressionLevel: 9, palette: true, quality: 95 })
          .toFile(join(dir, fileName));
        paths.push(`/sprites/${character}/${animName}/${fileName}`);
      }
      manifest.animations[animName] = {
        frames: paths,
        width,
        height,
        anchor,
        ...PLAYBACK[animName],
        ...(anim.fps ? { fps: anim.fps } : {}),
        ...(anim.loop !== undefined ? { loop: anim.loop } : {}),
      };
      console.log(`${character}/${animName}: ${paths.length} frames, ${width}x${height}`);
    }
    writeFileSync(join(OUT_MANIFESTS, `${character}.json`), JSON.stringify(manifest, null, 2) + "\n");
  }
}
