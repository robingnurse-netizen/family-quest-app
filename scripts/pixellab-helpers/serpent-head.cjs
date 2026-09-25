/* eslint-disable @typescript-eslint/no-require-imports */
// Rough helper: restores the Scatter-Brick Serpent's open mouth and red
// forked tongue (docs/pixellab-style.md, Serpent record). PixelLab's Pixen
// edit (fix-v1) closed the mouth; this copies the original rotation's mouth,
// teeth, lower jaw and tongue back onto the tapered candidate (fix-v2) —
// only where the candidate is empty, plus the closed jaw line (rows 21–23),
// which the open mouth replaces — so the new neck stays. Then the whole
// lower jaw band, chin to hinge (JAW), goes back ON TOP of the neck's top:
// cut off at the neck it floated under the chin; the hinge is where it meets
// the skull. A 1px throat shadow under the band separates it from the tan
// neck, as the original's brown throat did. Writes fix-v3.png.
const sharp = require('sharp');
const path = require('node:path');
const W = path.join(process.env.PIXELLAB_WORK || path.join(__dirname, 'work'), 'scatter_brick_serpent');

(async () => {
  const load = async (f) => (await sharp(`${W}/${f}`).ensureAlpha().raw().toBuffer({ resolveWithObject: true })).data;
  const orig = await load('rotation-sw.png'), out = Buffer.from(await load('fix-v2.png'));
  const N = 76;
  let copied = 0;
  for (let y = 21; y <= 34; y++) for (let x = 10; x <= 38; x++) {
    const i = (y * N + x) * 4;
    if (!orig[i + 3]) continue;
    const jawLine = y <= 23 && x >= 19 && x <= 34;
    if (out[i + 3] && !jawLine) continue;
    orig.copy(out, i, i, i + 4);
    copied++;
  }
  // The jaw band: from the chin (lower left) up to the hinge at the back of
  // the skull.
  const JAW = [[21, 27], [29, 23], [34, 20], [44, 19], [44, 25], [40, 27], [34, 30], [28, 32], [21, 32]];
  const inJaw = (x, y) => {
    let c = false;
    for (let i = 0, j = JAW.length - 1; i < JAW.length; j = i++) {
      const [xi, yi] = JAW[i], [xj, yj] = JAW[j];
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
    }
    return c;
  };
  let jaw = 0, shadow = 0;
  for (let y = 18; y <= 34; y++) for (let x = 18; x <= 46; x++) {
    const i = (y * N + x) * 4;
    if (inJaw(x + 0.5, y + 0.5) && orig[i + 3]) { orig.copy(out, i, i, i + 4); jaw++; }
  }
  // Throat shadow: the neck pixel right under the band's lower edge.
  const THROAT = [70, 44, 22, 255];
  const isInk = (i) => out[i] + out[i + 1] + out[i + 2] < 80;
  for (let x = 24; x <= 44; x++) {
    let y = 34;
    while (y > 18 && !inJaw(x + 0.5, y + 0.5)) y--;
    if (y <= 18) continue;
    const i = ((y + 1) * N + x) * 4;
    if (out[i + 3] && !isInk(i)) { out.set(THROAT, i); shadow++; }
  }
  await sharp(out, { raw: { width: N, height: N, channels: 4 } }).png().toFile(`${W}/fix-v3.png`);
  console.log(`restored ${copied} px of mouth, jaw and tongue; jaw band ${jaw} px; throat shadow ${shadow} px`);
})();
