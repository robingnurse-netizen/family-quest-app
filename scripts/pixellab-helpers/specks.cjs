/* eslint-disable @typescript-eslint/no-require-imports */
// Rough, one-off helper built for the Alarm Clock Swarm's hand-guided death
// animation (docs/pixellab-style.md, "Alarm Clock Swarm record"). Kept for
// reuse on later bosses, not polished tooling. Inputs are PixelLab
// downloads, not kept in the repo: set PIXELLAB_WORK to a folder holding
// sw.png (the south-west rotation) and <animation>/<0-8>.png frames
// (default: scripts/pixellab-helpers/work/, which is git-ignored).
// Lists small clusters (< 10 px, 8-connected) per frame of the swarm's
// chosen animations: distance from the ring centre and from the nearest
// big cluster, so specks (inside the ring) can be told from debris.
const sharp = require('sharp');
const S = process.env.PIXELLAB_WORK || require('node:path').join(__dirname, 'work');
const ANIMS = ['idle', 'attack', 'hurt', 'death-v3', 'move'];
const MIN = 10;

async function load(p) {
  const { data, info } = await sharp(p).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { w: info.width, h: info.height, px: data };
}
function clusters(im) {
  const { w, h, px } = im; const lab = new Int32Array(w * h).fill(-1); const out = [];
  for (let i = 0; i < w * h; i++) {
    if (!px[i * 4 + 3] || lab[i] >= 0) continue;
    const st = [i], pts = []; lab[i] = out.length;
    while (st.length) {
      const p = st.pop(); pts.push(p); const x = p % w, y = (p / w) | 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const q = ny * w + nx; if (px[q * 4 + 3] && lab[q] < 0) { lab[q] = out.length; st.push(q); }
      }
    }
    out.push(pts);
  }
  return out;
}
module.exports = { load, clusters, MIN, ANIMS, S };

if (require.main === module) (async () => {
  for (const a of ANIMS) {
    for (let f = 0; f < 9; f++) {
      const im = await load(`${S}/${a}/${f}.png`);
      const cs = clusters(im); const big = cs.filter((c) => c.length >= MIN), small = cs.filter((c) => c.length < MIN);
      let sx = 0, sy = 0, n = 0; for (const c of big) for (const p of c) { sx += p % im.w; sy += (p / im.w) | 0; n++; }
      const cx = sx / n, cy = sy / n;
      const bigSet = new Uint8Array(im.w * im.h); for (const c of big) for (const p of c) bigSet[p] = 1;
      const desc = small.map((c) => {
        let mx = 0, my = 0; for (const p of c) { mx += p % im.w; my += (p / im.w) | 0; } mx /= c.length; my /= c.length;
        let near = 99; for (const p of c) { const x = p % im.w, y = (p / im.w) | 0; for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) { const q = (y + dy) * im.w + x + dx; if (bigSet[q]) near = Math.min(near, Math.max(Math.abs(dx), Math.abs(dy))); } }
        return `${c.length}px r${Math.hypot(mx - cx, my - cy).toFixed(0)} g${near === 99 ? '>3' : near}`;
      });
      console.log(`${a} ${f}: big ${big.length} (${big.map((c) => c.length).join(',')}), small ${small.length}: ${desc.join(' | ')}`);
    }
  }
})();
