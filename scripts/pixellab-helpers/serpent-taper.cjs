/* eslint-disable @typescript-eslint/no-require-imports */
// Rough helper: tapers the Scatter-Brick Serpent's body on its reference
// sprite (docs/pixellab-style.md, Serpent record). fix-v1.png is PixelLab's
// Pixen edit of the south-west rotation (a cream belly stripe and brick rows
// that follow the body), whose silhouette is still the original's: a coil of
// near-uniform width with a thin tail stuck on. This erodes the body inward
// by `shave(x, y)` pixels — 0 along the neck and the left of the coil, rising
// along the back coil and the front loop toward the right, where the tail
// joins (the old ~12 px → 7 px step) — then trims the tail row by row from
// its outer (right) side to TAIL_WIDTH, so it narrows smoothly to a point
// at its full length, and redraws the outline. Writes fix-v2.png.
const sharp = require('sharp');
const path = require('node:path');
const W = path.join(process.env.PIXELLAB_WORK || path.join(__dirname, 'work'), 'scatter_brick_serpent');
const INK = [12, 10, 16, 255];

// Pixels to shave off each exposed edge, by where the body is.
function shave(x, y) {
  if (x >= 58 && y < 44) return 0; // the tail: trimmed row by row below
  if (y >= 43 && y <= 51 && x >= 40) return x >= 56 ? 3 : x >= 48 ? 2 : 1; // back coil's top edge, thinning toward the tail
  if (x >= 60 && y > 51) return 3; // the right-hand curve
  if (y >= 58 && x >= 42) return x >= 58 ? 3 : x >= 50 ? 2 : 1; // front loop, thinning from the middle to the right
  return 0;
}
// The tail's coloured width per row (x ≥ 58, rows 28–47): 2 at the tip,
// widening one pixel every ~4 rows to 6 where it meets the coil.
const TAIL_TOP = 28, TAIL_BASE = 47;
const tailWidth = (y) => Math.round(2 + ((y - TAIL_TOP) * 4) / (TAIL_BASE - TAIL_TOP));

(async () => {
  const { data, info } = await sharp(`${W}/fix-v1.png`).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const w = info.width, h = info.height, src = Buffer.from(data), out = Buffer.from(data);
  const on = (x, y) => x >= 0 && y >= 0 && x < w && y < h && src[(y * w + x) * 4 + 3] > 0;
  // Distance (4-connected steps) from each opaque pixel to the nearest transparent one.
  const dist = new Int32Array(w * h).fill(1e9);
  const q = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (!on(x, y)) { dist[y * w + x] = 0; q.push(y * w + x); }
  for (let i = 0; i < q.length; i++) {
    const p = q[i], x = p % w, y = (p / w) | 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const n = ny * w + nx; if (dist[n] > dist[p] + 1) { dist[n] = dist[p] + 1; q.push(n); }
    }
  }
  let removed = 0, inked = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const s = shave(x, y), d = dist[y * w + x], i = (y * w + x) * 4;
    if (!s || !d) continue;
    if (d <= s) { out[i + 3] = 0; removed++; } // shaved away
    else if (d === s + 1) { out.set(INK, i); inked++; } // the new outline
  }
  // The tail: per row, keep `tailWidth` coloured pixels from the inner
  // (left) outline, drop the rest and close the row with outline.
  let trimmed = 0;
  const isInk = (i) => out[i + 3] && out[i] + out[i + 1] + out[i + 2] < 80;
  for (let y = TAIL_TOP; y <= TAIL_BASE; y++) {
    let xl = -1;
    for (let x = 58; x < w; x++) { const i = (y * w + x) * 4; if (out[i + 3] && !isInk(i)) { xl = x; break; } }
    if (xl < 0) continue;
    const keep = tailWidth(y);
    for (let x = xl + keep; x < w; x++) {
      const i = (y * w + x) * 4;
      if (!out[i + 3]) break;
      if (x === xl + keep) out.set(INK, i); else { out[i + 3] = 0; trimmed++; }
    }
  }
  // The very tip: outline across its top.
  for (let x = 58; x < w; x++) {
    const i = (TAIL_TOP * w + x) * 4, a = ((TAIL_TOP - 1) * w + x) * 4;
    if (out[i + 3] && !isInk(i) && !out[a + 3]) out.set(INK, a);
  }
  await sharp(out, { raw: { width: w, height: h, channels: 4 } }).png().toFile(`${W}/fix-v2.png`);
  console.log(`shaved ${removed} px, ${inked} px of new outline, tail trimmed ${trimmed} px`);
})();
