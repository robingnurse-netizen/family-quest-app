// The arena's meadow (public/backgrounds/meadow-day.png) is the source art
// with its flat sky cut out once, by scripts/key-meadow-sky.mjs — no
// browser-side keying. Checks it's the current art, pixel for pixel, with
// exactly the sky-coloured pixels transparent (re-run the script after
// editing assets/bg-meadow-day-final.png).
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { MEADOW_PUBLIC, MEADOW_SOURCE, isSky } from "../scripts/key-meadow-sky.mjs";

const sharp = createRequire(import.meta.url)("sharp");
const raw = (file) => sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });

test("the public meadow is the source art with exactly its sky transparent", async () => {
  const [src, pub] = await Promise.all([raw(MEADOW_SOURCE), raw(MEADOW_PUBLIC)]);
  assert.equal(pub.info.width, src.info.width);
  assert.equal(pub.info.height, src.info.height);
  let sky = 0;
  for (let i = 0; i < src.data.length; i += 4) {
    const [r, g, b] = [src.data[i], src.data[i + 1], src.data[i + 2]];
    if (isSky(r, g, b)) {
      assert.equal(pub.data[i + 3], 0, `sky pixel ${i / 4} is transparent`);
      sky++;
    } else {
      assert.deepEqual([...pub.data.subarray(i, i + 4)], [r, g, b, 255], `art pixel ${i / 4} unchanged`);
    }
  }
  assert.ok(sky > 10000, `${sky} sky pixels`);
});
