/* eslint-disable @typescript-eslint/no-require-imports */
// Preview GIF of a character's sliced animations, from its manifest and
// public/sprites frames (what the game plays): every animation drawn on one
// shared ground line (the red line) at its manifest fps, in the order idle ×2,
// attack, idle, hurt, idle, move ×2, death (its last frame held 1.5s). Facing
// as drawn (bosses face left). Output is git-ignored.
//
//   node scripts/pixellab-helpers/preview-gif.cjs <key> [scale=3]
//   → scripts/pixellab-helpers/previews/<key>.gif
const sharp = require('sharp');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const [key, sc = '3'] = process.argv.slice(2);
const S = +sc;
const m = JSON.parse(fs.readFileSync(path.join(ROOT, 'components/rpg/sprites/manifests', `${key}.json`), 'utf8'));
const A = m.animations;
const death = A.death ? 'death' : 'defeated';
const order = ['idle', 'idle', 'attack', 'idle', 'hurt', 'idle', 'move', 'move', death].filter((n) => A[n]);

(async () => {
  // Common canvas: every animation's anchor at one point.
  let left = 0, right = 0, up = 0, down = 0;
  for (const n of new Set(order)) {
    const a = A[n];
    left = Math.max(left, a.anchor.x); right = Math.max(right, a.width - a.anchor.x);
    up = Math.max(up, a.anchor.y); down = Math.max(down, a.height - a.anchor.y);
  }
  const pad = 6, W = (left + right + 2 * pad) * S, H = (up + down + 2 * pad) * S;
  const ox = left + pad, oy = up + pad;
  const pages = [], delays = [];
  for (const n of order) {
    const a = A[n];
    a.frames.forEach((url, i) => {
      pages.push({ file: path.join(ROOT, 'public', url.split('?')[0]), a });
      delays.push(Math.round(1000 / a.fps) + (n === death && i === a.frames.length - 1 ? 1500 : 0));
    });
  }
  const bufs = [];
  for (const { file, a } of pages) {
    const img = await sharp(file).resize(a.width * S, a.height * S, { kernel: 'nearest' }).png().toBuffer();
    bufs.push(await sharp({ create: { width: W, height: H, channels: 4, background: '#9fc7d6' } })
      .composite([
        { input: { create: { width: W, height: S, channels: 4, background: '#d0453a' } }, left: 0, top: (oy + 1) * S },
        { input: img, left: (ox - a.anchor.x) * S, top: (oy - a.anchor.y) * S },
      ]).raw().toBuffer());
  }
  const out = path.join(__dirname, 'previews', `${key}.gif`);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  await sharp(Buffer.concat(bufs), { raw: { width: W, height: H * bufs.length, channels: 4, pageHeight: H } })
    .gif({ delay: delays, loop: 0, effort: 7 }).toFile(out);
  console.log(`${out} (${order.join(', ')}; ${bufs.length} frames)`);
})();
