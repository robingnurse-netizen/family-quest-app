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
//   - `keepAll` frames (hand-drawn end frames) are untouched;
//   - `clip` frames lose every pixel below frame 0's ground row (big
//     splashes / impact effects that the sheet drew sinking into the
//     ground, which grounding would otherwise answer by lifting the body).
// A boss's `fix(px, w, h, row, frame)` then applies its own hand fixes
// (goblin-fixes.cjs, kraken-fixes.cjs), returning px counts to log.
// Mid-tier options (from the Swamp-Bag Ooze on):
//   - `work`: the boss's own folder under PIXELLAB_WORK (so several bosses'
//     downloads can sit side by side);
//   - a row's `frames`: source frame per column (e.g. [0..7, 7] holds frame 7
//     as the end frame instead of a weak last frame);
//   - `align: [x, y]`: every row is placed so its frame 0's bounding box has
//     its left edge at x and its lowest row at y — for characters animated
//     from a custom start frame, whose v3 canvases differ per animation.
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
  magma_behemoth: {
    file: 'magma-behemoth-pixellab.png', cell: 116,
    // The smash's lava burst (5–7) splashes below his feet.
    rows: [row('idle'), row('attack', 'attack', { clip: [5, 6, 7] }), row('hurt'), row('death', 'death-v2'), row('move')],
  },
  chronosphinx: {
    file: 'chronosphinx-pixellab.png', cell: 124,
    rows: [row('idle'), row('attack'), row('hurt'), row('death'), row('move')],
  },
  abyssal_kraken: {
    file: 'abyssal-kraken-pixellab.png', cell: 112,
    rows: [row('idle'), row('attack'), row('hurt'), row('death'), row('move')],
    fix: require('./kraken-fixes.cjs'), // the loose tentacle piece
  },
  shogun_bot: {
    file: 'shogun-bot-pixellab.png', cell: 124,
    rows: [row('idle'), row('attack'), row('hurt', 'hurt-v2'), row('death'), row('move')],
  },
  swamp_bag_ooze: {
    file: 'swamp-bag-ooze-pixellab.png', cell: 104, work: 'swamp_bag_ooze',
    // The death's last frame fades the puddle to a hollow outline ring:
    // hold frame 7 (the full spill) instead.
    rows: [row('idle'), row('attack', 'attack-v2'), row('hurt', 'hurt-v3'),
      row('death', 'death', { frames: [0, 1, 2, 3, 4, 5, 6, 7, 7] }), row('move')],
  },
  tupperware_troll: {
    file: 'tupperware-troll-pixellab.png', cell: 104, work: 'tupperware_troll',
    // The club's ground burst (5–7) splashes below his feet.
    rows: [row('idle'), row('attack', 'attack-v2', { clip: [5, 6, 7] }), row('hurt', 'hurt-v2'), row('death', 'death-v2'), row('move')],
  },
  mud_track_minotaur: {
    // Animated from a custom start frame (minotaur-start.cjs: the rotation's
    // mud puddle erased), so each v3 canvas differs: rows are aligned on
    // frame 0. The death is the first-generation knockdown (a collapse
    // face-down, in one piece); death-v4 (into minotaur-heap.cjs's shattered
    // heap) was replaced after review.
    file: 'mud-track-minotaur-pixellab.png', cell: 96, work: 'mud_track_minotaur', align: [20, 84],
    // The attack's mud spray (5–7) splashes below his hooves.
    rows: [row('idle', 'idle-v2'), row('attack', 'attack-v2', { clip: [5, 6, 7] }), row('hurt'), row('death', 'death'), row('move')],
  },
  scatter_brick_serpent: {
    // Every animation starts from the fixed reference frame
    // (assets/scatter-brick-serpent-reference.png), so the v3 canvases
    // differ per animation: rows are aligned on frame 0. The death animates
    // into the hand-drawn end frame (serpent-heap.cjs); v3's last frame is
    // kept (it matches the drawing except two loose bricks it left out).
    file: 'scatter-brick-serpent-pixellab.png', cell: 96, work: 'scatter_brick_serpent', align: [12, 86],
    rows: [row('idle'), row('attack', 'attack-v2'), row('hurt'), row('death'), row('move')],
    fix: require('./serpent-fixes.cjs'), // the belly-stripe wedge under the jaw (death 6–8)
  },
};

const key = process.argv[2];
const cfg = BOSSES[key];
if (!cfg) throw new Error(`Unknown boss ${key}; one of ${Object.keys(BOSSES).join(', ')}`);

(async () => {
  const { cell: CELL, rows: ROWS } = cfg;
  const DIR = cfg.work ? path.join(S, cfg.work) : S;
  const bbox = (im) => {
    let x0 = 1e9, y1 = -1;
    for (let i = 0; i < im.w * im.h; i++) if (im.px[i * 4 + 3]) { x0 = Math.min(x0, i % im.w); y1 = Math.max(y1, (i / im.w) | 0); }
    return [x0, y1];
  };
  const SW = CELL * 9;
  const sheet = Buffer.alloc(SW * CELL * ROWS.length * 4);
  for (const [r, rw] of ROWS.entries()) {
    let removed = 0, kept = 0, groundY = Infinity, fixed = '';
    if (cfg.align) {
      const [x0, y1] = bbox(await load(`${DIR}/${rw.dir}/0.png`));
      rw.off = [cfg.align[0] - x0, cfg.align[1] - y1];
    }
    for (let f = 0; f < 9; f++) {
      const im = await load(`${DIR}/${rw.dir}/${rw.frames ? rw.frames[f] : f}.png`);
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
      if (rw.clip?.includes(f)) for (let y = groundY + 1; y < im.h; y++) for (let x = 0; x < im.w; x++) px[(y * im.w + x) * 4 + 3] = 0;
      if (cfg.fix) { const r = cfg.fix(px, im.w, im.h, rw.name, f); if (Object.values(r).some(Boolean)) fixed += ` ${f}:${Object.values(r).join('/')}`; }
      const [ox, oy] = rw.off;
      for (let y = 0; y < im.h; y++) for (let x = 0; x < im.w; x++) {
        const si = (y * im.w + x) * 4; if (!px[si + 3]) continue;
        const dx = f * CELL + x + ox, dy = r * CELL + y + oy;
        if (x + ox < 0 || x + ox >= CELL || y + oy < 0 || y + oy >= CELL) throw new Error(`${rw.dir} ${f}: pixel outside its cell`);
        px.copy(sheet, (dy * SW + dx) * 4, si, si + 4);
      }
    }
    console.log(`${rw.name} (${rw.dir}): removed ${removed} specks, kept ${kept} debris clusters${fixed ? `; fix (frame:px per fix)${fixed}` : ''}`);
  }
  const out = path.join(__dirname, '..', '..', 'assets', cfg.file);
  await sharp(sheet, { raw: { width: SW, height: CELL * ROWS.length, channels: 4 } }).png({ compressionLevel: 9 }).toFile(out);
  console.log('wrote', out);
})();
