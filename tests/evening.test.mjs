// The evening nudge (lib/rpg/evening.ts): the threshold in the family's
// timezone, and the Night Raid opportunity line.
import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { importTs } from "./helpers/load-ts.mjs";

const evening = await importTs(fileURLToPath(new URL("../lib/rpg/evening.ts", import.meta.url)));

test("the default threshold is 18:00", () => {
  assert.equal(evening.EVENING_WARNING_FROM, "18:00");
});

test("evening starts at the threshold in the family's timezone, not the device's", () => {
  // 17:30 UTC in January: 17:30 in London, 12:30 in New York, 02:30 in Tokyo (next day).
  const t = new Date("2032-01-15T17:30:00Z");
  assert.equal(evening.minutesInZone(t, "Europe/London"), 17 * 60 + 30);
  assert.equal(evening.isEvening(t, "Europe/London"), false);
  assert.equal(evening.isEvening(new Date("2032-01-15T18:00:00Z"), "Europe/London"), true, "exactly 18:00");
  assert.equal(evening.isEvening(new Date("2032-01-15T17:59:00Z"), "Europe/London"), false);
  assert.equal(evening.isEvening(t, "America/New_York"), false);
  assert.equal(evening.isEvening(new Date("2032-01-15T23:00:00Z"), "America/New_York"), true, "18:00 in New York");
  assert.equal(evening.isEvening(new Date("2032-01-15T09:00:00Z"), "Asia/Tokyo"), true, "18:00 in Tokyo");
});

test("daylight saving: 18:00 London in summer is 17:00 UTC", () => {
  assert.equal(evening.isEvening(new Date("2032-07-15T17:00:00Z"), "Europe/London"), true);
  assert.equal(evening.isEvening(new Date("2032-07-15T16:59:00Z"), "Europe/London"), false);
});

test("evening lasts until midnight, then it's morning again", () => {
  assert.equal(evening.isEvening(new Date("2032-01-15T23:59:00Z"), "Europe/London"), true);
  assert.equal(evening.isEvening(new Date("2032-01-16T00:00:00Z"), "Europe/London"), false);
});

test("the threshold is tunable", () => {
  const t = new Date("2032-01-15T16:30:00Z");
  assert.equal(evening.isEvening(t, "Europe/London", "16:00"), true);
  assert.equal(evening.isEvening(t, "Europe/London", "18:00"), false);
});

const stakes = (over = {}) => ({
  today: "2032-01-15",
  timezone: "Europe/London",
  boss_active: true,
  boss_name: "Shogun-Bot",
  boss_hp: 300,
  boss_max_hp: 400,
  my_open_quests: 2,
  raid_damage: 20,
  rescue_open: false,
  ...over,
});

test("the nudge: his quests left and the Night Raid on offer, with the streak it grows", () => {
  assert.equal(
    evening.eveningNudge(true, stakes(), 2, 3),
    "2 quests to go — then Rogue's off on a Night Raid! Your streak grows to 4\u00a0days too!",
  );
  assert.equal(
    evening.eveningNudge(true, stakes(), 1, 0),
    "1 quest to go — then Rogue's off on a Night Raid! Your streak grows to 1\u00a0day too!",
  );
});

test("a streak on hold (open rescue) doesn't grow: no streak clause", () => {
  assert.equal(
    evening.eveningNudge(true, stakes({ rescue_open: true }), 2, 5),
    "2 quests to go — then Rogue's off on a Night Raid!",
  );
});

test("no nudge before evening, without a boss, with nothing left to do, or with nothing to raid", () => {
  assert.equal(evening.eveningNudge(false, stakes(), 2, 0), null);
  assert.equal(evening.eveningNudge(true, null, 2, 0), null);
  assert.equal(evening.eveningNudge(true, stakes({ boss_active: false, raid_damage: 0 }), 2, 0), null);
  assert.equal(evening.eveningNudge(true, stakes(), 0, 0), null);
  assert.equal(evening.eveningNudge(true, stakes(), null, 0), null, "his count not known yet");
  assert.equal(evening.eveningNudge(true, stakes({ boss_hp: 1, raid_damage: 0 }), 2, 0), null, "a boss at 1 HP");
});

test("the quest count is the one passed in (the streak nudge's), not the database's", () => {
  // Stakes still reporting quests (e.g. stale) don't make a line when he has none left today…
  assert.equal(evening.eveningNudge(true, stakes({ my_open_quests: 3 }), 0, 1), null);
  // …and a stale 0 there doesn't hide it when he has.
  assert.equal(
    evening.eveningNudge(true, stakes({ my_open_quests: 0 }), 1, 0),
    "1 quest to go — then Rogue's off on a Night Raid! Your streak grows to 1\u00a0day too!",
  );
});

test("no loss framing in the nudge", () => {
  for (const [s, n, streak] of [[stakes(), 2, 0], [stakes(), 2, 9], [stakes({ rescue_open: true }), 2, 4], [stakes(), 1, 1]]) {
    const line = evening.eveningNudge(true, s, n, streak);
    assert.doesNotMatch(line, /damage|lose|lost|crack|knock|escape|or the|miss/i, line);
  }
});
