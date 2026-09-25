/* eslint-disable @typescript-eslint/no-require-imports */
// Rough helper: the Scatter-Brick Serpent's FRONT (south) view for its
// Trophy Case statue, fixed like its south-west reference (serpent-taper.cjs
// / serpent-head.cjs; docs/pixellab-style.md, Serpent record).
// serpent-front-pixen.png is PixelLab's Pixen edit of the south rotation
// (1 generation, the reference's wording): a cream belly stripe down the
// neck and brick rows along the body; it kept the open mouth and tongue,
// but not a taper. This tapers by hand: the tail, row by row around its own
// centre, to a point (TAIL rows); the coil's top edge where the tail joins,
// slimmed 1–2 px (COIL_EDGE). Outline redrawn on every cut.
//   in:  PIXELLAB_WORK/south/serpent-front-pixen.png
//   out: PIXELLAB_WORK/south/serpent-front.png (build-fronts.cjs's input)
const sharp = require('sharp');
const path = require('node:path');
const { clusters, MIN } = require('./specks.cjs');
const W = path.join(process.env.PIXELLAB_WORK || path.join(__dirname, 'work'), 'south');
const INK = [12, 10, 16, 255];
// The tail: rows 21–42 in columns 55–70; its coloured width goes from 1 at
// the tip to 7 at the base.
const TAIL = { x0: 55, x1: 70, top: 21, base: 42, tip: 1, width: 7 };
// The coil's top edge next to the tail base: columns 44–57, rows 43–46,
// shaved 1 px (2 px from column 51).
const COIL_EDGE = { x0: 44, x1: 57, y0: 43, y1: 46, twoFrom: 51 };

(async () => {
  const { data, info } = await sharp(`${W}/serpent-front-pixen.png`).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const w = info.width, h = info.height, px = Buffer.from(data);
  const at = (x, y) => (y * w + x) * 4;
  const on = (x, y) => x >= 0 && y >= 0 && x < w && y < h && px[at(x, y) + 3];
  const ink = (x, y) => on(x, y) && px[at(x, y)] + px[at(x, y) + 1] + px[at(x, y) + 2] < 90;
  let cut = 0;

  // Tail: per row, keep `target` coloured pixels centred on the row's run.
  for (let y = TAIL.top; y <= TAIL.base; y++) {
    const cols = [];
    for (let x = TAIL.x0; x <= TAIL.x1; x++) if (on(x, y) && !ink(x, y)) cols.push(x);
    if (!cols.length) continue;
    const target = Math.round(TAIL.tip + ((y - TAIL.top) * (TAIL.width - TAIL.tip)) / (TAIL.base - TAIL.top));
    const mid = (cols[0] + cols[cols.length - 1]) / 2;
    const k0 = Math.round(mid - (target - 1) / 2), k1 = k0 + target - 1;
    for (let x = TAIL.x0; x <= TAIL.x1; x++) {
      if (!on(x, y)) continue;
      if (x === k0 - 1 || x === k1 + 1) px.set(INK, at(x, y));
      else if (x < k0 - 1 || x > k1 + 1) { px[at(x, y) + 3] = 0; cut++; }
    }
  }
  // Close the tip.
  for (let x = TAIL.x0; x <= TAIL.x1; x++) if (on(x, TAIL.top) && !ink(x, TAIL.top) && !on(x, TAIL.top - 1)) px.set(INK, at(x, TAIL.top - 1));

  // Coil's top edge: shave from the top of each column, then re-ink.
  for (let x = COIL_EDGE.x0; x <= COIL_EDGE.x1; x++) {
    const n = x >= COIL_EDGE.twoFrom ? 2 : 1;
    let y = COIL_EDGE.y0;
    while (y <= COIL_EDGE.y1 && !on(x, y)) y++;
    if (y > COIL_EDGE.y1) continue;
    for (let k = 0; k < n; k++) { px[at(x, y + k) + 3] = 0; cut++; }
    px.set(INK, at(x, y + n));
  }

  // Cuts can leave a stray outline dash: drop clusters under 10 px (as
  // build-fronts.cjs does), so this preview is exactly what ships.
  let specks = 0;
  for (const c of clusters({ w, h, px })) if (c.length < MIN) { specks++; for (const p of c) px[p * 4 + 3] = 0; }
  await sharp(px, { raw: { width: w, height: h, channels: 4 } }).png().toFile(`${W}/serpent-front.png`);
  console.log(`serpent front: cut ${cut} px, removed ${specks} specks`);
})();
