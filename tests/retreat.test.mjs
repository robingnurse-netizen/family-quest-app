// Boss retreat wording (lib/rpg/retreat.ts). The HP / bonus numbers are
// checked against the database in tests/boss-engine.test.mjs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { importTs } from "./helpers/load-ts.mjs";

const { nextFoeLine, retreatHpBonusPct, isComeback } = await importTs(
  fileURLToPath(new URL("../lib/rpg/retreat.ts", import.meta.url)),
);

test("the next-foe teaser: a returning boss gets the callback, a first-time boss the generic line", () => {
  const fresh = { name: "Laundry Goblin", retreats: 0 };
  const back = { name: "Trash-Bag Slime", retreats: 1 };
  assert.equal(nextFoeLine(fresh), "A new foe approaches…");
  assert.equal(nextFoeLine(fresh, true), "A new foe approaches: Laundry Goblin!");
  assert.equal(nextFoeLine(back), "Look who's baaack!");
  assert.equal(nextFoeLine(back, true), "Look who's baaack! Trash-Bag Slime returns!");
  assert.equal(nextFoeLine({ name: "Old row" }), "A new foe approaches…", "a row without retreats is first-time");
});

test("HP bonus % and comeback flag", () => {
  assert.deepEqual([0, 1, 2, 3, 4].map(retreatHpBonusPct), [0, 10, 20, 30, 30]);
  assert.equal(isComeback({ retreats: 0 }), false);
  assert.equal(isComeback({ retreats: 2 }), true);
});
