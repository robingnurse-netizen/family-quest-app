// The child slot guard (…05, …08, …10, …11): what a child's account can
// write on task_slots. Parents / the service role are unrestricted.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { freshDb, as, tryAs, makeFamily, makePool, makeSlot, slot, londonToday, addDays } from "./helpers/db.mjs";

let db;
before(async () => {
  db = await freshDb();
});

const insertAs = (uid, pool, day) =>
  tryAs(db, uid, "insert into public.task_slots (pool_id, scheduled_date, duration_minutes) values ($1, $2, 15)", [pool, day]);

test("a child can't plan a quest on a past day (insert or move)", async () => {
  const { familyId, parentId, childIds: [kid] } = await makeFamily(db);
  const today = await londonToday(db);
  const yesterday = addDays(today, -1);
  const poolY = await makePool(db, { familyId, childId: kid, day: yesterday });
  const poolT = await makePool(db, { familyId, childId: kid, day: today });

  assert.match((await insertAs(kid, poolY, yesterday)) ?? "", /^slot_past_day/);
  assert.equal(await insertAs(kid, poolT, today), null);
  assert.equal(await insertAs(parentId, poolY, yesterday), null, "parents unaffected");
  assert.equal(await insertAs(null, poolY, yesterday), null, "service role unaffected");

  if (poolY === poolT || (await db.query("select 1 from public.weekly_pools where id = $1 and week_start_date = (select week_start_date from public.weekly_pools where id = $2)", [poolY, poolT])).rows.length) {
    const s = await makeSlot(db, { poolId: poolT, day: today, minutes: 15 });
    assert.match(
      (await tryAs(db, kid, "update public.task_slots set scheduled_date = $2 where id = $1", [s, yesterday])) ?? "",
      /^slot_past_day/,
    );
  }
});

test("a child can tick a quest that's already on a past day", async () => {
  const { familyId, childIds: [kid] } = await makeFamily(db);
  const yesterday = addDays(await londonToday(db), -1);
  const pool = await makePool(db, { familyId, childId: kid, day: yesterday });
  const s = await makeSlot(db, { poolId: pool, day: yesterday, minutes: 15 });
  assert.equal(await tryAs(db, kid, "update public.task_slots set status = 'completed' where id = $1", [s]), null);
  assert.equal((await slot(db, s)).status, "completed");
});

test("slot_locked is back: a ticked (applied) quest's status is final for a child", async () => {
  const { familyId, childIds: [kid] } = await makeFamily(db);
  const today = await londonToday(db);
  const pool = await makePool(db, { familyId, childId: kid, day: today });
  const s = await makeSlot(db, { poolId: pool, day: today, minutes: 15 });
  await as(db, kid, "update public.task_slots set status = 'completed' where id = $1", [s]);
  assert.equal((await slot(db, s)).applied_to_boss, true);
  assert.match(
    (await tryAs(db, kid, "update public.task_slots set status = 'scheduled' where id = $1", [s])) ?? "",
    /^slot_locked/,
  );
});

test("a child can't set engine columns or mark a quest missed", async () => {
  const { familyId, childIds: [kid] } = await makeFamily(db);
  const today = await londonToday(db);
  const pool = await makePool(db, { familyId, childId: kid, day: today });
  const s = await makeSlot(db, { poolId: pool, day: today, minutes: 15 });
  for (const sql of [
    "update public.task_slots set applied_to_boss = true where id = $1",
    "update public.task_slots set xp_awarded = true where id = $1",
    "update public.task_slots set status = 'missed' where id = $1",
  ]) {
    assert.match((await tryAs(db, kid, sql, [s])) ?? "", /^slot_child_forbidden/, sql);
  }
});

test("a child can only remove quests still to do", async () => {
  const { familyId, childIds: [kid] } = await makeFamily(db);
  const today = await londonToday(db);
  const pool = await makePool(db, { familyId, childId: kid, day: today });
  const open = await makeSlot(db, { poolId: pool, day: today, minutes: 15 });
  const done = await makeSlot(db, { poolId: pool, day: today, minutes: 15 });
  await as(db, kid, "update public.task_slots set status = 'completed' where id = $1", [done]);
  assert.equal(await tryAs(db, kid, "delete from public.task_slots where id = $1", [open]), null);
  assert.match((await tryAs(db, kid, "delete from public.task_slots where id = $1", [done])) ?? "", /^slot_child_forbidden/);
});
