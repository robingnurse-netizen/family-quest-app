/* eslint-disable @typescript-eslint/no-require-imports */
// Rough, one-off helper built for the Alarm Clock Swarm's hand-guided death
// animation (docs/pixellab-style.md, "Alarm Clock Swarm record"). Kept for
// reuse on later bosses, not polished tooling. Inputs are PixelLab
// downloads, not kept in the repo: set PIXELLAB_WORK to a folder holding
// sw.png (the south-west rotation) and <animation>/<0-8>.png frames
// (default: scripts/pixellab-helpers/work/, which is git-ignored).
// Builds a hand-assembled "broken clock heap" end frame (64×64, same canvas
// as the south-west rotation) for the Alarm Clock Swarm death animation.
const sharp = require('sharp');
const S = process.env.PIXELLAB_WORK || require('node:path').join(__dirname, 'work');
const GROUND = 58; // the rotation's lowest row (idle bottom)

const hex = (h) => [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16), 255];
const C = {
  ink: hex('040204'), white: hex('f2f6f4'), steel: hex('b6bcda'), steelD: hex('7c7eaa'),
  red: hex('df312d'), redD: hex('8d213a'), orange: hex('e75725'), gold: hex('f2812f'),
  cream: hex('f7efd7'), creamD: hex('f0d8b3'), hole: hex('1a0a14'),
};

function img(w, h) { return { w, h, px: new Uint8Array(w * h * 4) }; }
function get(im, x, y) { const i = (y * im.w + x) * 4; return im.px.slice(i, i + 4); }
function set(im, x, y, c) {
  if (x < 0 || y < 0 || x >= im.w || y >= im.h) return;
  const i = (y * im.w + x) * 4; im.px[i] = c[0]; im.px[i + 1] = c[1]; im.px[i + 2] = c[2]; im.px[i + 3] = c[3];
}
function crop(src, x0, y0, x1, y1) {
  const o = img(x1 - x0 + 1, y1 - y0 + 1);
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) set(o, x - x0, y - y0, get(src, x, y));
  return keepBiggest(o);
}
// Keep only the largest connected blob (drops neighbours' fragments / specks).
function keepBiggest(im) {
  const lab = new Int32Array(im.w * im.h).fill(-1); let best = -1, bestN = 0, n = 0;
  for (let i = 0; i < im.w * im.h; i++) {
    if (!im.px[i * 4 + 3] || lab[i] >= 0) continue;
    const st = [i]; lab[i] = n; let cnt = 0;
    while (st.length) {
      const p = st.pop(); cnt++; const x = p % im.w, y = (p / im.w) | 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= im.w || ny >= im.h) continue;
        const q = ny * im.w + nx; if (im.px[q * 4 + 3] && lab[q] < 0) { lab[q] = n; st.push(q); }
      }
    }
    if (cnt > bestN) { bestN = cnt; best = n; } n++;
  }
  for (let i = 0; i < im.w * im.h; i++) if (lab[i] !== best) im.px[i * 4 + 3] = 0;
  return im;
}
function rot90(im) { // clockwise
  const o = img(im.h, im.w);
  for (let y = 0; y < im.h; y++) for (let x = 0; x < im.w; x++) set(o, im.h - 1 - y, x, get(im, x, y));
  return o;
}
function flipH(im) { const o = img(im.w, im.h); for (let y = 0; y < im.h; y++) for (let x = 0; x < im.w; x++) set(o, im.w - 1 - x, y, get(im, x, y)); return o; }
function flipV(im) { const o = img(im.w, im.h); for (let y = 0; y < im.h; y++) for (let x = 0; x < im.w; x++) set(o, x, im.h - 1 - y, get(im, x, y)); return o; }
function blit(dst, src, ox, oy) {
  for (let y = 0; y < src.h; y++) for (let x = 0; x < src.w; x++) { const c = get(src, x, y); if (c[3]) set(dst, ox + x, oy + y, c); }
}
function bounds(im) {
  let x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1;
  for (let y = 0; y < im.h; y++) for (let x = 0; x < im.w; x++) if (im.px[(y * im.w + x) * 4 + 3]) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  return { x0, y0, x1, y1 };
}
const isFace = (c) => c[3] && c[0] > 225 && c[1] > 190 && c[2] > 150 && !(c[0] > 235 && c[1] > 240 && c[2] > 235);
// A crack: jagged dark line drawn only over the clock face (glass).
function crack(im, pts) {
  for (let k = 0; k + 1 < pts.length; k++) {
    let [x, y] = pts[k]; const [x2, y2] = pts[k + 1];
    const n = Math.max(Math.abs(x2 - x), Math.abs(y2 - y));
    for (let s = 0; s <= n; s++) {
      const px = Math.round(x + ((x2 - x) * s) / n), py = Math.round(y + ((y2 - y) * s) / n);
      if (isFace(get(im, px, py))) set(im, px, py, C.ink);
    }
  }
}
// Knock out part of a face (shattered glass → dark hole), face pixels only.
function smash(im, cx, cy, r) {
  for (let y = cy - r; y <= cy + r; y++) for (let x = cx - r; x <= cx + r; x++) {
    if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r + ((x * 7 + y * 3) % 3) - 1 && isFace(get(im, x, y))) set(im, x, y, C.hole);
  }
}
function pixels(dst, ox, oy, rows, pal) {
  rows.forEach((row, y) => [...row].forEach((ch, x) => { if (pal[ch]) set(dst, ox + x, oy + y, pal[ch]); }));
}

(async () => {
  const { data, info } = await sharp(`${S}/sw.png`).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const src = { w: info.width, h: info.height, px: new Uint8Array(data) };

  // Clock bodies (with wing stubs) from the ring, by eye from the 8× grid.
  const A = crop(src, 6, 10, 20, 27);   // top-left
  const B = crop(src, 27, 4, 43, 20);   // top
  const Cc = crop(src, 44, 15, 58, 32); // right-top
  const D = crop(src, 2, 28, 16, 46);   // left-mid
  const E = crop(src, 17, 38, 36, 58);  // bottom (largest)
  const F = crop(src, 41, 33, 56, 52);  // right-bottom

  const out = img(64, 64);

  // Snapped wings flattened underneath the pile (bottom layer).
  const wingL = crop(src, 0, 35, 7, 41);
  const wingR = crop(src, 55, 25, 62, 31);
  blit(out, flipV(wingL), 1, GROUND - 6);
  blit(out, wingR, 54, GROUND - 6);
  blit(out, rot90(crop(src, 38, 7, 47, 13)), 44, GROUND - 9);

  // Bottom row: D upside-down (left), E split open (centre), F on its side (right).
  const d = flipV(D); smash(d, 8, 9, 2); crack(d, [[4, 5], [7, 9], [6, 12], [9, 15]]);
  blit(out, d, 0, GROUND - d.h + 1);
  const f = rot90(F); crack(f, [[4, 3], [7, 7], [6, 10], [10, 13]]); smash(f, 11, 6, 2);
  blit(out, f, 44, GROUND - f.h + 1);

  // E split in two halves pushed apart, springs spilling from the gap.
  const eb = bounds(E), mid = Math.round((eb.x0 + eb.x1) / 2);
  const eL = img(E.w, E.h), eR = img(E.w, E.h);
  for (let y = 0; y < E.h; y++) for (let x = 0; x < E.w; x++) { const c = get(E, x, y); if (!c[3]) continue; set(x < mid ? eL : eR, x, y, c); }
  for (let y = 0; y < E.h; y++) { // dark broken edges on both halves
    for (let x = mid - 1; x >= 0; x--) if (get(eL, x, y)[3]) { set(eL, x, y, C.ink); break; }
    for (let x = mid; x < E.w; x++) if (get(eR, x, y)[3]) { set(eR, x, y, C.ink); break; }
  }
  const eLr = eL, eRr = rot90(rot90(rot90(eR))); // right half tipped over
  const eBase = GROUND - E.h + 1;
  blit(out, eLr, 16, eBase);
  const rb = bounds(eRr);
  blit(out, eRr, 32 - rb.x0, GROUND - rb.y1);


  // Second layer: A tipped left, C tumbling onto the right side, B on its
  // back in the middle (the top of the heap).
  const a = rot90(rot90(rot90(A))); crack(a, [[3, 4], [6, 7], [5, 10]]);
  blit(out, a, 7, GROUND - a.h - 9);
  const c = flipH(rot90(Cc)); crack(c, [[4, 5], [8, 8], [9, 12]]); smash(c, 9, 9, 2);
  blit(out, c, 37, GROUND - c.h - 8);
  const b = flipV(B); crack(b, [[4, 6], [7, 9], [11, 8]]); smash(b, 9, 11, 2);
  blit(out, b, 23, GROUND - b.h - 13);

  const pal = { k: C.ink, w: C.white, s: C.steel, d: C.steelD, g: C.gold, r: C.red };
  // Springs: stretched coils spilling out of the split clock and the pile.
  const coil = ['..kkk..', '.kwssk.', 'k.kkk.k', '.kwssk.', 'k.kkk.k', '.kwssk.', '..kkk..'];
  pixels(out, 27, GROUND - 10, coil, pal);
  pixels(out, 6, GROUND - 25, ['.kkk.', 'kwssk', '.kkk.', 'kwssk', '.kkk.', '..k..', '..k..'], pal);
  pixels(out, 51, GROUND - 26, ['.kkk.', 'kwssk', '.kkk.', 'kwssk', '.kkk.', '.k...'], pal);
  // Bent bell hammers: a gold knob on a crooked stick, stuck in the pile.
  pixels(out, 36, GROUND - 35, ['kkk..', 'kggk.', 'kkk..', '..k..', '...k.', '...k.', '...k.'], pal);
  pixels(out, 17, GROUND - 31, ['..kkk', '.kggk', '..kkk', '..k..', '.k...', '.k...'], pal);

  // Glass shards and bits flung around the base (all on or above the ground).
  const shard = (x, y, s) => pixels(out, x, y, s, pal);
  shard(0, GROUND - 1, ['kw', 'kk']);
  shard(62, GROUND - 1, ['w', 'k']);
  shard(1, GROUND - 9, ['w.', 'kw']);
  shard(61, GROUND - 12, ['.w', 'wk']);
  shard(14, GROUND - 38, ['w', 'k']);
  shard(46, GROUND - 36, ['wk']);
  shard(3, GROUND - 18, ['kw']);

  // Nothing below the ground line.
  for (let y = GROUND + 1; y < 64; y++) for (let x = 0; x < 64; x++) out.px[(y * 64 + x) * 4 + 3] = 0;

  const bb = bounds(out);
  console.log('heap bounds', bb, 'w', bb.x1 - bb.x0 + 1, 'h', bb.y1 - bb.y0 + 1);
  await sharp(Buffer.from(out.px), { raw: { width: 64, height: 64, channels: 4 } }).png().toFile(`${S}/heap-end.png`);
  await sharp(`${S}/heap-end.png`).resize(512, 512, { kernel: 'nearest' }).flatten({ background: '#9fc7d6' }).toFile(`${S}/heap-end-8x.png`);
})();
