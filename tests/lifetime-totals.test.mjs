// Lifetime stat counters (supabase/migrations/20261001000017_lifetime_totals.sql):
// player_stats.total_damage_dealt / total_quests_completed /
// total_bosses_defeated — bumped once, by the engine only, at the real
// event, never decremented; nobody else (not the child, not a parent through
// the API, not even plain SQL) can write them.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import {
  freshDb, as, asUser, tryAsUser, makeFamily, makePool, makeSlot, activeBoss, londonToday, addDays,
} from "./helpers/db.mjs";

let db;
/** The family's today (rescue pick / complete check "past due" against the real clock). */
let TODAY;
before(async () => {
  db = await freshDb();
  TODAY = await londonToday(db);
});

const D = "2031-03-05"; // far-future days for reset-driven tests

const totals = async (kid) => {
  const { rows } = await db.query(
    "select total_damage_dealt as damage, total_quests_completed as quests, total_bosses_defeated as bosses from public.player_stats where child_id = $1",
    [kid],
  );
  return rows[0] ?? { damage: 0, quests: 0, bosses: 0 };
};
const reset = async (familyId, today) =>
  (await db.query("select public.run_daily_reset($1, $2) as r", [familyId, today])).rows[0].r;
const setHp = (bossId, max, current) =>
  db.query("update public.bosses set max_hp = $2, current_hp = $3 where id = $1", [bossId, max, current]);

/** A quest for `kid` on `day` in its own pool; returns the slot id. */
async function quest(familyId, kid, day, minutes = 10) {
  const pool = await makePool(db, { familyId, childId: kid, day, minutes: 2000 });
  return makeSlot(db, { poolId: pool, day, minutes });
}
const tick = (kid, slotId) => as(db, kid, "update public.task_slots set status = 'completed' where id = $1", [slotId]);

/** Streak history evaluated up to `day`, with a streak of `streak`. */
const evaluatedTo = (kid, day, streak = 0) =>
  db.query(
    `insert into public.player_stats (child_id, current_streak, best_streak, streak_through) values ($1, $2, $2, $3)
     on conflict (child_id) do update set current_streak = excluded.current_streak, best_streak = excluded.best_streak,
       streak_through = excluded.streak_through`,
    [kid, streak, day],
  );

/** Yesterday missed with a streak going: the next reset (today) puts it on hold and opens a rescue. */
async function onHold({ jobs }) {
  const f = await makeFamily(db);
  const kid = f.childIds[0];
  for (let i = 0; i < jobs; i++) {
    await db.query("insert into public.rescue_jobs (family_id, title, minutes) values ($1, $2, 10)", [f.familyId, `Job ${i + 1}`]);
  }
  await evaluatedTo(kid, addDays(TODAY, -2), 5);
  await quest(f.familyId, kid, addDays(TODAY, -1)); // left open: missed
  await reset(f.familyId, TODAY);
  const { rows } = await db.query("select * from public.streak_rescues where child_id = $1 and status = 'open'", [kid]);
  assert.equal(rows.length, 1, "the rescue is open");
  return { ...f, kid, rescue: rows[0] };
}

// --- total_quests_completed + total_damage_dealt on a quest tick -------------------------

test("a quest tick: +1 quest (the xp_awarded branch) and += its damage (strike_active_boss)", async () => {
  const { familyId, childIds: [kid] } = await makeFamily(db);
  const slot = await quest(familyId, kid, TODAY, 15);
  await tick(kid, slot);
  assert.deepEqual(await totals(kid), { damage: 15, quests: 1, bosses: 0 });
});

test("a quest ticked with no active boss still counts as completed, with no damage", async () => {
  const { familyId, childIds: [kid] } = await makeFamily(db);
  await db.query("update public.bosses set status = 'defeated' where family_id = $1", [familyId]);
  await tick(kid, await quest(familyId, kid, TODAY, 20));
  assert.deepEqual(await totals(kid), { damage: 0, quests: 1, bosses: 0 });
});

test("once per slot: a parent un-ticking and re-ticking it doesn't count it again", async () => {
  const { familyId, parentId, childIds: [kid] } = await makeFamily(db);
  const slot = await quest(familyId, kid, TODAY, 10);
  await tick(kid, slot);
  await asUser(db, parentId, "update public.task_slots set status = 'scheduled' where id = $1", [slot]);
  await asUser(db, parentId, "update public.task_slots set status = 'completed' where id = $1", [slot]);
  assert.deepEqual(await totals(kid), { damage: 10, quests: 1, bosses: 0 });
});

// --- total_quests_completed: the two rescue paths -------------------------------------------

test("a job rescue: +1 quest and its damage at complete_rescue(); nothing more when the reset resolves it", async () => {
  const { familyId, kid, rescue } = await onHold({ jobs: 2 });
  const before = await totals(kid);
  await asUser(db, kid, "select public.pick_rescue_job($1, $2)", [rescue.id, rescue.offered[0].job_id]);
  await asUser(db, kid, "select public.complete_rescue($1)", [rescue.id]);
  assert.deepEqual(await totals(kid), { damage: before.damage + 10, quests: before.quests + 1, bosses: before.bosses });

  // A second complete is refused (rescue_closed): no second count.
  assert.match((await tryAsUser(db, kid, "select public.complete_rescue($1)", [rescue.id])) ?? "", /rescue_closed/);
  await reset(familyId, addDays(TODAY, 1)); // resolves it: rescued
  const { rows } = await db.query("select status from public.streak_rescues where id = $1", [rescue.id]);
  assert.equal(rows[0].status, "rescued");
  assert.equal((await totals(kid)).quests, before.quests + 1, "the job rescue isn't counted twice");
});

test("a fallback (no-jobs) rescue: +1 in total — the quest that satisfies it, at tick time; the resolution adds nothing", async () => {
  const { familyId, kid, rescue } = await onHold({ jobs: 0 });
  assert.equal(rescue.fallback, true);
  const before = await totals(kid);
  await tick(kid, await quest(familyId, kid, TODAY, 10)); // any quest on the due day
  assert.equal((await totals(kid)).quests, before.quests + 1, "+1 at tick time");
  await reset(familyId, addDays(TODAY, 1));
  const { rows } = await db.query("select status from public.streak_rescues where id = $1", [rescue.id]);
  assert.equal(rows[0].status, "rescued");
  assert.equal((await totals(kid)).quests, before.quests + 1, "the rescue resolving doesn't count it again");
  await reset(familyId, addDays(TODAY, 1)); // a re-run resolves nothing new
  assert.equal((await totals(kid)).quests, before.quests + 1);
});

test("a fallback rescue that lapses (halved) counts nothing", async () => {
  const { familyId, kid, rescue } = await onHold({ jobs: 0 });
  const before = await totals(kid);
  await reset(familyId, addDays(TODAY, 2)); // nothing done by the due day
  const { rows } = await db.query("select status from public.streak_rescues where id = $1", [rescue.id]);
  assert.equal(rows[0].status, "lapsed");
  assert.equal((await totals(kid)).quests, before.quests);
});

// --- total_damage_dealt: the Night Raid ------------------------------------------------------

test("a Night Raid: += the raid amount for the raider", async () => {
  const { familyId, childIds: [kid] } = await makeFamily(db);
  const boss = await activeBoss(db, familyId);
  await setHp(boss.id, 100, 100);
  await evaluatedTo(kid, addDays(D, -1));
  await tick(kid, await quest(familyId, kid, D, 10)); // 10 damage, +1 quest
  const r = await reset(familyId, addDays(D, 1)); // perfect day: raid 5
  assert.equal(r.raid_damage, 5);
  assert.deepEqual(await totals(kid), { damage: 15, quests: 1, bosses: 0 });
});

// --- total_bosses_defeated ---------------------------------------------------------------------

test("a defeat counts for every child with damage in this fight — a 0-gold share and a raid-only child too", async () => {
  const { familyId, childIds: [a, b, c, d] } = await makeFamily(db, { children: 4 });
  const boss = await activeBoss(db, familyId);
  await setHp(boss.id, 100, 100);
  // d hit this boss, but before this fight (logged before active_since): not counted.
  await db.query(
    "insert into public.boss_log (boss_id, event_type, amount, child_id, created_at) values ($1, 'damage', 5, $2, now() - interval '1 day')",
    [boss.id, d],
  );
  // c: a Night Raid only (its boss_log row, as the nightly reset writes it).
  await db.query("insert into public.boss_log (boss_id, event_type, amount, child_id) values ($1, 'night_raid', 1, $2)", [boss.id, c]);
  await db.query("update public.bosses set current_hp = current_hp - 1 where id = $1", [boss.id]);
  // b: a tiny share (2 of 100 → 0 of 25 gold); a: the final blow.
  await tick(b, await quest(familyId, b, TODAY, 2));
  await tick(a, await quest(familyId, a, TODAY, 97));

  assert.equal((await db.query("select status from public.bosses where id = $1", [boss.id])).rows[0].status, "defeated");
  const gold = (await db.query("select child_id from public.boss_log where boss_id = $1 and event_type = 'gold_awarded'", [boss.id])).rows.map((r) => r.child_id);
  assert.deepEqual(gold, [a], "only a gets gold");
  assert.deepEqual(
    [(await totals(a)).bosses, (await totals(b)).bosses, (await totals(c)).bosses, (await totals(d)).bosses],
    [1, 1, 1, 0],
  );
});

test("a boss beaten by the nightly safety net counts too; a family member who never hit it doesn't", async () => {
  const { familyId, childIds: [a, b] } = await makeFamily(db, { children: 2 });
  const boss = await activeBoss(db, familyId);
  await db.query("insert into public.boss_log (boss_id, event_type, amount, child_id) values ($1, 'damage', 60, $2)", [boss.id, a]);
  await db.query("update public.bosses set current_hp = 0 where id = $1", [boss.id]);
  await reset(familyId, addDays(D, 1));
  assert.deepEqual([(await totals(a)).bosses, (await totals(b)).bosses], [1, 0]);
});

// --- Engine-only: nobody else writes them ------------------------------------------------------

test("a parent's direct UPDATE of the totals through the API is rejected (other columns still writable)", async () => {
  const { parentId, childIds: [kid] } = await makeFamily(db);
  await evaluatedTo(kid, addDays(D, -1));
  for (const col of ["total_damage_dealt", "total_quests_completed", "total_bosses_defeated"]) {
    assert.match(
      (await tryAsUser(db, parentId, `update public.player_stats set ${col} = 999 where child_id = $1`, [kid])) ?? "",
      /player_stats_totals_engine_only/,
      col,
    );
  }
  assert.equal(
    await tryAsUser(db, parentId, "update public.player_stats set total_damage_dealt = 0, total_quests_completed = 0, total_bosses_defeated = 0 where child_id = $1", [kid]),
    null,
    "writing the same values (no change) is fine",
  );
  // Existing parent rights on the other columns are unchanged.
  assert.equal(await tryAsUser(db, parentId, "update public.player_stats set gold = 7 where child_id = $1", [kid]), null);
  assert.deepEqual(await totals(kid), { damage: 0, quests: 0, bosses: 0 });
});

test("a parent can't insert a row with totals, delete the row, or call the bump through the API", async () => {
  const { parentId, childIds: [kid] } = await makeFamily(db);
  assert.match(
    (await tryAsUser(db, parentId, "insert into public.player_stats (child_id, total_quests_completed) values ($1, 50)", [kid])) ?? "",
    /player_stats_totals_engine_only/,
  );
  await evaluatedTo(kid, addDays(D, -1));
  assert.match((await tryAsUser(db, parentId, "delete from public.player_stats where child_id = $1", [kid])) ?? "", /permission denied/);
  assert.match(
    (await tryAsUser(db, parentId, "select public.bump_player_totals($1, 100, 100, 100)", [kid])) ?? "",
    /permission denied/,
  );
  assert.deepEqual(await totals(kid), { damage: 0, quests: 0, bosses: 0 });
});

test("the child can't write them either (no write policy: the update touches nothing)", async () => {
  const { childIds: [kid] } = await makeFamily(db);
  await evaluatedTo(kid, addDays(D, -1));
  await tryAsUser(db, kid, "update public.player_stats set total_bosses_defeated = 12 where child_id = $1", [kid]);
  assert.match((await tryAsUser(db, kid, "select public.bump_player_totals($1, 1, 1, 1)", [kid])) ?? "", /permission denied/);
  assert.deepEqual(await totals(kid), { damage: 0, quests: 0, bosses: 0 });
});

test("even plain SQL can't write them without the engine flag", async () => {
  const { childIds: [kid] } = await makeFamily(db);
  await evaluatedTo(kid, addDays(D, -1));
  await assert.rejects(
    db.query("update public.player_stats set total_damage_dealt = 5 where child_id = $1", [kid]),
    /player_stats_totals_engine_only/,
  );
});

test("the engine can still write them: bump_player_totals adds (creating the row if needed), and never takes away", async () => {
  const { childIds: [kid, other] } = await makeFamily(db, { children: 2 });
  await db.query("select public.bump_player_totals($1, 30, 2, 1)", [kid]);
  await db.query("select public.bump_player_totals($1, 5, 1, 0)", [kid]);
  assert.deepEqual(await totals(kid), { damage: 35, quests: 3, bosses: 1 });
  await db.query("select public.bump_player_totals($1, 4, 0, 0)", [other]); // no row yet
  assert.deepEqual(await totals(other), { damage: 4, quests: 0, bosses: 0 });
  await assert.rejects(db.query("select public.bump_player_totals($1, -1, 0, 0)", [kid]), /must be >= 0/);
  // The flag is only 'on' inside the bump: a later plain write is refused again.
  await assert.rejects(
    db.query("update public.player_stats set total_quests_completed = 0 where child_id = $1", [kid]),
    /player_stats_totals_engine_only/,
  );
  // Even with the flag on, a decrease is refused.
  await assert.rejects(
    db.exec(`begin; select set_config('app.engine_stats_write', 'on', true);
             update public.player_stats set total_quests_completed = 0 where child_id = '${kid}'; commit;`),
    /never_decrease/,
  );
  await db.exec("rollback");
  assert.deepEqual(await totals(kid), { damage: 35, quests: 3, bosses: 1 });
});

test("the reset script's escape ('reset' for its own transaction) zeroes them", async () => {
  const { childIds: [kid] } = await makeFamily(db);
  await db.query("select public.bump_player_totals($1, 9, 9, 9)", [kid]);
  await db.exec(`begin; select set_config('app.engine_stats_write', 'reset', true);
                 update public.player_stats set total_damage_dealt = 0, total_quests_completed = 0, total_bosses_defeated = 0
                  where child_id = '${kid}'; commit;`);
  assert.deepEqual(await totals(kid), { damage: 0, quests: 0, bosses: 0 });
  // …and only for that transaction.
  await assert.rejects(
    db.query("update public.player_stats set total_damage_dealt = 1 where child_id = $1", [kid]),
    /player_stats_totals_engine_only/,
  );
});
