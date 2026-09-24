// lib/random.ts: the no-immediate-repeat random pick used for the attack
// sounds and the hero's attack variants.
import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { importTs } from "./helpers/load-ts.mjs";

const { createNoRepeatPicker, uuidV4 } = await importTs(fileURLToPath(new URL("../lib/random.ts", import.meta.url)));

test("the picker never picks the same index twice in a row, and uses the whole pool", () => {
  const pick = createNoRepeatPicker(8);
  const seen = new Set();
  let last = -1;
  for (let i = 0; i < 2000; i++) {
    const n = pick();
    assert.ok(Number.isInteger(n) && n >= 0 && n < 8, `in range: ${n}`);
    assert.notEqual(n, last, `repeat at draw ${i}`);
    seen.add(n);
    last = n;
  }
  assert.equal(seen.size, 8, "every index gets picked");
});

test("even a stuck random source can't repeat or overflow", () => {
  for (const r of [0, 0.5, 0.999999, 1]) {
    const pick = createNoRepeatPicker(8, () => r);
    const draws = Array.from({ length: 6 }, pick);
    draws.forEach((n, i) => {
      assert.ok(n >= 0 && n < 8, `r=${r}: ${n} in range`);
      if (i > 0) assert.notEqual(n, draws[i - 1], `r=${r}: no repeat`);
    });
  }
});

test("a single-file sound always picks index 0", () => {
  const pick = createNoRepeatPicker(1);
  assert.deepEqual([pick(), pick(), pick()], [0, 0, 0]);
});

test("uuidV4 makes distinct, well-formed v4 UUIDs (no secure context needed)", () => {
  const seen = new Set();
  for (let i = 0; i < 500; i++) {
    const id = uuidV4();
    assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    seen.add(id);
  }
  assert.equal(seen.size, 500);
});
