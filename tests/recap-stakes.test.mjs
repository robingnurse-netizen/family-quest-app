// "While you were away" recaps and the evening nudge's stakes
// (supabase/migrations/20260926000012_recap_evening_healing.sql, as changed by
// …14 and …16: a reset takes nothing away and records his Night Raids).
// Potions and perfect-day heals are retired (…16); Night Raid rules live in
// tests/night-raid.test.mjs.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import {
  freshDb,
  asUser,
  tryAsUser,
  makeFamily,
  makePool,
  makeSlot,
  activeBoss,
  addDays,
  londonToday,
} from "./helpers/db.mjs";

let db;
before(async () => {
  db = await freshDb();
});

const reset = (familyId, today) => db.query("select public.run_daily_reset($1, $2) as r", [familyId, today]);
const recaps = async (childId) =>
  (
    await db.query(
      "select *, to_char(day_from, 'YYYY-MM-DD') as day_from, to_char(day_to, 'YYYY-MM-DD') as day_to from public.reset_recaps where child_id = $1 order by created_at, id",
      [childId],
    )
  ).rows;
const unseen = async (childId) => (await recaps(childId)).filter((r) => r.seen_at === null);

// Days far in the future (as in xp-level-streak.test.mjs), driven through
// run_daily_reset(family, today).
const D = "2032-03-01"; // a Monday
async function world({ children = 1 } = {}) {
  const f = await makeFamily(db, { children });
  const pools = {};
  for (const kid of f.childIds) {
    pools[kid] = await makePool(db, { familyId: f.familyId, childId: kid, day: D, minutes: 3000 });
    // Evaluated up to the day before D, so every day from D counts.
    await db.query(
      "insert into public.player_stats (child_id, streak_through) values ($1, $2) on conflict (child_id) do update set streak_through = excluded.streak_through",
      [kid, addDays(D, -1)],
    );
  }
  const kid = f.childIds[0];
  /** Quests on day D+offset: `done` completed, `open` left (missed at reset). */
  const day = async (offset, { done = 0, open = 0, minutes = 15, child = kid } = {}) => {
    const d = addDays(D, offset);
    for (let i = 0; i < done; i++) {
      const id = await makeSlot(db, { poolId: pools[child], day: d, minutes });
      await db.query("update public.task_slots set status = 'completed' where id = $1", [id]);
    }
    for (let i = 0; i < open; i++) await makeSlot(db, { poolId: pools[child], day: d, minutes });
  };
  return { ...f, kid, day };
}

/** A snapshot of all game state for a family (to prove nothing changed). */
async function gameState(familyId) {
  const q = async (sql) => (await db.query(sql, [familyId])).rows;
  return {
    party: await q("select current_hp, max_hp from public.party_health where family_id = $1"),
    bosses: await q("select id, status, current_hp from public.bosses where family_id = $1 order by id"),
    stats: await q(
      "select s.gold, s.xp, s.level, s.current_streak, s.best_streak from public.player_stats s join public.profiles p on p.id = s.child_id where p.family_id = $1 order by p.id",
    ),
    slots: await q(
      "select s.id, s.status, s.applied_to_boss from public.task_slots s join public.weekly_pools p on p.id = s.pool_id where p.family_id = $1 order by s.id",
    ),
    log: await q("select count(*)::int as n from public.boss_log l join public.bosses b on b.id = l.boss_id where b.family_id = $1"),
  };
}

// --- Recaps: what gets recorded -------------------------------------------------------

test("a reset with misses records his recap: quests, minutes, the boss — and nothing taken away", async () => {
  const { familyId, kid, day } = await world();
  const boss = await activeBoss(db, familyId);
  await day(0, { done: 1, open: 2, minutes: 15 }); // 2 missed, 30 min
  await reset(familyId, addDays(D, 1));

  const [r] = await recaps(kid);
  assert.equal(r.missed_quests, 2);
  assert.equal(r.missed_minutes, 30);
  assert.equal(r.boss_id, boss.id);
  assert.deepEqual([r.day_from, r.day_to], [D, D]);
  assert.deepEqual([r.raid_damage, r.raids, r.perfect_days], [0, 0, 0]);
  // The dormant party columns (…16): never written, left at their defaults.
  assert.deepEqual([r.party_damage, r.healed, r.knocked_out, r.escaped_boss_id, r.next_boss_id], [0, 0, false, null, null]);
  assert.equal(r.seen_at, null);
});

test("a perfect day's recap carries his Night Raid", async () => {
  const { familyId, kid, day } = await world();
  const boss = await activeBoss(db, familyId);
  await day(0, { done: 2, minutes: 10 });
  await reset(familyId, addDays(D, 1));
  const [r] = await recaps(kid);
  assert.deepEqual([r.perfect_days, r.raids, r.raid_damage, r.boss_id], [1, 1, Math.ceil(boss.max_hp * 0.05), boss.id]);
  assert.deepEqual([r.streak_before, r.streak_after], [0, 1]);
});

test("a cracked streak: the recap keeps it at its value and records the crack (…14)", async () => {
  const { familyId, kid, day } = await world();
  await day(0, { done: 1 });
  await day(1, { done: 1 });
  await reset(familyId, addDays(D, 2)); // streak 2
  await day(2, { open: 1 });
  await reset(familyId, addDays(D, 3));
  const last = (await recaps(kid)).at(-1);
  assert.equal(last.streak_before, 2);
  assert.equal(last.streak_after, 2, "frozen, not lost");
  // No rescue jobs in this family: the fallback, due the day after the miss.
  assert.deepEqual(last.rescue_events.map((e) => [e.event, e.streak_at_crack, e.due_on, e.fallback]), [["cracked", 2, addDays(D, 3), true]]);
});

test("no boss: misses are recorded with no boss and no raid", async () => {
  const { familyId, kid, day } = await world();
  await db.query("update public.bosses set status = 'defeated' where family_id = $1", [familyId]);
  await day(0, { open: 1, minutes: 20 });
  await reset(familyId, addDays(D, 1));

  const [r] = await recaps(kid);
  assert.equal(r.missed_quests, 1);
  assert.equal(r.missed_minutes, 20);
  assert.equal(r.boss_id, null);
  assert.equal(r.raid_damage, 0);
});

test("rest days and re-runs record nothing", async () => {
  const { familyId, kid, day } = await world();
  await reset(familyId, addDays(D, 1)); // D: nothing scheduled
  assert.equal((await recaps(kid)).length, 0);
  await day(1, { open: 1 });
  await reset(familyId, addDays(D, 2));
  await reset(familyId, addDays(D, 2));
  await reset(familyId, addDays(D, 2));
  assert.equal((await recaps(kid)).length, 1, "one row for that run, none for re-runs");
});

test("a sibling's misses don't write him a recap any more (nothing hits the party)", async () => {
  const { familyId, childIds: [a, b], day } = await world({ children: 2 });
  await day(0, { open: 2, child: b });
  await reset(familyId, addDays(D, 1));
  assert.equal((await recaps(a)).length, 0);
  assert.equal((await recaps(b)).length, 1);
});

// --- Recaps: scope and show-once --------------------------------------------------------

test("scope: every night since his last acknowledgement, and only those", async () => {
  const { familyId, kid, day } = await world();
  await day(0, { open: 1 });
  await reset(familyId, addDays(D, 1));
  await day(1, { open: 2 });
  await reset(familyId, addDays(D, 2));
  await day(2, { done: 1 });
  await reset(familyId, addDays(D, 3));

  // Three nights while he was away: three unseen rows (combined on screen).
  let rows = await unseen(kid);
  assert.equal(rows.length, 3);
  assert.deepEqual(rows.map((r) => r.missed_quests), [1, 2, 0]);
  assert.equal(rows[2].perfect_days, 1);

  const through = rows.at(-1).created_at;
  const { rows: ack } = await asUser(db, kid, "select public.acknowledge_recaps($1) as n", [through]);
  assert.equal(ack[0].n, 3);
  assert.equal((await unseen(kid)).length, 0);

  // The next night starts a new recap.
  await day(3, { open: 1 });
  await reset(familyId, addDays(D, 4));
  rows = await unseen(kid);
  assert.equal(rows.length, 1);
  assert.deepEqual([rows[0].day_from, rows[0].day_to], [addDays(D, 3), addDays(D, 3)]);
});

test("show once: acknowledging again changes nothing; a newer recap isn't swallowed", async () => {
  const { familyId, kid, day } = await world();
  await day(0, { open: 1 });
  await reset(familyId, addDays(D, 1));
  const shown = (await unseen(kid)).at(-1).created_at;

  // A reset lands while he's watching the first recap…
  await db.query("select pg_sleep(0.01)");
  await day(1, { open: 1 });
  await reset(familyId, addDays(D, 2));

  // …acknowledging what he saw leaves the newer one for next time.
  const first = await asUser(db, kid, "select public.acknowledge_recaps($1) as n", [shown]);
  assert.equal(first.rows[0].n, 1);
  const again = await asUser(db, kid, "select public.acknowledge_recaps($1) as n", [shown]);
  assert.equal(again.rows[0].n, 0);
  assert.equal((await unseen(kid)).length, 1);
});

// --- Recaps: acknowledgement security ------------------------------------------------------

test("a child acknowledges only his own recaps, and nothing else changes", async () => {
  const { familyId, parentId, childIds: [kid, sister], day } = await world({ children: 2 });
  await day(0, { open: 1, child: kid });
  await day(0, { open: 1, child: sister });
  await reset(familyId, addDays(D, 1));
  assert.equal((await unseen(kid)).length, 1);
  assert.equal((await unseen(sister)).length, 1);

  const before = await gameState(familyId);
  const far = "2099-01-01T00:00:00Z";
  await asUser(db, kid, "select public.acknowledge_recaps($1)", [far]);
  assert.equal((await unseen(kid)).length, 0);
  assert.equal((await unseen(sister)).length, 1, "his sister's recap is untouched");

  // A parent's acknowledgement matches no rows (it's per child).
  const { rows } = await asUser(db, parentId, "select public.acknowledge_recaps($1) as n", [far]);
  assert.equal(rows[0].n, 0);
  assert.equal((await unseen(sister)).length, 1);

  assert.deepEqual(await gameState(familyId), before, "acknowledging changes no game state");
});

test("recaps are read-only through the API and private to the child and parents", async () => {
  const { familyId, parentId, childIds: [kid, sister], day } = await world({ children: 2 });
  await day(0, { open: 1, child: kid });
  await reset(familyId, addDays(D, 1));
  const [r] = await recaps(kid);

  // No writes: RLS has no write policy (updates / deletes match nothing).
  await asUser(db, kid, "update public.reset_recaps set seen_at = now(), party_damage = 0 where id = $1", [r.id]);
  await asUser(db, kid, "delete from public.reset_recaps where id = $1", [r.id]);
  const [after] = await recaps(kid);
  assert.equal(after.seen_at, null);
  assert.equal(after.party_damage, r.party_damage);
  assert.match(
    await tryAsUser(
      db, kid,
      "insert into public.reset_recaps (family_id, child_id, hp_before, hp_after, max_hp) values ($1, $2, 1, 1, 1)",
      [familyId, kid],
    ),
    /row-level security/,
  );

  // Reads: his own and his parents', not his sister's.
  const read = async (uid) =>
    (await asUser(db, uid, "select count(*)::int as n from public.reset_recaps where id = $1", [r.id])).rows[0].n;
  assert.equal(await read(kid), 1);
  assert.equal(await read(parentId), 1);
  assert.equal(await read(sister), 0);

  // Anonymous callers can't acknowledge anything.
  await db.exec("set role anon");
  try {
    await assert.rejects(db.query("select public.acknowledge_recaps(now())"), /permission denied/);
  } finally {
    await db.exec("reset role");
  }
});

// --- Evening stakes (the Night Raid nudge) ------------------------------------------------------

test("tonight's stakes: his quests left today (family time), and the raid a perfect day would earn", async () => {
  const f = await makeFamily(db);
  const kid = f.childIds[0];
  const today = await londonToday(db);
  await db.query("update public.bosses set max_hp = 200, current_hp = 200 where family_id = $1 and status = 'active'", [f.familyId]);
  const pool = await makePool(db, { familyId: f.familyId, childId: kid, day: today, minutes: 3000 });
  const q1 = await makeSlot(db, { poolId: pool, day: today, minutes: 30 });
  const q2 = await makeSlot(db, { poolId: pool, day: today, minutes: 15 });
  const done = await makeSlot(db, { poolId: pool, day: today, minutes: 60 });
  await db.query("update public.task_slots set status = 'completed' where id = $1", [done]);
  await makeSlot(db, { poolId: pool, day: addDays(today, 1), minutes: 60 }); // tomorrow: not tonight
  // Yesterday's, still open (the reset hasn't run): not tonight's offer either (…18).
  const earlier = await makePool(db, { familyId: f.familyId, childId: kid, day: addDays(today, -1), minutes: 3000 });
  await makeSlot(db, { poolId: earlier, day: addDays(today, -1), minutes: 20 });

  const stakes = async () => (await asUser(db, kid, "select public.tonight_stakes() as s")).rows[0].s;
  let s = await stakes();
  assert.equal(s.today, today);
  assert.equal(s.boss_active, true);
  assert.equal(s.my_open_quests, 2);
  assert.equal("open_quests" in s, false, "…18: the miss penalty's totals are gone");
  assert.equal("open_minutes" in s, false);
  assert.equal(s.raid_damage, 10, "200 × 5%");

  // What the reset actually deals once he finishes them: run it for tomorrow.
  await db.query("update public.task_slots set status = 'completed' where id = any($1)", [[q1, q2]]);
  await db.query(
    "insert into public.player_stats (child_id, streak_through) values ($1, $2) on conflict (child_id) do update set streak_through = excluded.streak_through",
    [kid, addDays(today, -1)],
  );
  const { rows } = await db.query("select public.run_daily_reset($1, $2) as r", [f.familyId, addDays(today, 1)]);
  assert.equal(rows[0].r.raid_damage, s.raid_damage);

  // No boss: no raid on offer.
  await db.query("update public.bosses set status = 'defeated' where family_id = $1", [f.familyId]);
  s = await stakes();
  assert.equal(s.boss_active, false);
  assert.equal(s.raid_damage, 0);
});

test("tonight's stakes use the family's timezone for 'today'", async () => {
  const f = await makeFamily(db);
  const kid = f.childIds[0];
  for (const tz of ["Pacific/Kiritimati", "Pacific/Pago_Pago"]) {
    await db.query("update public.families set timezone = $2 where id = $1", [f.familyId, tz]);
    const { rows } = await asUser(db, kid, "select public.tonight_stakes() ->> 'today' as today");
    const { rows: want } = await db.query("select to_char((now() at time zone $1)::date, 'YYYY-MM-DD') as d", [tz]);
    assert.equal(rows[0].today, want[0].d, tz);
  }
});
