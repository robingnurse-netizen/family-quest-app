/* eslint-disable @typescript-eslint/no-require-imports */
// Rough helper (like spider-heap.cjs), NO LONGER USED: after review the
// shattered heap read as an object breaking apart, not a humanoid collapse,
// so his death is now the first-generation knockdown (kept for reference).
// It was the hand-assembled END FRAME for the Mud-Track Minotaur's death (docs/pixellab-style.md, Minotaur record) —
// three generated deaths either fell without breaking, broke without falling
// or sank into an intact crouch. Same 76×76 canvas as his start frame
// (PIXELLAB_WORK/mud_track_minotaur/start.png, the puddle-free rotation from
// minotaur-start.cjs): the body below the head is cut into irregular mud
// chunks (Voronoi cells), every cut edge inked like a crack, and the chunks
// dropped straight down into a low pile, spread outward; the head lies on
// the heap's front (left) with its eye shut and the far horn snapped off,
// lying on the ground in front. Writes end.png (+ an 8× preview).
const sharp = require('sharp');
const path = require('node:path');
const W = path.join(process.env.PIXELLAB_WORK || path.join(__dirname, 'work'), 'mud_track_minotaur');
const N = 76, GROUND = 70; // the start frame's lowest row (the near hoof)
const INK = [17, 12, 10, 255];

const img = () => ({ w: N, h: N, px: new Uint8Array(N * N * 4) });
const get = (im, x, y) => (x < 0 || y < 0 || x >= im.w || y >= im.h ? [0, 0, 0, 0] : [...im.px.slice((y * im.w + x) * 4, (y * im.w + x) * 4 + 4)]);
function set(im, x, y, c) { if (x < 0 || y < 0 || x >= im.w || y >= im.h) return; im.px.set(c, (y * im.w + x) * 4); }
const inPoly = (pts, x, y) => {
  let c = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i], [xj, yj] = pts[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
};
// Horn bone (cream to beige shading) vs fur: the horn's green is much closer
// to its red.
const isHorn = (c) => c[3] && c[0] > 110 && c[1] / c[0] > 0.78 && c[2] / c[0] > 0.55;
const isDark = (c) => c[3] && c[0] + c[1] + c[2] < 110;

(async () => {
  const { data } = await sharp(`${W}/start.png`).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const src = { w: N, h: N, px: new Uint8Array(data) };

  // --- Head (horns, face, snout) and the rest (the body).
  const HEAD = [[12, 2], [48, 2], [48, 17], [45, 24], [38, 30], [31, 38], [26, 41], [12, 41]];
  const head = img(), body = img();
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const c = get(src, x, y); if (!c[3]) continue;
    set(inPoly(HEAD, x + 0.5, y + 0.5) ? head : body, x, y, c);
  }
  // Snap off the far (right) horn: its cream pixels plus the outline that
  // only borders them.
  const horn = img();
  const inHornBox = (x, y) => x >= 33 && y <= 18;
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) if (inHornBox(x, y) && isHorn(get(head, x, y))) set(horn, x, y, get(head, x, y));
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    if (!inHornBox(x, y) || !isDark(get(head, x, y))) continue;
    let touchesHorn = false, touchesOther = false;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const c = get(head, x + dx, y + dy); if (!c[3] || isDark(c)) continue;
      if (isHorn(c)) touchesHorn = true; else touchesOther = true;
    }
    if (touchesHorn && !touchesOther) set(horn, x, y, get(head, x, y));
  }
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) if (get(horn, x, y)[3]) set(head, x, y, [0, 0, 0, 0]);
  // The stump: ink where the horn met the head.
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    if (!get(head, x, y)[3] || isDark(get(head, x, y))) continue;
    if ([[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => get(horn, x + dx, y + dy)[3])) set(head, x, y, INK);
  }
  // Eye shut: the eye (whites + pupil, x 28–34, y 20–24) becomes a dark lid line.
  for (let y = 20; y <= 24; y++) for (let x = 28; x <= 34; x++) {
    const c = get(head, x, y); if (!c[3]) continue;
    if (c[0] > 150 && c[1] > 150 && c[2] > 150 || isDark(c)) set(head, x, y, y === 22 ? INK : [110, 70, 45, 255]);
  }
  for (let x = 28; x <= 33; x++) if (get(head, x, 22)[3]) set(head, x, 22, INK);

  // --- Body → Voronoi chunks.
  const SEEDS = [[18, 50], [30, 58], [34, 44], [44, 64], [46, 34], [50, 50], [60, 38], [62, 56], [22, 64]];
  const cell = new Int8Array(N * N).fill(-1);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    if (!get(body, x, y)[3]) continue;
    let best = 0, bd = 1e9;
    SEEDS.forEach(([sx, sy], i) => { const d = (sx - x) ** 2 + (sy - y) ** 2 * 1.3; if (d < bd) { bd = d; best = i; } });
    cell[y * N + x] = best;
  }
  const chunks = SEEDS.map(() => ({ pts: [] }));
  for (let i = 0; i < N * N; i++) if (cell[i] >= 0) {
    const x = i % N, y = (i / N) | 0; let c = get(body, x, y);
    // Cracks: pixels on a cut (next to another cell) become ink.
    const cut = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => { const j = (y + dy) * N + x + dx; return x + dx >= 0 && x + dx < N && y + dy >= 0 && y + dy < N && cell[j] >= 0 && cell[j] !== cell[i]; });
    if (cut) c = INK;
    chunks[cell[i]].pts.push([x, y, c]);
  }
  // Keep each chunk's main solid piece (its biggest 4-connected run of
  // non-ink pixels) and the ink bordering it; slivers of outline or shadow
  // would balance on single pixels and spike the pile.
  for (const k of chunks) {
    const key = (x, y) => y * N + x, m = new Map(k.pts.map((p) => [key(p[0], p[1]), p]));
    const solid = (p) => p && !isDark(p[2]);
    const seen = new Set(); let main = [];
    for (const p of k.pts) {
      if (!solid(p) || seen.has(key(p[0], p[1]))) continue;
      const comp = [], st = [p]; seen.add(key(p[0], p[1]));
      while (st.length) {
        const q = st.pop(); comp.push(q);
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const r = m.get(key(q[0] + dx, q[1] + dy));
          if (solid(r) && !seen.has(key(r[0], r[1]))) { seen.add(key(r[0], r[1])); st.push(r); }
        }
      }
      if (comp.length > main.length) main = comp;
    }
    const mk = new Set(main.map((p) => key(p[0], p[1])));
    k.pts = k.pts.filter((p) => mk.has(key(p[0], p[1])) ||
      (isDark(p[2]) && [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]].some(([dx, dy]) => mk.has(key(p[0] + dx, p[1] + dy)))));
    k.solid = main.length;
  }
  const live = chunks.filter((k) => k.solid >= 25);
  for (const k of live) {
    k.cx = k.pts.reduce((s, p) => s + p[0], 0) / k.pts.length;
    k.bottom = Math.max(...k.pts.map((p) => p[1]));
  }

  // --- Pile the chunks: biggest first, each at the x (within reach of where
  // it was) where it comes to rest lowest — falling straight down onto the
  // ground or onto chunks already there — so the pile spreads wide and low.
  const out = img(), occ = new Uint8Array(N * N);
  const fits = (k, dx, dy) => k.pts.every(([x, y]) => { const nx = x + dx, ny = y + dy; return nx >= 1 && nx < N - 1 && ny <= GROUND && (ny < 0 || !occ[ny * N + nx]); });
  const rest = (k, dx) => { let dy = -N; while (!fits(k, dx, dy)) dy++; while (fits(k, dx, dy + 1)) dy++; return dy; };
  live.sort((a, b) => b.pts.length - a.pts.length);
  for (const k of live) {
    let best = null;
    const home = Math.round((k.cx - 40) * 0.5);
    for (let dx = -N; dx <= N; dx++) {
      if (!k.pts.every(([x]) => x + dx >= 20 && x + dx < N - 1)) continue;
      const dy = rest(k, dx);
      // Lowest resting top wins; straying far from home costs a little.
      const score = Math.min(...k.pts.map((p) => p[1])) + dy - 0.25 * Math.abs(dx - home);
      if (!best || score > best.score) best = { dx, dy, score };
    }
    for (const [x, y, c] of k.pts) { const nx = x + best.dx, ny = y + best.dy; if (ny >= 0) { set(out, nx, ny, c); occ[ny * N + nx] = 1; } }
  }

  // --- The head on the heap's front (left), chin down; then the horn lying
  // on its side on the ground in front of it.
  const hb = bounds(head);
  const headDx = 6 - hb.x0, headDy = GROUND - 1 - hb.y1;
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) { const c = get(head, x, y); if (c[3]) set(out, x + headDx, y + headDy, c); }
  const b = bounds(horn);
  const hw = b.x1 - b.x0 + 1, hh = b.y1 - b.y0 + 1;
  // Rotated 90° so it lies flat (height hw), tip pointing right.
  for (let y = 0; y < hh; y++) for (let x = 0; x < hw; x++) {
    const c = get(horn, b.x0 + x, b.y0 + y); if (!c[3]) continue;
    set(out, 44 + (hh - 1 - y), GROUND - (hw - 1) + x, c);
  }

  // A few loose clods of dried mud on the ground around the pile.
  const CLOD = { k: INK, b: [92, 58, 34, 255], B: [140, 96, 58, 255] };
  for (const [cx, rows] of [[1, ['.kk.', 'kBbk', 'kkkk']], [58, ['.kkk.', 'kBbbk', 'kkkkk']], [69, ['.kk.', 'kBbk', 'kkkk']], [40, ['kk', 'kk']]]) {
    rows.forEach((row, y) => [...row].forEach((ch, x) => {
      const px = cx + x, py = GROUND - rows.length + 1 + y;
      if (CLOD[ch] && !get(out, px, py)[3]) set(out, px, py, CLOD[ch]);
    }));
  }

  for (let y = GROUND + 1; y < N; y++) for (let x = 0; x < N; x++) set(out, x, y, [0, 0, 0, 0]);
  const ob = bounds(out);
  console.log('end frame', ob, 'w', ob.x1 - ob.x0 + 1, 'h', ob.y1 - ob.y0 + 1, 'chunks', live.length);
  await sharp(Buffer.from(out.px), { raw: { width: N, height: N, channels: 4 } }).png().toFile(`${W}/end.png`);
  await sharp(`${W}/end.png`).resize(N * 8, N * 8, { kernel: 'nearest' }).flatten({ background: '#9fc7d6' }).toFile(`${W}/end-8x.png`);
})();

function bounds(im) {
  let x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1;
  for (let y = 0; y < im.h; y++) for (let x = 0; x < im.w; x++) if (im.px[(y * im.w + x) * 4 + 3]) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  return { x0, y0, x1, y1 };
}
