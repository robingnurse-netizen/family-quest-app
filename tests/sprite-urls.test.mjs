// Sprite frame URLs carry a content hash (?v=…, scripts/sprite-manifests.mjs),
// so /sprites can be cached as immutable (next.config.ts): a browser loads
// each frame once, and new art gets a new URL. A stale hash would serve old
// art from caches, so check every one against the file on disk.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const dir = fileURLToPath(new URL("../components/rpg/sprites/manifests/", import.meta.url));

test("every frame URL is versioned with the current content hash of its file", () => {
  let count = 0;
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".json"))) {
    const { animations } = JSON.parse(readFileSync(`${dir}${file}`, "utf8"));
    for (const [name, anim] of Object.entries(animations)) {
      for (const url of anim.frames) {
        const match = url.match(/^(\/sprites\/[^?]+\.png)\?v=([0-9a-f]{10})$/);
        assert.ok(match, `${file} ${name}: ${url} is versioned`);
        const bytes = readFileSync(fileURLToPath(new URL(`../public${match[1]}`, import.meta.url)));
        assert.equal(createHash("sha256").update(bytes).digest("hex").slice(0, 10), match[2], `${url} is current`);
        assert.ok(anim.shadow[url], `${file} ${name}: shadow keyed by the versioned URL`);
        count++;
      }
    }
  }
  assert.ok(count > 200, `${count} frames checked`);
});

test("/sprites is served with a long-lived immutable cache", () => {
  const config = readFileSync(fileURLToPath(new URL("../next.config.ts", import.meta.url)), "utf8");
  assert.match(config, /source:\s*"\/sprites\/:path\*"/);
  assert.match(config, /public, max-age=31536000, immutable/);
});
