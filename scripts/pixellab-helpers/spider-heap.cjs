/* eslint-disable @typescript-eslint/no-require-imports */
// Rough helper (like heap.cjs, the swarm's): a hand-assembled END FRAME for
// the Cable Spider's death (docs/pixellab-style.md, Cable Spider record) —
// two generated deaths both ended standing on splayed legs with the body
// raised. Same 64×64 canvas as the south-west rotation (PIXELLAB_WORK/sw.png):
// the circuit-board body (cut from the rotation) dropped flat onto the
// ground row, cracked, eyes dark, a wisp of smoke; eight cable legs drawn
// sprawled flat along the ground on both sides, each ending in a plug lying
// on its side. Writes PIXELLAB_WORK/spider-end.png (+ an 8× preview).
const sharp = require('sharp');
const S = process.env.PIXELLAB_WORK || require('node:path').join(__dirname, 'work');
const GROUND = 62; // the rotation's lowest row (the plug tips)

const hex = (h) => [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16), 255];
const C = {
  ink: hex('000000'), navy: hex('1c1f43'), blue: hex('2b3252'), blueL: hex('4a6aab'),
  yellow: hex('f8c42f'), plug: hex('4a545c'), plugL: hex('66717a'), tip: hex('f3f3df'),
  dark: hex('270101'), eyeOff: hex('222842'), crack: hex('030506'),
  smoke: hex('596871'), smokeL: hex('8a949b'),
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
function blit(dst, src, ox, oy) {
  for (let y = 0; y < src.h; y++) for (let x = 0; x < src.w; x++) { const c = get(src, x, y); if (c[3]) set(dst, ox + x, oy + y, c); }
}
function bounds(im) {
  let x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1;
  for (let y = 0; y < im.h; y++) for (let x = 0; x < im.w; x++) if (im.px[(y * im.w + x) * 4 + 3]) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  return { x0, y0, x1, y1 };
}
function pixels(dst, ox, oy, rows, pal) {
  rows.forEach((row, y) => [...row].forEach((ch, x) => { if (pal[ch]) set(dst, ox + x, oy + y, pal[ch]); }));
}

// A limp cable leg: a 3-px-thick polyline (outline, navy core with blue
// highlight and yellow stripes) from (x0,y0) through the points, ending in a
// plug lying on its side pointing away from the body.
function cable(dst, pts, dir) {
  const core = [];
  for (let k = 0; k + 1 < pts.length; k++) {
    const [ax, ay] = pts[k], [bx, by] = pts[k + 1];
    const n = Math.max(Math.abs(bx - ax), Math.abs(by - ay));
    for (let s = 0; s <= n; s++) core.push([Math.round(ax + ((bx - ax) * s) / n), Math.round(ay + ((by - ay) * s) / n)]);
  }
  for (const [x, y] of core) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    const c = get(dst, x + dx, y + dy); if (!c[3]) set(dst, x + dx, y + dy, C.ink);
  }
  core.forEach(([x, y], i) => set(dst, x, y, i % 5 === 2 ? C.yellow : i % 2 ? C.blue : C.navy));
  for (const [x, y] of core) { const c = get(dst, x, y - 1); if (c[3] && c[0] === 0 && c[1] === 0 && c[2] === 0 && get(dst, x, y - 2)[3] === 0) set(dst, x, y - 1, C.ink); }
  for (let i = 1; i < core.length - 1; i += 3) { const [x, y] = core[i]; if (get(dst, x, y - 1)[3]) set(dst, x, y - 1, C.blueL); }
  // Plug (lying on its side) at the end.
  const [ex, ey] = core[core.length - 1];
  const plugR = ['kkkkk.', 'kppLkk', 'kpppLt', 'kkkkk.'];
  const plugL = plugR.map((r) => [...r].reverse().join(''));
  const rows = dir > 0 ? plugR : plugL;
  pixels(dst, dir > 0 ? ex + 1 : ex - 6, ey - 2, rows, { k: C.ink, p: C.plug, L: C.plugL, t: C.tip });
}

(async () => {
  const { data, info } = await sharp(`${S}/sw.png`).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const src = { w: info.width, h: info.height, px: new Uint8Array(data) };
  const out = img(64, 64);

  // Legs first (the body lies on top of their roots): four each side,
  // sprawled flat, fanning out along the ground.
  cable(out, [[20, 57], [12, 58], [6, 60]], -1);
  cable(out, [[18, 54], [10, 53], [3, 55]], -1);
  cable(out, [[22, 59], [16, 61], [11, 61]], -1);
  cable(out, [[19, 51], [13, 48], [7, 48]], -1);
  cable(out, [[44, 57], [52, 58], [57, 60]], 1);
  cable(out, [[46, 54], [53, 52], [58, 54]], 1);
  cable(out, [[40, 59], [47, 61], [51, 61]], 1);
  cable(out, [[45, 50], [51, 47], [56, 47]], 1);

  // The body (the circuit-board box with its top cables), dropped flat: its
  // bottom edge two rows above the ground, so leg roots show beneath.
  const body = crop(src, 15, 3, 51, 37);
  const bb = bounds(body);
  // Eyes go dark.
  for (let y = 0; y < body.h; y++) for (let x = 0; x < body.w; x++) {
    const c = get(body, x, y); if (c[3] && c[0] > 90 && c[1] < 60 && c[2] < 60) set(body, x, y, C.eyeOff);
    if (c[3] && c[0] > 200 && c[1] > 200 && c[2] > 180 && y > 20) set(body, x, y, C.eyeOff); // eye glints
  }
  const ox = 32 - Math.round((bb.x0 + bb.x1) / 2), oy = GROUND - 3 - bb.y1;
  blit(out, body, ox, oy);
  // A crack across the box: jagged dark line over the green panels.
  const isGreen = (c) => c[3] && c[1] > c[0] + 15 && c[1] >= c[2];
  const crackPts = [[22, oy + 22], [26, oy + 25], [29, oy + 23], [33, oy + 27], [37, oy + 25], [41, oy + 28]];
  for (let k = 0; k + 1 < crackPts.length; k++) {
    const [ax, ay] = crackPts[k], [bx, by] = crackPts[k + 1];
    const n = Math.max(Math.abs(bx - ax), Math.abs(by - ay));
    for (let s = 0; s <= n; s++) {
      const x = Math.round(ax + ((bx - ax) * s) / n), y = Math.round(ay + ((by - ay) * s) / n);
      if (isGreen(get(out, x, y))) set(out, x, y, C.crack);
    }
  }
  // A wisp of smoke rising from the crack.
  pixels(out, 33, oy + 8, ['..ss.', '.sLLs', '.sLs.', '..s..', '.s...', '.ss..'], { s: C.smoke, L: C.smokeL });

  // Nothing below the ground line.
  for (let y = GROUND + 1; y < 64; y++) for (let x = 0; x < 64; x++) out.px[(y * 64 + x) * 4 + 3] = 0;
  const b = bounds(out);
  console.log('end frame bounds', b, 'w', b.x1 - b.x0 + 1, 'h', b.y1 - b.y0 + 1);
  await sharp(Buffer.from(out.px), { raw: { width: 64, height: 64, channels: 4 } }).png().toFile(`${S}/spider-end.png`);
  await sharp(`${S}/spider-end.png`).resize(512, 512, { kernel: 'nearest' }).flatten({ background: '#9fc7d6' }).toFile(`${S}/spider-end-8x.png`);
})();
