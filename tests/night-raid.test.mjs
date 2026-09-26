// Rogue's Night Raid (supabase/migrations/20260930000016_night_raid.sql):
// each perfect day earns a raid on the active boss at the nightly reset — 5%
// of its max HP, rounded up (at least 1), never below 1 HP — logged for that
// child and counted in his reward share. Plus the "progress never goes
// backwards" regression: the nightly reset never raises a boss's HP, never
// lets one escape and never touches party HP.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { importTs } from "./helpers/load-ts.mjs";
import {
  freshDb, asUser, tryAsUser, makeFamily, makePool, makeSlot, stats, activeBoss, addDays,
} from "./helpers/db.mjs";

const raid = await importTs(fileURLToPath(new URL("../lib/rpg/night-raid.ts", import.meta.url)));

let db;
before(async () => {
  db = await freshDb();
});

const D = "2031-03-05"; // a Wednesday, far from the real clock

const reset = async (familyId, today) =>
  (await db.query("select public.run_daily_reset($1, $2) as r", [familyId, today])).rows[0].r;
const raids = async (bossId) =>
  (
    await db.query(
      "select child_id, amount from public.boss_log where boss_id = $1 and event_type = 'night_raid' order by created_at, id",
      [bossId],
    )
  ).rows;
const bossById = async (id) => (await db.query("select * from public.bosses where id = $1", [id])).rows[0];
const setHp = (bossId, max, current) =>
  db.query("update public.bosses set max_hp = $2, current_hp = $3 where id = $1", [bossId, max, current]);
const recap = async (kid) =>
  (await db.query("select * from public.reset_recaps where child_id = $1 order by created_at desc, id limit 1", [kid])).rows[0];

/** Streak history evaluated up to the day before `first` (so a reset looks from `first`). */
const evaluatedTo = (kid, day) =>
  db.query(
    "insert into public.player_stats (child_id, streak_through) values ($1, $2) on conflict (child_id) do update set streak_through = excluded.streak_through",
    [kid, day],
  );

/**
 * Quests for `kid` on `day`: `done` completed (SQL — they strike at once),
 * `open` left open, `quiet` inserted already completed (no strike: a
 * perfect day that deals no quest damage).
 */
async function day(familyId, kid, d, { done = 0, open = 0, quiet = 0, minutes = 10 } = {}) {
  const pool = await makePool(db, { familyId, childId: kid, day: d, minutes: 2000 });
  for (let i = 0; i < quiet; i++) {
    await db.query(
      "insert into public.task_slots (pool_id, scheduled_date, duration_minutes, status) values ($1, $2, $3, 'completed')",
      [pool, d, minutes],
    );
  }
  for (let i = 0; i < done; i++) {
    const id = await makeSlot(db, { poolId: pool, day: d, minutes });
    await db.query("update public.task_slots set status = 'completed' where id = $1", [id]);
  }
  for (let i = 0; i < open; i++) await makeSlot(db, { poolId: pool, day: d, minutes });
}

// --- The raid --------------------------------------------------------------------------

test("a perfect day raids: 5% of max HP rounded up, logged for him, in his recap", async () => {
  const { familyId, childIds: [kid] } = await makeFamily(db);
  const boss = await activeBoss(db, familyId);
  await setHp(boss.id, 61, 61);
  await day(familyId, kid, D, { done: 1 }); // 10 damage → 51

  const r = await reset(familyId, addDays(D, 1));

  assert.deepEqual(await raids(boss.id), [{ child_id: kid, amount: 4 }], "61 × 5% = 3.05 → 4");
  assert.equal((await bossById(boss.id)).current_hp, 47);
  assert.equal(r.raid_damage, 4);
  assert.deepEqual(r.raids.map((x) => [x.child_id, x.day, x.amount, x.hp_after]), [[kid, D, 4, 47]]);
  const rc = await recap(kid);
  assert.deepEqual([rc.raid_damage, rc.raids, rc.perfect_days, rc.boss_id], [4, 1, 1, boss.id]);
});

test("a raid is at least 1 HP (a small boss)", async () => {
  const { familyId, childIds: [kid] } = await makeFamily(db);
  const boss = await activeBoss(db, familyId);
  await setHp(boss.id, 10, 10);
  await day(familyId, kid, D, { done: 1, minutes: 5 }); // → 5
  await reset(familyId, addDays(D, 1));
  assert.deepEqual((await raids(boss.id)).map((x) => x.amount), [1], "10 × 5% = 0.5 → 1");
});

test("a raid never takes the boss below 1 HP; a boss at 1 HP isn't raided (no row)", async () => {
  const { familyId, childIds: [kid] } = await makeFamily(db);
  const boss = await activeBoss(db, familyId);
  await setHp(boss.id, 100, 13);
  await day(familyId, kid, D, { done: 1 }); // → 3
  await reset(familyId, addDays(D, 1));
  assert.deepEqual((await raids(boss.id)).map((x) => x.amount), [2]);
  const after = await bossById(boss.id);
  assert.deepEqual([after.current_hp, after.status], [1, "active"], "a raid never finishes a boss");

  await day(familyId, kid, addDays(D, 1), { quiet: 1 }); // another perfect day, no quest damage
  const r = await reset(familyId, addDays(D, 2));
  assert.equal((await raids(boss.id)).length, 1, "no second row at 1 HP");
  assert.equal(r.raid_damage, 0);
  assert.equal((await recap(kid)).raid_damage, 0);
});

test("several children: one at a time in (day, child) order, each clamped at 1 HP", async () => {
  const { familyId, childIds: [a, b] } = await makeFamily(db, { children: 2 });
  const boss = await activeBoss(db, familyId);
  await setHp(boss.id, 100, 28);
  await day(familyId, a, D, { done: 1 }); // → 18
  await day(familyId, b, D, { done: 1 }); // → 8
  await reset(familyId, addDays(D, 1));
  // a (the lower id) first: 5 → 3; then b: min(5, 3 − 1) = 2 → 1. (Both rows
  // share one transaction's created_at, so compare them in child order.)
  const rows = (await raids(boss.id)).sort((x, y) => x.child_id.localeCompare(y.child_id));
  assert.deepEqual(rows, [{ child_id: a, amount: 5 }, { child_id: b, amount: 2 }]);
  assert.equal((await bossById(boss.id)).current_hp, 1);
  assert.deepEqual([(await recap(a)).raid_damage, (await recap(b)).raid_damage], [5, 2]);
});

test("raid damage counts toward his gold and XP share when the boss is beaten", async () => {
  const { familyId, childIds: [a, b] } = await makeFamily(db, { children: 2 });
  const boss = await activeBoss(db, familyId);
  await setHp(boss.id, 100, 100);
  await day(familyId, a, D, { done: 1 }); // a: 10 → 90; b has a rest day
  await reset(familyId, addDays(D, 1)); // a raids 5 → 85
  const xpBefore = [(await stats(db, a)).xp, (await stats(db, b)).xp];
  await day(familyId, b, addDays(D, 1), { done: 1, minutes: 85 }); // b's final blow

  assert.equal((await bossById(boss.id)).status, "defeated");
  // Shares 15 / 85 (without the raid, a's would be 10 / 95 → 2 gold).
  // Gold 25: 3.75 → 3 / 21.25 → 21, remainder to b. XP 50: 7 / 42, +1 to b.
  assert.deepEqual([(await stats(db, a)).gold, (await stats(db, b)).gold], [3, 22]);
  assert.deepEqual([(await stats(db, a)).xp - xpBefore[0], (await stats(db, b)).xp - xpBefore[1]], [7, 85 + 43]);
});

test("idempotent: re-running a night's reset raids nothing new", async () => {
  const { familyId, childIds: [kid] } = await makeFamily(db);
  const boss = await activeBoss(db, familyId);
  await day(familyId, kid, D, { done: 1 });
  await reset(familyId, addDays(D, 1));
  const hp = (await bossById(boss.id)).current_hp;
  const again = await reset(familyId, addDays(D, 1));
  assert.equal((await raids(boss.id)).length, 1);
  assert.equal((await bossById(boss.id)).current_hp, hp);
  assert.equal(again.raid_damage, 0);
});

test("catch-up over missed nights: one raid per perfect day, in day order", async () => {
  const { familyId, childIds: [kid] } = await makeFamily(db);
  const boss = await activeBoss(db, familyId);
  await setHp(boss.id, 100, 100);
  await evaluatedTo(kid, addDays(D, -1));
  await day(familyId, kid, D, { done: 1 });
  await day(familyId, kid, addDays(D, 1), { done: 1 });
  await day(familyId, kid, addDays(D, 2), { done: 1, open: 1 }); // not perfect
  const r = await reset(familyId, addDays(D, 3));
  assert.deepEqual(r.raids.map((x) => [x.day, x.amount]), [[D, 5], [addDays(D, 1), 5]]);
  assert.deepEqual([(await recap(kid)).raids, (await recap(kid)).raid_damage], [2, 10]);
});

test("no active boss: no raid (the perfect day still counts for the streak)", async () => {
  const { familyId, childIds: [kid] } = await makeFamily(db);
  await db.query("update public.bosses set status = 'defeated' where family_id = $1", [familyId]);
  await day(familyId, kid, D, { done: 1 });
  const r = await reset(familyId, addDays(D, 1));
  assert.deepEqual(r.raids, []);
  const rc = await recap(kid);
  assert.deepEqual([rc.raid_damage, rc.raids, rc.perfect_days, rc.streak_after, rc.boss_id], [0, 0, 1, 1, null]);
});

test("safety net first: a boss left at 0 HP is beaten, and the raid hits the next boss", async () => {
  const { familyId, childIds: [kid] } = await makeFamily(db);
  const slime = await activeBoss(db, familyId);
  await day(familyId, kid, D, { done: 1 });
  await db.query("update public.bosses set current_hp = 0 where id = $1", [slime.id]);
  const r = await reset(familyId, addDays(D, 1));
  assert.equal(r.defeated, slime.id);
  const swarm = await activeBoss(db, familyId);
  assert.equal(swarm.name, "Alarm Clock Swarm");
  assert.deepEqual((await raids(swarm.id)).map((x) => x.amount), [raid.raidDamage(swarm.max_hp, swarm.max_hp)]);
  assert.equal((await raids(slime.id)).length, 0);
});

// --- Tonight's stakes (the evening nudge) ---------------------------------------------

test("tonight's stakes: the raid on offer mirrors lib/rpg/night-raid.ts; no party keys", async () => {
  const { familyId, childIds: [kid] } = await makeFamily(db);
  const boss = await activeBoss(db, familyId);
  for (const [max, current] of [[60, 60], [61, 61], [10, 10], [100, 3], [100, 2], [100, 1]]) {
    await setHp(boss.id, max, current);
    const { rows } = await asUser(db, kid, "select public.tonight_stakes() as s");
    assert.equal(rows[0].s.raid_damage, raid.raidDamage(max, current), `${max} / ${current}`);
    assert.deepEqual([rows[0].s.boss_hp, rows[0].s.boss_max_hp], [current, max]);
  }
  const { rows } = await asUser(db, kid, "select public.tonight_stakes() as s");
  assert.equal("damage" in rows[0].s, false);
  assert.equal("party_hp" in rows[0].s, false);

  await db.query("update public.bosses set status = 'defeated' where family_id = $1", [familyId]);
  const none = (await asUser(db, kid, "select public.tonight_stakes() as s")).rows[0].s;
  assert.deepEqual([none.boss_active, none.raid_damage], [false, 0]);
});

test("the raid rule: RAID_PCT and raidDamage", () => {
  assert.equal(raid.RAID_PCT, 5);
  assert.deepEqual(
    [[60, 60], [61, 61], [10, 10], [100, 3], [100, 1], [1, 1]].map(([m, c]) => raid.raidDamage(m, c)),
    [3, 4, 1, 2, 0, 0],
  );
});

// --- Access -----------------------------------------------------------------------------

test("potions are retired: buy_potion can't be called through the API", async () => {
  const { childIds: [kid] } = await makeFamily(db);
  assert.match((await tryAsUser(db, kid, "select public.buy_potion('small')")) ?? "", /permission denied/);
});

test("a child can't log a raid himself", async () => {
  const { familyId, childIds: [kid] } = await makeFamily(db);
  const boss = await activeBoss(db, familyId);
  assert.notEqual(
    await tryAsUser(db, kid, "insert into public.boss_log (boss_id, event_type, amount, child_id) values ($1, 'night_raid', 50, $2)", [boss.id, kid]),
    null,
  );
});

// --- Regression: progress never goes backwards ---------------------------------------------

test("REGRESSION: across mixed nights the reset never raises boss HP, never lets a boss escape, never touches party HP", async () => {
  const { familyId, childIds: [a, b] } = await makeFamily(db, { children: 2 });
  await evaluatedTo(a, addDays(D, -1));
  await evaluatedTo(b, addDays(D, -1));
  const snapshot = async () =>
    Object.fromEntries(
      (await db.query("select id, max_hp, current_hp, status from public.bosses where family_id = $1", [familyId])).rows.map(
        (x) => [x.id, x],
      ),
    );
  const partyRows = async () =>
    (await db.query("select count(*)::int as n from public.party_health where family_id = $1", [familyId])).rows[0].n;
  const partyBefore = await partyRows();

  // Night by night: misses, perfect days, a skipped night (catch-up), a
  // near-dead boss, a boss beaten mid-way, both children.
  const nights = [
    { a: { done: 1 }, b: { open: 2 } },
    { a: { open: 3, minutes: 60 }, b: { done: 2 } },
    { a: { done: 1 }, b: { done: 1 }, skip: true },
    { a: { done: 2 }, b: { open: 1 }, nearDead: true },
    { a: { open: 5, minutes: 60 }, b: { open: 5, minutes: 60 } },
    { a: { done: 1, minutes: 200 }, b: { done: 1 } }, // beats the boss outright
    { a: { done: 1 }, b: { done: 1 } },
  ];
  let d = D;
  for (const n of nights) {
    await day(familyId, a, d, n.a);
    await day(familyId, b, d, n.b);
    if (n.nearDead) {
      const boss = await activeBoss(db, familyId);
      if (boss) await db.query("update public.bosses set current_hp = 2 where id = $1", [boss.id]);
    }
    d = addDays(d, 1);
    if (n.skip) continue; // no reset tonight: the next one catches up
    const before = await snapshot();
    await reset(familyId, d);
    const after = await snapshot();
    for (const [id, x] of Object.entries(after)) {
      const was = before[id];
      assert.equal(x.max_hp, was.max_hp, `max HP unchanged (${d})`);
      if (was.status === "active" || was.status === "defeated") {
        assert.ok(x.current_hp <= was.current_hp, `boss HP never rises (${d}: ${was.current_hp} → ${x.current_hp})`);
      }
      assert.notEqual(x.status, "escaped", `no escape (${d})`);
      if (was.status === "defeated") assert.equal(x.status, "defeated", "a beaten boss stays beaten");
      if (x.status === "active") assert.ok(x.current_hp >= 1 || was.current_hp === 0, "raids stop at 1 HP");
    }
  }
  const { rows } = await db.query(
    `select event_type, count(*)::int as n from public.boss_log l join public.bosses b on b.id = l.boss_id
      where b.family_id = $1 group by 1`,
    [familyId],
  );
  const kinds = Object.fromEntries(rows.map((x) => [x.event_type, x.n]));
  assert.equal(kinds.escaped, undefined);
  assert.equal(kinds.miss_penalty, undefined);
  assert.equal(kinds.comeback_bonus, undefined);
  assert.ok(kinds.night_raid > 0, "the scenario did raid");
  assert.ok(kinds.defeated > 0, "the scenario did beat a boss");
  assert.equal(await partyRows(), partyBefore, "no party_health row created");
  const logs = await db.query("select count(*)::int as n from public.party_log where family_id = $1", [familyId]);
  assert.equal(logs.rows[0].n, 0, "no party heals");
});
