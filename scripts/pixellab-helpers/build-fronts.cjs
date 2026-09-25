/* eslint-disable @typescript-eslint/no-require-imports */
// Rough helper: assets/boss-fronts-pixellab.png — every boss's SOUTH
// (front-facing) PixelLab rotation, one 96px cell each, for the Trophy Case
// statues only (the slicer turns each cell into a one-frame "front"
// animation; the battle never uses it). docs/pixellab-style.md, "Trophy
// Case fronts".
//
// Inputs (git-ignored): PIXELLAB_WORK/south/<key>.png, the character's
// rotations/south.png from its download ZIP; the Serpent's is its reworked
// front (serpent-front.png) once approved. Each is cleaned like a battle
// sheet's frame 0 (every 8-connected cluster under 10 px goes: the swarm's
// specks, the ooze's stink wisps), the Minotaur loses his mud puddle
// (FIXES), then it's centred in its cell. A key whose input is missing
// leaves its cell empty (the statue falls back to its battle idle frame).
//
//   node scripts/pixellab-helpers/build-fronts.cjs
const sharp = require('sharp');
const fs = require('node:fs');
const path = require('node:path');
const { clusters, MIN } = require('./specks.cjs');

const WORK = path.join(process.env.PIXELLAB_WORK || path.join(__dirname, 'work'), 'south');
const CELL = 96;
/** Cell order = column in the sheet (the slicer's `frames: [column]`). */
const KEYS = [
  'trash_bag_slime', 'alarm_clock_swarm', 'laundry_goblin', 'cable_spider',
  'swamp_bag_ooze', 'tupperware_troll', 'scatter_brick_serpent', 'mud_track_minotaur',
  'magma_behemoth', 'chronosphinx', 'abyssal_kraken', 'shogun_bot',
];
/** Fronts awaiting approval: their cells stay empty (the statue keeps its
 *  battle idle frame) until removed from here. (The Serpent's reworked
 *  front, serpent-front.cjs, was approved and is in.) */
const PENDING = new Set([]);
/** Per-boss input file (default <key>.png). */
const INPUT = { scatter_brick_serpent: 'serpent-front.png' };
const INK = [17, 12, 10, 255];

const FIXES = {
  // The Minotaur's front view stands in a mud puddle (rows 63–73), as his
  // rotation did (minotaur-start.cjs): keep everything above row 64, then
  // only his two hooves (columns 20–29 and 46–55) down to row 69, and close
  // their exposed edges with outline.
  mud_track_minotaur(px, w, h) {
    const keep = (x, y) => y < 64 || (y <= 69 && ((x >= 20 && x <= 29) || (x >= 46 && x <= 55)));
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (!keep(x, y)) px[(y * w + x) * 4 + 3] = 0;
    const on = (x, y) => x >= 0 && y >= 0 && x < w && y < h && px[(y * w + x) * 4 + 3];
    const add = [];
    for (let y = 60; y < h; y++) for (let x = 0; x < w; x++) {
      if (on(x, y)) continue;
      if ([[0, -1], [-1, 0], [1, 0]].some(([dx, dy]) => on(x + dx, y + dy) && y + dy >= 63)) add.push([x, y]);
    }
    for (const [x, y] of add) px.set(INK, (y * w + x) * 4);
    return add.length;
  },
};

(async () => {
  const sheet = Buffer.alloc(CELL * KEYS.length * CELL * 4);
  const SW = CELL * KEYS.length;
  for (const [col, key] of KEYS.entries()) {
    if (PENDING.has(key)) { console.log(`${key}: pending approval — cell left empty`); continue; }
    const file = path.join(WORK, INPUT[key] ?? `${key}.png`);
    if (!fs.existsSync(file)) { console.log(`${key}: no input — cell left empty`); continue; }
    const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const { width: w, height: h } = info;
    const px = Buffer.from(data);
    let specks = 0;
    for (const c of clusters({ w, h, px })) if (c.length < MIN) { specks++; for (const p of c) px[p * 4 + 3] = 0; }
    const fixed = FIXES[key] ? FIXES[key](px, w, h) : 0;
    if (w > CELL || h > CELL) throw new Error(`${key}: ${w}x${h} doesn't fit a ${CELL}px cell`);
    const ox = col * CELL + Math.floor((CELL - w) / 2), oy = Math.floor((CELL - h) / 2);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      if (px[i + 3]) px.copy(sheet, ((oy + y) * SW + ox + x) * 4, i, i + 4);
    }
    console.log(`${key}: ${w}x${h}, removed ${specks} specks${fixed ? `, fix ${fixed} px` : ''}`);
  }
  const out = path.join(__dirname, '..', '..', 'assets', 'boss-fronts-pixellab.png');
  await sharp(sheet, { raw: { width: SW, height: CELL, channels: 4 } }).png({ compressionLevel: 9 }).toFile(out);
  console.log('wrote', out);
})();
