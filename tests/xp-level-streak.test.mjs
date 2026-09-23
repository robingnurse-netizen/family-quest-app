// XP, levels and streaks (supabase/migrations/20260925000011_xp_level_streak.sql).
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import {
  freshDb, as, tryAs, makeFamily, makePool, makeSlot, stats, slot, activeBoss, londonToday, addDays, setBossHp,
} from "./helpers/db.mjs";
import { importTs } from "./helpers/load-ts.mjs";

let db;
before(async () => {
  db = await freshDb();
});

const tick = (uid, id) => as(db, uid, "update public.task_slots set status = 'completed' where id = $1", [id]);
const untick = (uid, id) => tryAs(db, uid, "update public.task_slots set status = 'scheduled' where id = $1", [id]);
const reset = (familyId, today) => db.query("select public.run_daily_reset($1, $2) as r", [familyId, today]);

// --- XP ---------------------------------------------------------------------

test("a completed quest gives 1 XP per minute, with the boss damage", async () => {
  const { familyId, childIds: [kid] } = await makeFamily(db);
  const today = await londonToday(db);
  const pool = await makePool(db, { familyId, childId: kid, day: today });
  const s = await makeSlot(db, { poolId: pool, day: today, minutes: 30 });
  const hpBefore = (await activeBoss(db, familyId)).current_hp;

  await tick(kid, s);

  assert.equal((await stats(db, kid)).xp, 30);
  const after = await slot(db, s);
  assert.equal(after.applied_to_boss, true);
  assert.equal(after.xp_awarded, true);
  assert.equal((await activeBoss(db, familyId)).current_hp, hpBefore - 30);
});

test("no XP farming: a ticked quest can't be un-ticked and re-ticked", async () => {
  const { familyId, childIds: [kid] } = await makeFamily(db);
  const today = await londonToday(db);
  const pool = await makePool(db, { familyId, childId: kid, day: today });
  const s = await makeSlot(db, { poolId: pool, day: today, minutes: 20 });

  await tick(kid, s);
  const err = await untick(kid, s);
  assert.match(err ?? "", /^slot_locked/);
  // Even a parent/SQL un-tick + re-tick can't award it twice.
  await db.query("update public.task_slots set status = 'scheduled' where id = $1", [s]);
  await db.query("update public.task_slots set status = 'completed' where id = $1", [s]);
  assert.equal((await stats(db, kid)).xp, 20);
});

test("no active boss: XP is still awarded exactly once, and the slot locks", async () => {
  const { familyId, childIds: [kid] } = await makeFamily(db);
  await db.query("update public.bosses set status = 'defeated' where family_id = $1", [familyId]);
  const today = await londonToday(db);
  const pool = await makePool(db, { familyId, childId: kid, day: today });
  const s = await makeSlot(db, { poolId: pool, day: today, minutes: 25 });

  await tick(kid, s);
  const after = await slot(db, s);
  assert.equal(after.applied_to_boss, false);
  assert.equal(after.xp_awarded, true);
  assert.match((await untick(kid, s)) ?? "", /^slot_locked/);
  assert.equal((await stats(db, kid)).xp, 25);
});

test("defeat bonus XP is split by damage share, like the gold", async () => {
  const { familyId, childIds: [a, b] } = await makeFamily(db, { children: 2 });
  const boss = await activeBoss(db, familyId);
  assert.equal(boss.tier, "low");
  await setBossHp(db, familyId, 100);
  const today = await londonToday(db);
  const sa = await makeSlot(db, { poolId: await makePool(db, { familyId, childId: a, day: today }), day: today, minutes: 60 });
  const sb = await makeSlot(db, { poolId: await makePool(db, { familyId, childId: b, day: today }), day: today, minutes: 40 });

  await tick(a, sa);
  await tick(b, sb); // the final blow
  const { rows } = await db.query("select status from public.bosses where id = $1", [boss.id]);
  assert.equal(rows[0].status, "defeated");

  // Low tier: 50 bonus XP → 30 / 20 (60% / 40%); gold 25 → 15 / 10.
  const [sA, sB] = [await stats(db, a), await stats(db, b)];
  assert.equal(sA.xp, 60 + 30);
  assert.equal(sB.xp, 40 + 20);
  assert.equal(sA.gold, 15);
  assert.equal(sB.gold, 10);
});

// --- Levels -----------------------------------------------------------------

test("level curve: 50 × L × (L − 1), and the TypeScript mirror agrees", async () => {
  const q = async (sql, v) => (await db.query(sql, [v])).rows[0].v;
  assert.equal(await q("select public.xp_for_level($1) as v", 2), 100);
  assert.equal(await q("select public.xp_for_level($1) as v", 5), 1000);
  assert.equal(await q("select public.xp_for_level($1) as v", 10), 4500);
  for (const [xp, level] of [[0, 1], [99, 1], [100, 2], [299, 2], [300, 3], [999, 4], [1000, 5], [4499, 9], [4500, 10]]) {
    assert.equal(await q("select public.level_for_xp($1) as v", xp), level, `level at ${xp} XP`);
  }
  const ts = await importTs(fileURLToPath(new URL("../lib/rpg/levels.ts", import.meta.url)));
  for (let xp = 0; xp <= 6000; xp += 37) {
    assert.equal(ts.levelForXp(xp), await q("select public.level_for_xp($1) as v", xp), `mirror at ${xp} XP`);
  }
  for (let level = 1; level <= 20; level++) {
    assert.equal(ts.xpForLevel(level), await q("select public.xp_for_level($1) as v", level));
  }
});

test("levelling up happens in the same transaction as the XP", async () => {
  const { familyId, childIds: [kid] } = await makeFamily(db);
  await setBossHp(db, familyId, 10000); // no defeat bonus in the way
  const today = await londonToday(db);
  const pool = await makePool(db, { familyId, childId: kid, day: today });
  const s = await makeSlot(db, { poolId: pool, day: today, minutes: 100 });
  await tick(kid, s);
  const st = await stats(db, kid);
  assert.equal(st.xp, 100);
  assert.equal(st.level, 2);
});

// --- Streaks ------------------------------------------------------------------
// Days far in the future, driven through run_daily_reset(family, today).

const D = "2031-03-03"; // a Monday
async function streakFamily() {
  const f = await makeFamily(db);
  const kid = f.childIds[0];
  const pool = await makePool(db, { familyId: f.familyId, childId: kid, day: D, minutes: 2000 });
  // Start evaluating from D (as if last evaluated the day before).
  await db.query("insert into public.player_stats (child_id, streak_through) values ($1, $2) on conflict (child_id) do update set streak_through = excluded.streak_through", [kid, addDays(D, -1)]);
  const day = async (offset, { done = 0, open = 0 } = {}) => {
    const d = addDays(D, offset);
    for (let i = 0; i < done; i++) {
      const id = await makeSlot(db, { poolId: pool, day: d, minutes: 10 });
      await db.query("update public.task_slots set status = 'completed' where id = $1", [id]);
    }
    for (let i = 0; i < open; i++) await makeSlot(db, { poolId: pool, day: d, minutes: 10 });
  };
  return { ...f, kid, day };
}

test("a day with every quest done adds 1; best streak is kept", async () => {
  const { familyId, kid, day } = await streakFamily();
  await day(0, { done: 2 });
  await reset(familyId, addDays(D, 1));
  let st = await stats(db, kid);
  assert.equal(st.current_streak, 1);
  assert.equal(st.best_streak, 1);
  await day(1, { done: 1 });
  await reset(familyId, addDays(D, 2));
  st = await stats(db, kid);
  assert.equal(st.current_streak, 2);
  assert.equal(st.best_streak, 2);
});

test("rest days neither add nor break the streak", async () => {
  const { familyId, kid, day } = await streakFamily();
  await day(0, { done: 1 });
  // D+1: nothing scheduled.
  await day(2, { done: 1 });
  await reset(familyId, addDays(D, 1));
  await reset(familyId, addDays(D, 2));
  assert.equal((await stats(db, kid)).current_streak, 1);
  await reset(familyId, addDays(D, 3));
  assert.equal((await stats(db, kid)).current_streak, 2);
});

test("any missed quest resets the streak to 0 (best stays)", async () => {
  const { familyId, kid, day } = await streakFamily();
  await day(0, { done: 1 });
  await day(1, { done: 1, open: 1 }); // the open one becomes missed
  await reset(familyId, addDays(D, 1));
  await reset(familyId, addDays(D, 2));
  const st = await stats(db, kid);
  assert.equal(st.current_streak, 0);
  assert.equal(st.best_streak, 1);
  const { rows } = await db.query(
    "select count(*)::int as n from public.task_slots s join public.weekly_pools p on p.id = s.pool_id where p.child_id = $1 and s.status = 'missed'",
    [kid],
  );
  assert.equal(rows[0].n, 1);
});

test("catches up over several missed nights, evaluating days in order", async () => {
  const { familyId, kid, day } = await streakFamily();
  await day(0, { done: 1 }); // +1
  await day(1, { open: 1 }); // missed → 0
  await day(2, { done: 2 }); // +1
  // D+3: rest
  await day(4, { done: 1 }); // +1
  // One reset after five nights without one.
  await reset(familyId, addDays(D, 5));
  const st = await stats(db, kid);
  assert.equal(st.current_streak, 2, "in order: 1 → 0 → 1 → (rest) → 2");
  assert.equal(st.best_streak, 2);
  assert.equal(st.streak_through, addDays(D, 4));
});

test("the reset is idempotent: running it again changes nothing", async () => {
  const { familyId, kid, day } = await streakFamily();
  await day(0, { done: 1 });
  await day(1, { done: 1, open: 1 });
  await reset(familyId, addDays(D, 2));
  const first = await stats(db, kid);
  const { rows: missed1 } = await db.query("select count(*)::int as n from public.task_slots where status = 'missed'");
  await reset(familyId, addDays(D, 2));
  await reset(familyId, addDays(D, 2));
  const again = await stats(db, kid);
  const { rows: missed2 } = await db.query("select count(*)::int as n from public.task_slots where status = 'missed'");
  assert.deepEqual(
    { s: again.current_streak, b: again.best_streak, t: again.streak_through, xp: again.xp },
    { s: first.current_streak, b: first.best_streak, t: first.streak_through, xp: first.xp },
  );
  assert.equal(missed2[0].n, missed1[0].n);
});

test("a first evaluation (no history) looks at yesterday only", async () => {
  const f = await makeFamily(db);
  const kid = f.childIds[0];
  const pool = await makePool(db, { familyId: f.familyId, childId: kid, day: D, minutes: 1000 });
  for (const offset of [0, 1]) {
    const id = await makeSlot(db, { poolId: pool, day: addDays(D, offset), minutes: 10 });
    await db.query("update public.task_slots set status = 'completed' where id = $1", [id]);
  }
  await reset(f.familyId, addDays(D, 2));
  const st = await stats(db, kid);
  assert.equal(st.current_streak, 1, "only D+1 counted, not D (no backfill)");
  assert.equal(st.streak_through, addDays(D, 1));
});
