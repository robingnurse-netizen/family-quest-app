/* eslint-disable @typescript-eslint/no-require-imports */
// Rough helper: the Mud-Track Minotaur's START FRAME (docs/pixellab-style.md,
// Minotaur record). His south-west rotation stands in a wide mud puddle,
// which on the flat battle ground line reads exactly like the drawn ground
// shadows the game removed (and v3 would carry it along in lunges and the
// escape). This erases it: everything from row 64 down except the two hooves
// goes, and the hooves' exposed edges get outline black. Every animation is
// then generated from this frame (custom_start_frame_base64), so it is also
// frame 0 of every row.
//   in:  PIXELLAB_WORK/mud_track_minotaur/rotation-sw.png (the rotation)
//   out: PIXELLAB_WORK/mud_track_minotaur/start.png
const sharp = require('sharp');
const path = require('node:path');
const W = path.join(process.env.PIXELLAB_WORK || path.join(__dirname, 'work'), 'mud_track_minotaur');

(async () => {
  const { data, info } = await sharp(`${W}/rotation-sw.png`).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const w = info.width, h = info.height, px = Buffer.from(data);
  // Far hoof x 24–31 (to row 66), near hoof x 40–48 (to row 69).
  const keep = (x, y) => y < 64 || (x >= 24 && x <= 31 && y <= 66) || (x >= 40 && x <= 48 && y <= 69);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (!keep(x, y)) px[(y * w + x) * 4 + 3] = 0;
  const a = (x, y) => x >= 0 && x < w && y >= 0 && y < h && px[(y * w + x) * 4 + 3];
  const add = [];
  for (let y = 60; y < h; y++) for (let x = 0; x < w; x++) {
    if (a(x, y)) continue;
    if ([[0, -1], [-1, 0], [1, 0]].some(([dx, dy]) => a(x + dx, y + dy) && y + dy >= 62)) add.push([x, y]);
  }
  for (const [x, y] of add) px.set([17, 12, 10, 255], (y * w + x) * 4);
  await sharp(px, { raw: { width: w, height: h, channels: 4 } }).png().toFile(`${W}/start.png`);
  console.log(`start frame written (${add.length} outline px added)`);
})();
