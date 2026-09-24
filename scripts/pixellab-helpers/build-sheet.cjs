/* eslint-disable @typescript-eslint/no-require-imports */
// Rough, one-off helper built for the Alarm Clock Swarm's hand-guided death
// animation (docs/pixellab-style.md, "Alarm Clock Swarm record"). Kept for
// reuse on later bosses, not polished tooling. Inputs are PixelLab
// downloads, not kept in the repo: set PIXELLAB_WORK to a folder holding
// sw.png (the south-west rotation) and <animation>/<0-8>.png frames
// (default: scripts/pixellab-helpers/work/, which is git-ignored).
// Assembles assets/alarm-clock-swarm-pixellab.png from the chosen PixelLab
// frames: 96×96 cells, rows idle / attack / hurt / death (death-v3) / move,
// 9 columns, the south-west rotation at the same spot (16,16) in every cell.
// Speck cleanup (clusters < 10 px, 8-connected; < 20 px inside the ring):
//   - frame 0 of every row, and all of idle / move: every small cluster goes
//   - attack / hurt / death frames 1–7: only those inside the ring's hole
//     (the rotation's specks); outer debris (sparks, scatter, shards) stays
//   - death frame 8 (the hand-drawn heap): untouched
const sharp = require('sharp');
const { load, clusters, MIN, S } = require('./specks.cjs');
const CELL = 96;
const ROWS = [
  { name: 'idle', dir: 'idle', off: [2, 2], keepOuter: () => false },
  { name: 'attack', dir: 'attack', off: [2, 2], keepOuter: (f) => f >= 1 && f <= 7 },
  { name: 'hurt', dir: 'hurt', off: [2, 2], keepOuter: (f) => f >= 1 && f <= 7 },
  { name: 'death', dir: 'death-v3', off: [0, 8], keepOuter: (f) => f >= 1 && f <= 7, keepAll: (f) => f === 8 },
  { name: 'move', dir: 'move', off: [2, 2], keepOuter: () => false },
];
const INNER_R = 18;
const INNER_MAX = 20; // inside the ring, specks up to 19 px go (a few 10–15 px ones)

(async () => {
  const sheet = Buffer.alloc(CELL * 9 * CELL * ROWS.length * 4);
  const SW = CELL * 9;
  const report = [];
  for (const [r, row] of ROWS.entries()) {
    let removed = 0, kept = 0;
    for (let f = 0; f < 9; f++) {
      const im = await load(`${S}/${row.dir}/${f}.png`);
      const px = Buffer.from(im.px);
      if (!row.keepAll?.(f)) {
        const cs = clusters(im); const big = cs.filter((c) => c.length >= MIN);
        let sx = 0, sy = 0, n = 0; for (const c of big) for (const p of c) { sx += p % im.w; sy += (p / im.w) | 0; n++; }
        const cx = sx / n, cy = sy / n;
        for (const c of cs) {
          if (c.length >= INNER_MAX) continue;
          let mx = 0, my = 0; for (const p of c) { mx += p % im.w; my += (p / im.w) | 0; } mx /= c.length; my /= c.length;
          const inner = Math.hypot(mx - cx, my - cy) < INNER_R;
          if (c.length >= MIN && !inner) continue;
          if (!inner && row.keepOuter(f)) { kept++; continue; }
          removed++; for (const p of c) px[p * 4 + 3] = 0;
        }
      }
      const [ox, oy] = row.off;
      for (let y = 0; y < im.h; y++) for (let x = 0; x < im.w; x++) {
        const si = (y * im.w + x) * 4; if (!px[si + 3]) continue;
        const di = ((r * CELL + y + oy) * SW + f * CELL + x + ox) * 4;
        px.copy(sheet, di, si, si + 4);
      }
    }
    report.push(`${row.name}: removed ${removed} specks, kept ${kept} debris clusters`);
  }
  await sharp(sheet, { raw: { width: SW, height: CELL * ROWS.length, channels: 4 } })
    .png({ compressionLevel: 9 }).toFile(require('node:path').join(__dirname, '..', '..', 'assets', 'alarm-clock-swarm-pixellab.png'));
  console.log(report.join('\n'));
})();
