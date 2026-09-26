// The recap's story (lib/rpg/recap.ts): several nights combined into one
// recap — Rogue's Night Raid as the good-news beat, streak events framed
// around what can be won back, nothing for misses alone — and its timeline.
import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { importTs } from "./helpers/load-ts.mjs";

const { summarizeRecaps, recapSchedule, recapFinalState, rescueLine, RECAP_TIMING } = await importTs(
  fileURLToPath(new URL("../lib/rpg/recap.ts", import.meta.url)),
);

const YESTERDAY = "2032-03-09";
const bosses = {
  slime: { id: "slime", name: "Trash-Bag Slime", sprite_key: "trash_bag_slime", tier: "low", status: "active", current_hp: 40 },
  swarm: { id: "swarm", name: "Alarm Clock Swarm", sprite_key: "alarm_clock_swarm", tier: "low", status: "active", current_hp: 40 },
  // Left at 1 HP (nothing to raid), still active.
  worn: { id: "worn", name: "Laundry Goblin", sprite_key: "laundry_goblin", tier: "low", status: "active", current_hp: 1 },
  // Was at 1 HP after the reset, finished off before the recap loaded.
  beaten: { id: "beaten", name: "Cable Spider", sprite_key: "cable_spider", tier: "low", status: "defeated", current_hp: 0 },
};
let clock = 0;
const row = (over = {}) => ({
  created_at: `2032-03-10T00:05:${String(clock++).padStart(2, "0")}Z`,
  day_from: YESTERDAY,
  day_to: YESTERDAY,
  boss_id: "slime",
  perfect_days: 0,
  streak_before: 0,
  streak_after: 0,
  rescue_events: [],
  raid_damage: 0,
  raids: 0,
  ...over,
});
const ev = (event, over = {}) => ({
  event, rescue_id: "r1", missed_day: "2032-03-06", due_on: "2032-03-10", // a Wednesday
  streak_at_crack: 6, streak_after: 6, fallback: false, ...over,
});
const kinds = (beats) => beats.map((b) => b.kind);
const at = (beats, kind) => beats.find((b) => b.kind === kind)?.at;

// --- The story ----------------------------------------------------------------------------

test("nothing unseen: no recap", () => {
  assert.equal(summarizeRecaps([], bosses, YESTERDAY), null);
});

test("one raid night: 'Last night', the raid on its boss, one damage number", () => {
  const s = summarizeRecaps([row({ perfect_days: 1, raids: 1, raid_damage: 3 })], bosses, YESTERDAY);
  assert.equal(s.kind, "raid");
  assert.equal(s.when, "Last night");
  assert.equal(s.raidDamage, 3);
  assert.equal(s.raidBoss.name, "Trash-Bag Slime");
  assert.deepEqual(s.lines, ["Last night, Rogue snuck out on a Night Raid — Trash-Bag Slime took 3 damage!"]);
  assert.deepEqual(s.cues, ["raid"]);
  assert.equal(s.closing, "Another perfect day, another raid!");
});

test("several nights combine: raids and damage add up, the latest raid's boss", () => {
  const s = summarizeRecaps(
    [
      row({ day_from: "2032-03-08", day_to: "2032-03-08", perfect_days: 1, raids: 1, raid_damage: 3 }),
      row({ perfect_days: 1, raids: 1, raid_damage: 4, boss_id: "swarm" }),
    ],
    bosses,
    YESTERDAY,
  );
  assert.equal(s.when, "While you were away");
  assert.deepEqual([s.raids, s.raidDamage, s.raidBoss.name], [2, 7, "Alarm Clock Swarm"]);
  assert.equal(s.lines[0], "While you were away, Rogue snuck out on 2 Night Raids — Alarm Clock Swarm took 7 damage!");
});

test("a single night covering several days (catch-up) isn't 'Last night'", () => {
  const s = summarizeRecaps([row({ day_from: "2032-03-07", raids: 1, raid_damage: 3, perfect_days: 1 })], bosses, YESTERDAY);
  assert.equal(s.when, "While you were away");
});

test("misses alone: a quiet recap — nothing shown (acknowledged silently)", () => {
  const s = summarizeRecaps([row({}), row({ boss_id: null })], bosses, YESTERDAY);
  assert.equal(s.kind, "quiet");
  assert.deepEqual(s.lines, []);
  assert.ok(s.through, "still acknowledged up to the newest row");
});

test("a perfect day with no boss: a short text recap, the plain closing line", () => {
  const s = summarizeRecaps([row({ perfect_days: 1, boss_id: null })], bosses, YESTERDAY);
  assert.equal(s.kind, "text");
  assert.equal(s.boss, null);
  assert.deepEqual(s.lines, ["Perfect day!"]);
  assert.equal(s.closing, "New day — let's go!");
});

test("a perfect day, no raid, the boss at 1 HP: it's one hit from K.O.", () => {
  const s = summarizeRecaps([row({ perfect_days: 1, boss_id: "worn" })], bosses, YESTERDAY);
  assert.equal(s.kind, "text");
  assert.deepEqual(s.lines, ["Perfect day!"]);
  assert.equal(s.closing, "Full clear yesterday — Laundry Goblin is one hit from K.O.!");
});

test("the one-hit line needs a perfect day last night and the boss still active at 1 HP", () => {
  const closing = (rows) => summarizeRecaps(rows, bosses, YESTERDAY).closing;
  const plain = "New day — let's go!";
  // No boss at all.
  assert.equal(closing([row({ perfect_days: 1, boss_id: null })]), plain);
  // A boss the recap can't name (not loaded).
  assert.equal(closing([row({ perfect_days: 1, boss_id: "unknown" })]), plain);
  // Not at 1 HP (the raid just didn't apply, e.g. a frozen-streak edge).
  assert.equal(closing([row({ perfect_days: 1, boss_id: "slime" })]), plain);
  // Finished off since the reset.
  assert.equal(closing([row({ perfect_days: 1, boss_id: "beaten" })]), plain);
  // Streak news only, no perfect day.
  assert.equal(closing([row({ boss_id: "worn", rescue_events: [ev("rescued")] })]), plain);
  // Not "yesterday": several nights, or one night covering several days.
  assert.equal(
    closing([row({ day_from: "2032-03-08", day_to: "2032-03-08", boss_id: "worn" }), row({ perfect_days: 1, boss_id: "worn" })]),
    plain,
  );
  assert.equal(closing([row({ day_from: "2032-03-07", perfect_days: 1, boss_id: "worn" })]), plain);
  // A raid wins.
  assert.equal(closing([row({ perfect_days: 1, raids: 1, raid_damage: 3, boss_id: "worn" })]), "Another perfect day, another raid!");
});

// --- Streak recovery lines (PLACEHOLDER COPY) --------------------------------------------------

test("a streak on hold says how to win it back, and by when", () => {
  const s = summarizeRecaps(
    [row({ streak_before: 6, streak_after: 6, rescue_events: [ev("cracked", { offered_count: 5 })] })],
    bosses,
    YESTERDAY,
  );
  assert.equal(s.kind, "text");
  assert.deepEqual(s.lines, ["Your 6‑day streak has a crack. Do a rescue quest by the end of Wednesday to patch it up."]);
  assert.equal(
    rescueLine(ev("cracked", { fallback: true, due_on: "2032-03-09" })),
    "Your 6‑day streak has a crack. Finish any quest by the end of Tuesday to patch it up.",
  );
});

test("won back and halved lines, in night order, after the raid", () => {
  const s = summarizeRecaps(
    [
      row({ created_at: "2032-03-08T00:05:00Z", rescue_events: [ev("rescued")] }),
      row({ created_at: "2032-03-12T00:05:00Z", perfect_days: 1, raids: 1, raid_damage: 3, rescue_events: [ev("halved", { streak_at_crack: 7, streak_after: 4 })] }),
    ],
    bosses,
    YESTERDAY,
  );
  assert.deepEqual(s.lines, [
    "While you were away, Rogue snuck out on a Night Raid — Trash-Bag Slime took 3 damage!",
    "Rescue complete — your 6‑day streak is whole again!",
    "Your streak is on 4 days — every perfect day adds one!",
  ]);
  assert.equal(rescueLine(ev("rescued", { streak_after: 1 })), "Rescue complete — your 1‑day streak is whole again!");
  assert.equal(rescueLine(ev("halved", { streak_after: 1 })), "Your streak is on 1 day — every perfect day adds one!");
});

// "Crack" is allowed: the streak "has a crack" and gets patched up (a repair,
// not a loss).
test("NO LOSS FRAMING: no line or closing line ever talks about losing", () => {
  const nights = [
    [row({ perfect_days: 1, raids: 1, raid_damage: 3 })],
    [row({ perfect_days: 2, raids: 2, raid_damage: 6 })],
    [row({ perfect_days: 1 })],
    [row({ perfect_days: 1, boss_id: "worn" })],
    [row({ rescue_events: [ev("cracked")] })],
    [row({ rescue_events: [ev("cracked", { fallback: true })] })],
    [row({ rescue_events: [ev("rescued")] })],
    [row({ rescue_events: [ev("halved", { streak_after: 1 })] })],
    [row({})],
  ];
  for (const rows of nights) {
    const s = summarizeRecaps(rows, bosses, YESTERDAY);
    for (const line of [...s.lines, s.closing]) {
      assert.doesNotMatch(line, /\b(lost|lose|losing|broke|broken|missed|miss|knocked|escaped|party|wasn't|failed|halved)\b/i, line);
    }
  }
});

// --- The timeline ---------------------------------------------------------------------------

test("a raid: the raid lands after the lead, then the cheer; its line with the raid", () => {
  const s = summarizeRecaps([row({ perfect_days: 1, raids: 1, raid_damage: 3, rescue_events: [ev("rescued")] })], bosses, YESTERDAY);
  const beats = recapSchedule(s);
  assert.deepEqual(kinds(beats).filter((k) => k === "raid" || k === "cheer"), ["raid", "cheer"]);
  assert.equal(at(beats, "raid"), RECAP_TIMING.lead);
  assert.equal(at(beats, "cheer"), RECAP_TIMING.lead + RECAP_TIMING.cheerAfter);
  const lines = beats.filter((b) => b.kind === "line");
  assert.equal(lines[0].at, at(beats, "raid"), "the raid line as it lands");
  assert.ok(lines[1].at >= lines[0].at + RECAP_TIMING.lineGap);
  assert.equal(kinds(beats).at(-1), "closing");
});

test("a text recap: no raid, just the lines", () => {
  const s = summarizeRecaps([row({ rescue_events: [ev("cracked")] })], bosses, YESTERDAY);
  const beats = recapSchedule(s);
  assert.ok(!kinds(beats).includes("raid"));
  assert.ok(!kinds(beats).includes("cheer"));
  assert.deepEqual(kinds(beats), ["line", "closing"]);
});

test("the animated part stays short", () => {
  const s = summarizeRecaps(
    [row({ perfect_days: 2, raids: 2, raid_damage: 6, rescue_events: [ev("rescued"), ev("cracked")] })],
    bosses,
    YESTERDAY,
  );
  assert.ok(at(recapSchedule(s), "closing") <= 5000, `${at(recapSchedule(s), "closing")}ms`);
});

test("nothing in the timeline closes the recap: only Continue does", () => {
  const s = summarizeRecaps([row({ perfect_days: 1, raids: 1, raid_damage: 3 })], bosses, YESTERDAY);
  assert.ok(!kinds(recapSchedule(s)).includes("end"));
  assert.ok(!("read" in RECAP_TIMING), "no reading timer");
});

test("skipping lands on the summary card: every line, the raided boss (none for text)", () => {
  const raid = summarizeRecaps([row({ perfect_days: 1, raids: 1, raid_damage: 3, rescue_events: [ev("rescued")] })], bosses, YESTERDAY);
  assert.deepEqual(recapFinalState(raid), { lines: 2, boss: bosses.slime });
  const text = summarizeRecaps([row({ rescue_events: [ev("cracked")] })], bosses, YESTERDAY);
  assert.deepEqual(recapFinalState(text), { lines: 1, boss: null });
});
