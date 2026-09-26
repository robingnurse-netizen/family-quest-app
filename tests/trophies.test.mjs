// The Trophy Case (lib/rpg/trophies.ts): roster order, what's revealed per
// state, defeat dates and damage from boss_log.
import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { importTs } from "./helpers/load-ts.mjs";

const { buildTrophyCase } = await importTs(fileURLToPath(new URL("../lib/rpg/trophies.ts", import.meta.url)));

const boss = (id, tier, queue, status, name = id) => ({
  id, name, tier, sprite_key: `${id}_key`, status, queue_position: queue, created_at: "2026-09-22T00:00:00Z",
});

test("orders low → mid → epic, queue order within a tier", () => {
  const out = buildTrophyCase(
    [boss("e1", "epic", 1, "inactive"), boss("m2", "mid", 2, "inactive"), boss("l2", "low", 2, "active"), boss("m1", "mid", 1, "inactive"), boss("l1", "low", 1, "defeated")],
    [],
  );
  assert.deepEqual(out.map((t) => t.id), ["l1", "l2", "m1", "m2", "e1"]);
});

test("states: defeated / fighting / locked (a legacy escaped boss is locked); only a defeat reveals the name", () => {
  const out = buildTrophyCase(
    [boss("a", "low", 1, "defeated", "Slime"), boss("b", "low", 2, "escaped", "Swarm"), boss("c", "low", 3, "active", "Goblin"), boss("d", "low", 4, "inactive", "Spider")],
    [],
  );
  assert.deepEqual(out.map((t) => [t.state, t.name]), [
    ["defeated", "Slime"], ["locked", null], ["fighting", null], ["locked", null],
  ]);
});

test("a defeated boss: the defeat date and the family's total damage (every damage and Night Raid row)", () => {
  const [t] = buildTrophyCase(
    [boss("a", "low", 1, "defeated")],
    [
      { boss_id: "a", event_type: "activated", amount: 0, created_at: "2026-09-20T08:00:00Z" },
      { boss_id: "a", event_type: "damage", amount: 30, created_at: "2026-09-20T09:00:00Z" },
      { boss_id: "a", event_type: "damage", amount: 15, created_at: "2026-09-21T09:00:00Z" },
      { boss_id: "a", event_type: "damage", amount: 15, created_at: "2026-09-21T10:00:00Z" },
      { boss_id: "a", event_type: "night_raid", amount: 3, created_at: "2026-09-21T00:05:00Z" },
      { boss_id: "a", event_type: "defeated", amount: 25, created_at: "2026-09-21T10:00:01Z" }, // amount = gold
      { boss_id: "a", event_type: "gold_awarded", amount: 25, created_at: "2026-09-21T10:00:01Z" },
      { boss_id: "other", event_type: "damage", amount: 99, created_at: "2026-09-21T10:00:00Z" },
    ],
  );
  assert.equal(t.defeatedAt, "2026-09-21T10:00:01Z");
  assert.equal(t.damage, 63); // hits + the raid; not the gold on the defeated row, not other bosses' hits
});

test("undefeated bosses reveal no date or damage (even with hits logged)", () => {
  const out = buildTrophyCase(
    [boss("c", "low", 1, "active"), boss("b", "low", 2, "escaped")],
    [
      { boss_id: "c", event_type: "damage", amount: 20, created_at: "2026-09-21T09:00:00Z" },
      { boss_id: "b", event_type: "damage", amount: 40, created_at: "2026-09-20T09:00:00Z" },
      { boss_id: "b", event_type: "escaped", amount: 50, created_at: "2026-09-21T00:05:00Z" },
    ],
  );
  assert.deepEqual(out.map((t) => [t.defeatedAt, t.damage]), [[null, null], [null, null]]);
});

test("statues: STATUE_EMPTY_ROWS_BELOW matches every roster boss's statue frame (front, else idle frame 0)", async () => {
  const { readFileSync } = await import("node:fs");
  const { createRequire } = await import("node:module");
  const sharp = createRequire(import.meta.url)("sharp");
  const { STATUE_EMPTY_ROWS_BELOW } = await importTs(fileURLToPath(new URL("../lib/rpg/trophies.ts", import.meta.url)));
  const roster = [
    "trash_bag_slime", "alarm_clock_swarm", "laundry_goblin", "cable_spider",
    "swamp_bag_ooze", "tupperware_troll", "scatter_brick_serpent", "mud_track_minotaur",
    "magma_behemoth", "chronosphinx", "abyssal_kraken", "shogun_bot",
  ];
  for (const key of roster) {
    const manifest = JSON.parse(readFileSync(fileURLToPath(new URL(`../components/rpg/sprites/manifests/${key}.json`, import.meta.url)), "utf8"));
    const frame = (manifest.animations.front ?? manifest.animations.idle).frames[0].split("?")[0];
    const { data, info } = await sharp(fileURLToPath(new URL(`../public${frame}`, import.meta.url))).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    let low = -1;
    for (let y = info.height - 1; y >= 0 && low < 0; y--) {
      for (let x = 0; x < info.width; x++) if (data[(y * info.width + x) * 4 + 3]) { low = y; break; }
    }
    assert.equal(STATUE_EMPTY_ROWS_BELOW[key] ?? 0, info.height - 1 - low, key);
  }
});
