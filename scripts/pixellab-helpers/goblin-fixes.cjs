// Laundry Goblin hand fixes, applied by build-boss-sheet.cjs (the goblin's
// `fix` hook) to every frame after speck cleanup, in PixelLab frame
// coordinates (= cell coordinates: the goblin's rows sit at off [0, 0]).
//
// - Drips: v3 hung dark / water-blue dribbles off the wet sock that read as
//   noise, and most touch the sock diagonally (speck cleanup can't see them):
//     hang: everything left of the arm (x < 24) below the sock loop's lowest
//       solid row (a run of >= 4 px) goes — idle, move, attack 0/1/7/8,
//       hurt 0–3 / 7–8, death 0–4 (death 5–8 lie on the ground and hurt 4–6
//       tilt the sock: the rule would take a foot or the sock);
//     detached: attack 2–4 (sock raised overhead) lose every cluster but
//       the body; attack 5–6 keep their strike splash;
//     erase: the tilted streaks in hurt 4 / 6, pixel by pixel.
// - Ear: (28,32) is a pale speck on the left ear's outline (frame 0 of every
//   row) → outline black; the far (left) eye's highlight just below the ear
//   flashes bright cream in most frames and dims in others → held at a dim
//   grey (#a2a3a3) throughout, so no white pixel flickers at the ear (the
//   near eye keeps its glint).
const X1 = 24;
const ERASE = {
  'hurt 4': [[20, 43], [20, 44], [22, 46], [22, 47], [23, 47], [21, 48], [22, 48], [20, 49], [21, 49], [19, 50]],
  'hurt 6': [[19, 45], [19, 46], [22, 48], [23, 48], [21, 49], [22, 49], [21, 50], [20, 51], [19, 52]],
};

module.exports = function goblinFix(px, w, h, row, f) {
  const at = (x, y) => (y * w + x) * 4;
  const a = (x, y) => x >= 0 && y >= 0 && x < w && y < h && px[at(x, y) + 3];
  const clear = (x, y) => { px[at(x, y) + 3] = 0; };
  let dripped = 0;

  const mode = row === 'attack' ? ([2, 3, 4].includes(f) ? 'detached' : [5, 6].includes(f) ? 'none' : 'hang')
    : (row === 'death' && f >= 5) || (row === 'hurt' && f >= 4 && f <= 6) ? 'none' : 'hang';
  if (mode === 'hang') {
    let bottom = -1;
    for (let y = h - 1; y >= 0 && bottom < 0; y--) {
      let run = 0;
      for (let x = 0; x < X1 + 2; x++) { run = a(x, y) ? run + 1 : 0; if (run >= 5) { bottom = y; break; } }
    }
    if (bottom >= 0) for (let y = bottom + 1; y < h; y++) for (let x = 0; x < X1; x++) if (a(x, y)) { clear(x, y); dripped++; }
  } else if (mode === 'detached') {
    const lab = new Int32Array(w * h).fill(-1), comps = [];
    for (let i = 0; i < w * h; i++) {
      if (!a(i % w, (i / w) | 0) || lab[i] >= 0) continue;
      const st = [i], pts = []; lab[i] = comps.length;
      while (st.length) {
        const p = st.pop(); pts.push(p); const x = p % w, y = (p / w) | 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const q = (y + dy) * w + x + dx;
          if (a(x + dx, y + dy) && lab[q] < 0) { lab[q] = comps.length; st.push(q); }
        }
      }
      comps.push(pts);
    }
    comps.sort((p, q) => q.length - p.length);
    for (const c of comps.slice(1)) for (const p of c) { px[p * 4 + 3] = 0; dripped++; }
  }
  for (const [x, y] of ERASE[`${row} ${f}`] ?? []) if (a(x, y)) { clear(x, y); dripped++; }

  // Ear speck (pale grey, #b2bab9) → the outline's black; only a grey pixel
  // there (other poses put skin or the eye on that spot).
  let ear = 0;
  if (a(28, 32)) { const i = at(28, 32); if (px[i] > 150 && Math.abs(px[i] - px[i + 1]) < 20 && Math.abs(px[i + 1] - px[i + 2]) < 20) { px[i] = 0; px[i + 1] = 0; px[i + 2] = 0; ear++; } }
  // Left-eye highlight under the ear: bright cream → its dim grey.
  for (let y = 28; y <= 36; y++) for (let x = 29; x <= 33; x++) {
    if (!a(x, y)) continue;
    const i = at(x, y);
    // Bright cream (#f4e9dc, #f3deab …); not the hat's light grey (#b2bab9).
    if (px[i] > 220 && px[i + 1] > 200) { px[i] = 0xa2; px[i + 1] = 0xa3; px[i + 2] = 0xa3; ear++; }
  }
  return { dripped, ear };
};
