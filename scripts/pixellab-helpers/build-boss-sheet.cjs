/* eslint-disable @typescript-eslint/no-require-imports */
// Rough helper (the general form of build-sheet.cjs, used from the Laundry
// Goblin on; docs/pixellab-style.md). Inputs are PixelLab downloads, not kept
// in the repo: PIXELLAB_WORK (default scripts/pixellab-helpers/work/) holds
// <animation>/<0-8>.png frames, as the character's download ZIP has them.
//
//   node scripts/pixellab-helpers/build-boss-sheet.cjs <boss>
//
// Writes assets/<file> for BOSSES[boss]: one row per animation (idle /
// attack / hurt / death / move), 9 columns, cells of `cell` px. Every
// PixelLab animation of a character shares one canvas with the rotation at
// the same spot, so frames are copied at `off` (per row if canvases differ).
// Speck cleanup, 8-connected clusters under 10 px:
//   - idle, move and frame 0 / 8 of every row: every small cluster goes;
//   - attack / hurt / death frames 1–7 (`debris` rows): small clusters
//     OUTSIDE the main body's bounding box stay (sparks, splashes, shards),
//     those inside it go;
//     except debris reaching below frame 0's lowest row (the ground line:
//     nothing may sink under the grass);
//   - `keepAll` frames (hand-drawn end frames) are untouched.
// A boss's `fix(px, w, h, row, frame)` then applies its own hand fixes
// (goblin-fixes.cjs).
const sharp = require('sharp');
const path = require('node:path');
const { load, clusters, MIN, S } = require('./specks.cjs');

const row = (name, dir = name, extra = {}) => ({ name, dir, off: [0, 0], debris: ['attack', 'hurt', 'death'].includes(name), ...extra });
const BOSSES = {
  laundry_goblin: {
    file: 'laundry-goblin-pixellab.png', cell: 88,
    rows: [row('idle'), row('attack'), row('hurt'), row('death'), row('move')],
    fix: require('./goblin-fixes.cjs'), // sock drips, ear speck
  },
  cable_spider: {
    file: 'cable-spider-pixellab.png', cell: 88,
    // death-v3 animates into a hand-drawn end frame (spider-heap.cjs); its
    // v3 canvas grew to 104×96, so it's placed to line up with the rest.
    rows: [row('idle'), row('attack', 'attack-v2'), row('hurt'), row('death', 'death-v3', { off: [-8, -4], keepAll: [8] }), row('move')],
  },
};

const key = process.argv[2];
const cfg = BOSSES[key];
if (!cfg) throw new Error(`Unknown boss ${key}; one of ${Object.keys(BOSSES).join(', ')}`);

(async () => {
  const { cell: CELL, rows: ROWS } = cfg;
  const SW = CELL * 9;
  const sheet = Buffer.alloc(SW * CELL * ROWS.length * 4);
  for (const [r, rw] of ROWS.entries()) {
    let removed = 0, kept = 0, groundY = Infinity, fixed = '';
    for (let f = 0; f < 9; f++) {
      const im = await load(`${S}/${rw.dir}/${f}.png`);
      const px = Buffer.from(im.px);
      if (!rw.keepAll?.includes(f)) {
        const cs = clusters(im);
        let bx0 = 1e9, by0 = 1e9, bx1 = -1, by1 = -1;
        for (const c of cs) if (c.length >= MIN) for (const p of c) {
          const x = p % im.w, y = (p / im.w) | 0;
          bx0 = Math.min(bx0, x); bx1 = Math.max(bx1, x); by0 = Math.min(by0, y); by1 = Math.max(by1, y);
        }
        if (f === 0) groundY = by1;
        const debrisFrame = rw.debris && f >= 1 && f <= 7;
        for (const c of cs) {
          if (c.length >= MIN) continue;
          const outside = c.every((p) => { const x = p % im.w, y = (p / im.w) | 0; return x < bx0 || x > bx1 || y < by0 || y > by1; });
          const sinks = c.some((p) => ((p / im.w) | 0) > groundY);
          if (debrisFrame && outside && !sinks) { kept++; continue; }
          removed++; for (const p of c) px[p * 4 + 3] = 0;
        }
      }
      if (cfg.fix) { const r = cfg.fix(px, im.w, im.h, rw.name, f); if (r.dripped || r.ear) fixed += ` ${f}:${r.dripped}/${r.ear}`; }
      const [ox, oy] = rw.off;
      for (let y = 0; y < im.h; y++) for (let x = 0; x < im.w; x++) {
        const si = (y * im.w + x) * 4; if (!px[si + 3]) continue;
        const dx = f * CELL + x + ox, dy = r * CELL + y + oy;
        if (x + ox < 0 || x + ox >= CELL || y + oy < 0 || y + oy >= CELL) throw new Error(`${rw.dir} ${f}: pixel outside its cell`);
        px.copy(sheet, (dy * SW + dx) * 4, si, si + 4);
      }
    }
    console.log(`${rw.name} (${rw.dir}): removed ${removed} specks, kept ${kept} debris clusters${fixed ? `; fix (frame:drip px/ear px)${fixed}` : ''}`);
  }
  const out = path.join(__dirname, '..', '..', 'assets', cfg.file);
  await sharp(sheet, { raw: { width: SW, height: CELL * ROWS.length, channels: 4 } }).png({ compressionLevel: 9 }).toFile(out);
  console.log('wrote', out);
})();
