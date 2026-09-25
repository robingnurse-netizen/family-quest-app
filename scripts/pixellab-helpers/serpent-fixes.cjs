// Hand fix for the Scatter-Brick Serpent (build-boss-sheet.cjs `fix` hook;
// docs/pixellab-style.md, Serpent record). The hand-drawn death end frame
// left a wedge of the coil's cream belly stripe poking out below the jaw at
// ground level, and v3 carried it into death frames 6–8, where it read as a
// floating shard. It sits under the jaw's outline in the death's v3 canvas:
// columns 27–38 from row 82 down in frames 7–8; in frame 6 (the head still
// dropping) it starts higher, where the neck's belly runs down into it, so
// the box there is columns 27–41 from row 75. The box is cleared and the
// cut edges (the row above, the column to its right) closed with outline.
const INK = [12, 10, 16, 255];
const BOX = { 6: [27, 41, 75], 7: [27, 38, 82], 8: [27, 38, 82] };

module.exports = function serpentFix(px, w, h, row, frame) {
  const box = row === 'death' && BOX[frame];
  if (!box) return { wedge: 0 };
  const [X0, X1, Y0] = box;
  const light = (i) => px[i + 3] && px[i] + px[i + 1] + px[i + 2] >= 90;
  let cleared = 0;
  for (let y = Y0; y < h; y++) for (let x = X0; x <= X1; x++) {
    const i = (y * w + x) * 4;
    if (px[i + 3]) { px[i + 3] = 0; cleared++; }
  }
  for (let x = X0; x <= X1; x++) { const i = ((Y0 - 1) * w + x) * 4; if (light(i)) px.set(INK, i); }
  for (let y = Y0; y < h; y++) { const i = (y * w + X1 + 1) * 4; if (light(i)) px.set(INK, i); }
  return { wedge: cleared };
};
