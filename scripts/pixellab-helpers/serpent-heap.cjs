/* eslint-disable @typescript-eslint/no-require-imports */
// Rough helper (the swarm's heap.cjs technique): the hand-assembled END
// FRAME for the Scatter-Brick Serpent's death (docs/pixellab-style.md,
// Serpent record), on the same 76×76 canvas as its reference frame
// (assets/scatter-brick-serpent-reference.png). He collapses rather than
// shatters: the coils stay on the ground; the raised neck and head drop
// forward and lie on the ground in front, eye shut, tongue out; the tail
// flops flat; a few loose bricks lie scattered around. Writes
// PIXELLAB_WORK/scatter_brick_serpent/end.png (+ an 8× preview).
const sharp = require('sharp');
const path = require('node:path');
const W = path.join(process.env.PIXELLAB_WORK || path.join(__dirname, 'work'), 'scatter_brick_serpent');
const REF = path.join(__dirname, '..', '..', 'assets', 'scatter-brick-serpent-reference.png');
const N = 76, GROUND = 73; // the reference's lowest row
const INK = [12, 10, 16, 255];

const img = () => ({ w: N, h: N, px: new Uint8Array(N * N * 4) });
const get = (im, x, y) => (x < 0 || y < 0 || x >= N || y >= N ? [0, 0, 0, 0] : [...im.px.slice((y * N + x) * 4, (y * N + x) * 4 + 4)]);
const set = (im, x, y, c) => { if (x >= 0 && y >= 0 && x < N && y < N) im.px.set(c, (y * N + x) * 4); };
const dark = (c) => c[3] && c[0] + c[1] + c[2] < 80;

(async () => {
  const { data } = await sharp(REF).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const ref = { w: N, h: N, px: new Uint8Array(data) };
  const out = img();

  // 1. The coils: everything from CUT down, minus the tail's upright part.
  const CUT = 45;
  const isTail = (x, y) => x >= 56 && y < 50;
  for (let y = CUT; y < N; y++) for (let x = 0; x < N; x++) {
    const c = get(ref, x, y);
    if (c[3] && !isTail(x, y)) set(out, x, y, c);
  }
  // Close the cut edges with outline (the neck stump, the tail's root).
  for (let y = CUT; y < N; y++) for (let x = 0; x < N; x++) {
    const c = get(out, x, y);
    if (!c[3] || dark(c)) continue;
    if (y === CUT || (isTail(x, y - 1) && !get(out, x, y - 1)[3])) set(out, x, y, INK);
  }

  // 2. The tail, laid flat along the ground to the right: its upright part
  //    turned 90° clockwise (the tip now points right), lying in front of
//    the coils.
  const tail = [];
  for (let y = 24; y < CUT - 1; y++) for (let x = 56; x < N; x++) { const c = get(ref, x, y); if (c[3]) tail.push([x, y, c]); }
  const ty1 = Math.max(...tail.map((p) => p[1]));
  const tx0 = Math.min(...tail.map((p) => p[0]));
  for (const [x, y, c] of tail) {
    // (x, y) → (x', y'): the tail's root (bottom) goes left, its tip right.
    const nx = 50 + (ty1 - y), ny = GROUND - 9 + (x - tx0);
    set(out, nx, ny, c); // in front of the coils
  }

  // 3. The head (with jaw, tongue and a little neck), dropped to lie on the
  //    ground in front of the coils, chin down; eye shut.
  const head = [];
  for (let y = 0; y < 40; y++) for (let x = 0; x < 56; x++) {
    const c = get(ref, x, y);
    if (!c[3]) continue;
    if (y > 33 && x > 30) continue; // leave the neck behind
    head.push([x, y, c]);
  }
  const hy1 = Math.max(...head.map((p) => p[1]));
  const drop = GROUND - hy1, shift = -11;
  for (const [x, y, c0] of head) {
    let c = c0;
    // The eye (x 32–37, rows 14–17): a shut lid line on row 16.
    if (x >= 32 && x <= 37 && y >= 14 && y <= 17) c = y === 16 ? INK : [150, 120, 80, 255];
    set(out, x + shift, y + drop, c);
  }

  // 4. Loose bricks on the ground (outline + two tones), from the body's palette.
  const BRICK = { k: INK, r: [214, 58, 52, 255], R: [150, 34, 44, 255], b: [74, 144, 214, 255], B: [42, 82, 150, 255], y: [240, 200, 80, 255], Y: [190, 140, 50, 255], g: [70, 180, 80, 255], G: [30, 110, 60, 255] };
  const bricks = [
    [1, ['kkkk', 'krRk', 'kkkk']],
    [44, ['kkkkk', 'kbbBk', 'kkkkk']],
    [70, ['kkkk', 'kyYk', 'kkkk']],
    [36, ['kkk', 'kgk', 'kkk']],
  ];
  for (const [bx, rows] of bricks) rows.forEach((row, y) => [...row].forEach((ch, x) => {
    const px = bx + x, py = GROUND - rows.length + 1 + y;
    if (BRICK[ch] && !get(out, px, py)[3]) set(out, px, py, BRICK[ch]);
  }));

  await sharp(Buffer.from(out.px), { raw: { width: N, height: N, channels: 4 } }).png().toFile(`${W}/end.png`);
  await sharp(`${W}/end.png`).resize(N * 8, N * 8, { kernel: 'nearest' }).flatten({ background: '#9fc7d6' }).toFile(`${W}/end-8x.png`);
  let lo = 1e9; for (let p = 0; p < N * N; p++) if (out.px[p * 4 + 3]) lo = Math.min(lo, (p / N) | 0);
  console.log(`end frame: top row ${lo}, height ${GROUND - lo + 1}`);
})();
