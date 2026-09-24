// Abyssal Kraken hand fix, applied by build-boss-sheet.cjs (the kraken's
// `fix` hook) after speck cleanup, in PixelLab frame coordinates (= cell
// coordinates: its rows sit at off [0, 0]).
//
// The rotation has a loose tentacle piece floating below-left of the body
// (57–91 px), and v3 carried it into the early frames of every animation.
// Removed, not reattached: every piece that isn't the body, counted
// 4-connected (it touches another tentacle only at a corner in idle 3 / 6),
// small (< 150 px) and in the lower-left corner (x < 45, y >= 60) — where
// it merges into a real curling tentacle (hurt 5–8, the death's sprawl) it
// is part of the body and stays.
module.exports = function krakenFix(px, w, h) {
  const a = (x, y) => x >= 0 && y >= 0 && x < w && y < h && px[(y * w + x) * 4 + 3];
  const lab = new Int32Array(w * h).fill(-1), comps = [];
  for (let i = 0; i < w * h; i++) {
    if (!a(i % w, (i / w) | 0) || lab[i] >= 0) continue;
    const st = [i], pts = []; lab[i] = comps.length;
    while (st.length) {
      const p = st.pop(); pts.push(p); const x = p % w, y = (p / w) | 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const q = (y + dy) * w + x + dx;
        if (a(x + dx, y + dy) && lab[q] < 0) { lab[q] = comps.length; st.push(q); }
      }
    }
    comps.push(pts);
  }
  comps.sort((p, q) => q.length - p.length);
  let tentacle = 0;
  for (const c of comps.slice(1)) {
    if (c.length >= 150 || !c.every((p) => p % w < 45 && ((p / w) | 0) >= 60)) continue;
    for (const p of c) px[p * 4 + 3] = 0;
    tentacle += c.length;
  }
  return { tentacle };
};
