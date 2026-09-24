// The recap's story (lib/rpg/recap.ts): several nights combined into one
// recap, one damage number, and its kid-friendly lines.
import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { importTs } from "./helpers/load-ts.mjs";

const { summarizeRecaps } = await importTs(fileURLToPath(new URL("../lib/rpg/recap.ts", import.meta.url)));

const YESTERDAY = "2032-03-09";
const bosses = {
  slime: { id: "slime", name: "Trash-Bag Slime", sprite_key: "trash_bag_slime", tier: "low" },
  swarm: { id: "swarm", name: "Alarm Clock Swarm", sprite_key: "alarm_clock_swarm", tier: "low" },
};
let clock = 0;
const row = (over = {}) => ({
  created_at: `2032-03-10T00:05:${String(clock++).padStart(2, "0")}Z`,
  day_from: YESTERDAY,
  day_to: YESTERDAY,
  missed_quests: 0,
  missed_minutes: 0,
  party_damage: 0,
  boss_id: "slime",
  perfect_days: 0,
  healed: 0,
  streak_before: 0,
  streak_after: 0,
  knocked_out: false,
  escaped_boss_id: null,
  next_boss_id: null,
  hp_before: 100,
  hp_after: 100,
  max_hp: 100,
  ...over,
});

test("nothing unseen: no recap", () => {
  assert.equal(summarizeRecaps([], bosses, YESTERDAY), null);
});

test("one night of misses: 'Yesterday', one damage number, the blow", () => {
  const s = summarizeRecaps(
    [row({ missed_quests: 2, missed_minutes: 45, party_damage: 45, hp_after: 55 })],
    bosses,
    YESTERDAY,
  );
  assert.equal(s.kind, "blow");
  assert.equal(s.damage, 45);
  assert.equal(s.attacker.name, "Trash-Bag Slime");
  assert.deepEqual(s.lines, ["Yesterday: 2 quests missed (45 min). The party took 45 damage."]);
  assert.equal(s.closing, "New day — let's get him back!");
});

test("several nights combine into one recap with one combined damage number", () => {
  const rows = [
    row({ day_from: "2032-03-07", day_to: "2032-03-07", missed_quests: 1, missed_minutes: 15, party_damage: 15, hp_before: 100, hp_after: 85 }),
    row({ day_from: "2032-03-08", day_to: "2032-03-08", missed_quests: 2, missed_minutes: 30, party_damage: 30, hp_before: 85, hp_after: 55 }),
    row({ perfect_days: 1, healed: 10, hp_before: 55, hp_after: 65 }),
  ];
  const s = summarizeRecaps([rows[2], rows[0], rows[1]], bosses, YESTERDAY); // any order
  assert.equal(s.nights, 3);
  assert.equal(s.when, "Since you were last here");
  assert.equal(s.damage, 45);
  assert.deepEqual([s.hpBefore, s.hpAfter], [100, 65]);
  assert.equal(s.through, rows[2].created_at, "acknowledge up to the newest");
  assert.deepEqual(s.lines, [
    "Since you were last here: 3 quests missed (45 min). The party took 45 damage.",
    "Perfect day! Party healed 10 HP.",
  ]);
});

test("a single night covering several days (catch-up) isn't 'Yesterday'", () => {
  const s = summarizeRecaps([row({ day_from: "2032-03-06", missed_quests: 1, missed_minutes: 10, party_damage: 10 })], bosses, YESTERDAY);
  assert.equal(s.when, "Since you were last here");
});

test("streak lost is mentioned when the misses broke a streak above 0", () => {
  const lost = summarizeRecaps([row({ missed_quests: 1, missed_minutes: 20, party_damage: 20, streak_before: 3, streak_after: 0 })], bosses, YESTERDAY);
  assert.ok(lost.streakLost);
  assert.ok(lost.lines.includes("Streak lost."));
  const none = summarizeRecaps([row({ missed_quests: 1, missed_minutes: 20, party_damage: 20 })], bosses, YESTERDAY);
  assert.equal(none.streakLost, false, "no streak to lose");
});

test("knocked out: the escape and the next boss, in order", () => {
  const s = summarizeRecaps(
    [row({ missed_quests: 3, missed_minutes: 60, party_damage: 60, knocked_out: true, escaped_boss_id: "slime", next_boss_id: "swarm", hp_before: 40 })],
    bosses,
    YESTERDAY,
  );
  assert.equal(s.knockedOut, true);
  assert.equal(s.escaped.name, "Trash-Bag Slime");
  assert.equal(s.next.name, "Alarm Clock Swarm");
  assert.deepEqual(s.lines.slice(1), [
    "The party was knocked out — Trash-Bag Slime got away!",
    "A new foe appears: Alarm Clock Swarm!",
  ]);
  assert.equal(s.closing, "New day — new foe. Let's go!");
});

test("misses with no boss: text only, no damage line", () => {
  const s = summarizeRecaps([row({ missed_quests: 1, missed_minutes: 20, boss_id: null })], bosses, YESTERDAY);
  assert.equal(s.kind, "text");
  assert.equal(s.attacker, null);
  assert.deepEqual(s.lines, ["Yesterday: 1 quest missed (20 min)."]);
  assert.equal(s.closing, "New day — let's go!");
});

test("a perfect day with no misses: a brief, positive recap", () => {
  const s = summarizeRecaps([row({ perfect_days: 1, healed: 10, hp_before: 80, hp_after: 90 })], bosses, YESTERDAY);
  assert.equal(s.kind, "perfect");
  assert.deepEqual(s.lines, ["Perfect day! Party healed 10 HP."]);
  assert.equal(s.closing, "Keep it up!");
  const full = summarizeRecaps([row({ perfect_days: 2 })], bosses, YESTERDAY);
  assert.deepEqual(full.lines, ["2 perfect days!"], "nothing to heal at full HP");
});

test("a brother's or sister's misses still show the party's damage", () => {
  const s = summarizeRecaps([row({ party_damage: 25, hp_after: 75 })], bosses, YESTERDAY);
  assert.equal(s.kind, "blow");
  assert.deepEqual(s.lines, ["Yesterday: the party took 25 damage."]);
});

// --- Staging --------------------------------------------------------------------------

const { recapSchedule, recapFinalState, RECAP_TIMING } = await importTs(fileURLToPath(new URL("../lib/rpg/recap.ts", import.meta.url)));
const kinds = (beats) => beats.map((b) => b.kind);
const at = (beats, kind) => beats.find((b) => b.kind === kind)?.at;

test("a blow: attack, then the blow on the boss's impact, one of each", () => {
  const s = summarizeRecaps([row({ missed_quests: 2, missed_minutes: 45, party_damage: 45 })], bosses, YESTERDAY);
  const beats = recapSchedule(s);
  assert.equal(kinds(beats).filter((k) => k === "blow").length, 1, "one combined blow");
  assert.equal(at(beats, "blow") - at(beats, "attack"), RECAP_TIMING.impact);
  assert.ok(!kinds(beats).includes("ko"));
  assert.equal(kinds(beats).at(-1), "closing", "the animation ends on the complete summary card");
});

test("knocked out: fall, the boss leaves, the next arrives, then he stands as the party refills", () => {
  const s = summarizeRecaps(
    [row({ missed_quests: 3, missed_minutes: 60, party_damage: 60, knocked_out: true, escaped_boss_id: "slime", next_boss_id: "swarm", hp_before: 40 })],
    bosses,
    YESTERDAY,
  );
  const beats = recapSchedule(s);
  const order = ["blow", "ko", "escape", "enter", "refill", "rise", "stand", "closing"];
  const times = order.map((k) => at(beats, k));
  assert.deepEqual(times, [...times].sort((a, b) => a - b), `in order: ${order.join(" → ")}`);
  assert.equal(at(beats, "refill"), at(beats, "rise"), "he gets up as the party refills");
  // The text keeps pace with the picture.
  const lineTimes = beats.filter((b) => b.kind === "line").map((b) => b.at);
  assert.ok(lineTimes[1] >= at(beats, "escape"), "'got away' once the boss is leaving");
  assert.ok(lineTimes[2] >= at(beats, "enter"), "'a new foe' once it arrives");
});

test("no boss: no blow, just the lines", () => {
  const s = summarizeRecaps([row({ missed_quests: 1, missed_minutes: 20, boss_id: null })], bosses, YESTERDAY);
  const beats = recapSchedule(s);
  for (const k of ["attack", "blow", "ko", "escape"]) assert.ok(!kinds(beats).includes(k), k);
  assert.deepEqual(kinds(beats), ["line", "closing"]);
});

test("a perfect day: a heal and a short recap", () => {
  const s = summarizeRecaps([row({ perfect_days: 1, healed: 10, hp_before: 80, hp_after: 90 })], bosses, YESTERDAY);
  const beats = recapSchedule(s);
  assert.deepEqual(kinds(beats), ["heal", "line", "closing"]);
  assert.equal(at(beats, "line"), at(beats, "heal"), "the heal line appears with the heal");
  assert.ok(at(beats, "closing") <= 2000, "brief");
});

test("the animated part is a few seconds long", () => {
  const long = summarizeRecaps(
    [row({ missed_quests: 3, missed_minutes: 60, party_damage: 60, knocked_out: true, escaped_boss_id: "slime", next_boss_id: "swarm", streak_before: 4, perfect_days: 1 })],
    bosses,
    YESTERDAY,
  );
  assert.ok(at(recapSchedule(long), "closing") <= 8000, `${at(recapSchedule(long), "closing")}ms`);
});

test("nothing in the timeline closes the recap: only Continue does", () => {
  const s = summarizeRecaps([row({ missed_quests: 1, missed_minutes: 20, party_damage: 20 })], bosses, YESTERDAY);
  const beats = recapSchedule(s);
  assert.ok(!kinds(beats).includes("end"));
  assert.ok(!("read" in RECAP_TIMING), "no reading timer");
});

test("skipping lands on the summary card: final HP, every line, the right boss", () => {
  const ko = summarizeRecaps(
    [row({ missed_quests: 3, missed_minutes: 60, party_damage: 60, knocked_out: true, escaped_boss_id: "slime", next_boss_id: "swarm", hp_before: 40 })],
    bosses,
    YESTERDAY,
  );
  assert.deepEqual(recapFinalState(ko), { hp: 100, lines: ko.lines.length, boss: bosses.swarm });

  const blow = summarizeRecaps([row({ missed_quests: 2, missed_minutes: 45, party_damage: 45, hp_after: 55, streak_before: 2 })], bosses, YESTERDAY);
  assert.deepEqual(recapFinalState(blow), { hp: 55, lines: 2, boss: bosses.slime });

  const lastBoss = summarizeRecaps(
    [row({ missed_quests: 1, missed_minutes: 60, party_damage: 60, knocked_out: true, escaped_boss_id: "slime", next_boss_id: null, hp_before: 30 })],
    bosses,
    YESTERDAY,
  );
  assert.equal(recapFinalState(lastBoss).boss, null, "escaped with no one to follow");

  const text = summarizeRecaps([row({ missed_quests: 1, missed_minutes: 20, boss_id: null })], bosses, YESTERDAY);
  assert.equal(recapFinalState(text).boss, null);
});
