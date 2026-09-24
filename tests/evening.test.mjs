// The evening warning (lib/rpg/evening.ts): the threshold in the family's
// timezone, and the stakes line.
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
  my_open_quests: 2,
  open_quests: 2,
  open_minutes: 45,
  damage: 45,
  party_hp: 100,
  ...over,
});

test("the stakes line: the boss, his quests left and the reset's real damage", () => {
  assert.equal(
    evening.eveningWarning(true, stakes(), 0),
    "Shogun-Bot is powering up! 2 quests left before midnight, or the party takes 45 damage.",
  );
  assert.equal(
    evening.eveningWarning(true, stakes({ my_open_quests: 1, damage: 30 }), 0),
    "Shogun-Bot is powering up! 1 quest left before midnight, or the party takes 30 damage.",
  );
});

test("the line folds in a streak at stake and a knock-out", () => {
  assert.equal(
    evening.eveningWarning(true, stakes({ party_hp: 40 }), 3),
    "Shogun-Bot is powering up! 2 quests left before midnight, or the party takes 45 damage and gets knocked out — and your 3\u2011day streak ends.",
  );
});

test("no warning before evening, without a boss, or with nothing left to do", () => {
  assert.equal(evening.eveningWarning(false, stakes(), 0), null);
  assert.equal(evening.eveningWarning(true, null, 0), null);
  assert.equal(evening.eveningWarning(true, stakes({ boss_active: false, damage: 0 }), 0), null);
  assert.equal(evening.eveningWarning(true, stakes({ my_open_quests: 0 }), 0), null);
});
