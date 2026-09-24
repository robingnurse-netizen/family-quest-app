// The sprite frame cache (components/rpg/sprites/frame-cache.ts): one
// download per frame per page, and failed frames retried with backoff —
// against a fake Image whose loads succeed or fail on command.
import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { importTs } from "./helpers/load-ts.mjs";

// --- A fake browser Image --------------------------------------------------------

const created = []; // every Image constructed, in order
const failing = new Set(); // URLs that fail to load right now
class FakeImage {
  constructor() {
    created.push(this);
  }
  set src(url) {
    this._src = url;
    // Loads settle asynchronously, like the real thing.
    setTimeout(() => (failing.has(url) ? this.onerror?.() : this.onload?.()), 0);
  }
  get src() {
    return this._src;
  }
  decode() {
    return Promise.resolve();
  }
}
globalThis.Image = FakeImage;

const cache = await importTs(fileURLToPath(new URL("../components/rpg/sprites/frame-cache.ts", import.meta.url)));
const fetches = (url) => created.filter((img) => img.src === url).length;

let now = 1_000_000;
const realNow = Date.now;
Date.now = () => now;
process.on("exit", () => (Date.now = realNow));

test("each frame is downloaded once, however often it's asked for", async () => {
  const url = "/sprites/hero/idle/frame-01.png?v=a";
  assert.equal(cache.frameReady(url), false);
  const results = await Promise.all([cache.loadFrame(url), cache.loadFrame(url), cache.loadFrame(url)]);
  assert.deepEqual(results, [true, true, true]);
  cache.preloadFrames([url, url]);
  assert.equal(await cache.loadFrame(url), true);
  assert.equal(cache.frameReady(url), true);
  assert.equal(fetches(url), 1, "one Image, one request");
});

test("a failed frame isn't ready, and is retried only after its backoff", async () => {
  const url = "/sprites/rogue/idle/frame-06.png?v=b";
  failing.add(url);
  assert.equal(await cache.loadFrame(url), false);
  assert.equal(cache.frameReady(url), false, "never shown (the last good frame stays up)");

  // Asked again straight away (every animation tick asks): no new request.
  assert.equal(await cache.loadFrame(url), false);
  assert.equal(fetches(url), 1);

  // The connection's back and the backoff (1s after one failure) is up.
  failing.delete(url);
  now += cache.retryDelayMs(1);
  assert.equal(await cache.loadFrame(url), true);
  assert.equal(cache.frameReady(url), true);
  assert.equal(fetches(url), 2);
  // From then on it's cached for good.
  await cache.loadFrame(url);
  assert.equal(fetches(url), 2);
});

test("backoff doubles from 1s and caps at 30s", () => {
  assert.deepEqual([1, 2, 3, 4, 5, 6, 7, 10].map(cache.retryDelayMs), [1000, 2000, 4000, 8000, 16000, 30000, 30000, 30000]);
});

test("repeated failures back off further each time", async () => {
  const url = "/sprites/hero/idle/frame-08.png?v=c";
  failing.add(url);
  await cache.loadFrame(url); // failure 1
  now += 1000;
  await cache.loadFrame(url); // failure 2 → wait 2s
  now += 1500;
  await cache.loadFrame(url);
  assert.equal(fetches(url), 2, "still inside the 2s backoff");
  now += 600;
  await cache.loadFrame(url);
  assert.equal(fetches(url), 3);
});
