// Streak recovery (supabase/migrations/20260928000014_streak_recovery.sql):
// a missed day cracks the streak (frozen) and opens a rescue; he picks one of
// up to 5 offered jobs and ticks it done (boss damage + XP); the nightly
// reset repairs it (back to exactly its frozen value) or, past due, halves
// it (rounded up, never 0). Recaps record every crack / rescue / halving.
//
// pick_rescue_job / complete_rescue check "past due" against the real clock
// (the family's today), so these days are relative to today, not far-future.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { freshDb, asUser, tryAsUser, makeFamily, makePool, makeSlot, activeBoss, londonToday, addDays } from "./helpers/db.mjs";

let db;
/** The family's today (Europe/London), as the database sees it. */
let TODAY;
before(async () => {
  db = await freshDb();
  TODAY = await londonToday(db);
});

const reset = (familyId, today) => db.query("select public.run_daily_reset($1, $2) as r", [familyId, today]);
const streak = async (kid) =>
  (await db.query("select current_streak, best_streak from public.player_stats where child_id = $1", [kid])).rows[0];
const rescues = async (kid) =>
  (
    await db.query(
      "select *, to_char(missed_day, 'YYYY-MM-DD') as missed_day, to_char(due_on, 'YYYY-MM-DD') as due_on from public.streak_rescues where child_id = $1 order by created_at",
      [kid],
    )
  ).rows;
const recapEvents = async (kid) =>
  (await db.query("select rescue_events from public.reset_recaps where child_id = $1 order by created_at, id", [kid])).rows.flatMap(
    (r) => r.rescue_events,
  );

/**
 * A family whose child has a `streak` going into day `first` (evaluated up
 * to the day before), `jobs` rescue jobs, and a pool covering the days used.
 */
async function world({ streak: n = 6, jobs = 3, first } = {}) {
  first ??= addDays(TODAY, -1);
  const f = await makeFamily(db);
  const kid = f.childIds[0];
  const pools = {};
  const poolFor = async (d) => {
    const week = (await db.query("select ($1::date - (extract(isodow from $1::date)::int - 1))::text as w", [d])).rows[0].w;
    pools[week] ??= await makePool(db, { familyId: f.familyId, childId: kid, day: d, minutes: 2000 });
    return pools[week];
  };
  await db.query(
    "insert into public.player_stats (child_id, current_streak, best_streak, streak_through) values ($1, $2, $2, $3) on conflict (child_id) do update set current_streak = excluded.current_streak, best_streak = excluded.best_streak, streak_through = excluded.streak_through",
    [kid, n, addDays(first, -1)],
  );
  for (let i = 0; i < jobs; i++) {
    await db.query("insert into public.rescue_jobs (family_id, title, minutes) values ($1, $2, 10)", [f.familyId, `Job ${i + 1}`]);
  }
  /** Quests on day d: `done` completed, `open` left (missed at the reset). */
  const day = async (d, { done = 0, open = 0 } = {}) => {
    const pool = await poolFor(d);
    for (let i = 0; i < done; i++) {
      const id = await makeSlot(db, { poolId: pool, day: d, minutes: 10 });
      await db.query("update public.task_slots set status = 'completed' where id = $1", [id]);
    }
    for (let i = 0; i < open; i++) await makeSlot(db, { poolId: pool, day: d, minutes: 10 });
  };
  return { ...f, kid, day };
}

/** Miss yesterday and run today's reset: the crack. */
async function cracked(opts) {
  const w = await world(opts);
  await w.day(addDays(TODAY, -1), { done: 1, open: 1 });
  await reset(w.familyId, TODAY);
  const [r] = await rescues(w.kid);
  return { ...w, rescue: r };
}

const pick = (kid, rescueId, jobId) =>
  asUser(db, kid, "select * from public.pick_rescue_job($1, $2)", [rescueId, jobId]);
const complete = (kid, rescueId) => asUser(db, kid, "select public.complete_rescue($1) as r", [rescueId]);

// --- Crack --------------------------------------------------------------------------

test("a miss cracks the streak: frozen at its value, rescue open, due missed day + 2, 3 of 3 jobs offered", async () => {
  const { kid, rescue } = await cracked({ streak: 6, jobs: 3 });
  assert.deepEqual(await streak(kid), { current_streak: 6, best_streak: 6 });
  assert.equal(rescue.status, "open");
  assert.equal(rescue.streak_at_crack, 6);
  assert.equal(rescue.missed_day, addDays(TODAY, -1));
  assert.equal(rescue.due_on, addDays(TODAY, 1));
  assert.equal(rescue.fallback, false);
  assert.equal(rescue.offered.length, 3);
  assert.equal(rescue.job_id, null, "he picks; the server doesn't");
  const [ev] = await recapEvents(kid);
  assert.deepEqual([ev.event, ev.streak_at_crack, ev.due_on, ev.offered_count], ["cracked", 6, addDays(TODAY, 1), 3]);
});

test("the offer is at most 5 jobs, drawn from active jobs only", async () => {
  const w = await world({ jobs: 8 });
  await db.query("update public.rescue_jobs set active = false where family_id = $1 and title in ('Job 1', 'Job 2')", [w.familyId]);
  await w.day(addDays(TODAY, -1), { open: 1 });
  await reset(w.familyId, TODAY);
  const [r] = await rescues(w.kid);
  assert.equal(r.offered.length, 5);
  assert.ok(r.offered.every((j) => !["Job 1", "Job 2"].includes(j.title)));
  assert.equal(new Set(r.offered.map((j) => j.job_id)).size, 5, "no repeats");
});

test("a miss at streak 0 changes nothing: no rescue", async () => {
  const w = await world({ streak: 0 });
  await w.day(addDays(TODAY, -1), { open: 1 });
  await reset(w.familyId, TODAY);
  assert.equal((await streak(w.kid)).current_streak, 0);
  assert.equal((await rescues(w.kid)).length, 0);
});

// --- Rescued ----------------------------------------------------------------------

test("pick + complete: boss damage and XP now; the next reset repairs to exactly the frozen value", async () => {
  const { familyId, kid, rescue, day } = await cracked({ streak: 6 });
  const bossBefore = await activeBoss(db, familyId);
  const xpBefore = (await db.query("select xp from public.player_stats where child_id = $1", [kid])).rows[0].xp;
  await pick(kid, rescue.id, rescue.offered[1].job_id);
  const { rows } = await complete(kid, rescue.id);
  assert.equal(rows[0].r.boss_hit, true);
  assert.equal((await activeBoss(db, familyId)).current_hp, bossBefore.current_hp - 10, "normal boss damage");
  assert.equal((await db.query("select xp from public.player_stats where child_id = $1", [kid])).rows[0].xp, xpBefore + 10);
  // (The crack setup also completed a quest on the missed day: take the newest damage row.)
  const [log] = (await db.query("select * from public.boss_log where boss_id = $1 and event_type = 'damage' and child_id = $2 order by created_at desc limit 1", [bossBefore.id, kid])).rows;
  assert.equal(log.source_task_slot_id, null, "a rescue, not a quest slot");

  // Today (frozen) is a perfect day: no credit on repair.
  await day(TODAY, { done: 1 });
  await reset(familyId, addDays(TODAY, 1));
  assert.equal((await streak(kid)).current_streak, 6, "back to exactly 6, not 7");
  const [r] = await rescues(kid);
  assert.deepEqual([r.status, r.streak_after], ["rescued", 6]);
  const evs = await recapEvents(kid);
  assert.deepEqual(evs.map((e) => e.event), ["cracked", "rescued"]);
  assert.equal(evs[1].job_title, rescue.offered[1].title);
});

test("after the repair the streak grows again from its frozen value", async () => {
  const { familyId, kid, rescue, day } = await cracked({ streak: 6 });
  await pick(kid, rescue.id, rescue.offered[0].job_id);
  await complete(kid, rescue.id);
  await reset(familyId, addDays(TODAY, 1)); // rescued (today had no quests)
  await day(addDays(TODAY, 1), { done: 1 });
  await reset(familyId, addDays(TODAY, 2));
  assert.equal((await streak(kid)).current_streak, 7);
});

// --- Halved --------------------------------------------------------------------------

test("not done by due_on: the reset after it halves the streak, rounded up (7 → 4)", async () => {
  const { familyId, kid } = await cracked({ streak: 7 });
  await reset(familyId, addDays(TODAY, 1)); // still inside the window: open
  assert.equal((await rescues(kid))[0].status, "open");
  await reset(familyId, addDays(TODAY, 2)); // due today+1 has passed
  assert.equal((await streak(kid)).current_streak, 4);
  assert.equal((await streak(kid)).best_streak, 7, "best is never lowered");
  const [r] = await rescues(kid);
  assert.deepEqual([r.status, r.streak_after], ["lapsed", 4]);
  assert.deepEqual((await recapEvents(kid)).map((e) => [e.event, e.streak_after]), [["cracked", 7], ["halved", 4]]);
});

test("halving never reaches 0: a crack at 1 lapses to 1", async () => {
  const { familyId, kid } = await cracked({ streak: 1 });
  await reset(familyId, addDays(TODAY, 2));
  assert.equal((await streak(kid)).current_streak, 1);
});

// --- Frozen window ------------------------------------------------------------------

test("a miss during the window is absorbed: no change, no new rescue, the window isn't extended", async () => {
  const { familyId, kid, day, rescue } = await cracked({ streak: 6 });
  await day(TODAY, { open: 2 }); // missed at the next reset
  await reset(familyId, addDays(TODAY, 1));
  const rs = await rescues(kid);
  assert.equal(rs.length, 1);
  assert.equal(rs[0].due_on, rescue.due_on);
  assert.equal((await streak(kid)).current_streak, 6);
  // A miss takes nothing else away (no boss-side penalty since the rewind).
  const { rows } = await db.query("select count(*)::int as n from public.boss_log where event_type = 'miss_penalty' and child_id = $1", [kid]);
  assert.equal(rows[0].n, 0);
});

test("a perfect day while frozen still earns a Night Raid, but doesn't grow the streak", async () => {
  const { familyId, kid, day } = await cracked({ streak: 6 });
  await day(TODAY, { done: 2 });
  await reset(familyId, addDays(TODAY, 1));
  assert.equal((await streak(kid)).current_streak, 6);
  const { rows } = await db.query("select count(*)::int as n from public.boss_log where event_type = 'night_raid' and child_id = $1", [kid]);
  assert.equal(rows[0].n, 1, "the raid (tests/night-raid.test.mjs has its rules)");
});

// --- Empty pool fallback ------------------------------------------------------------------

test("empty pool: the fallback is due the day after the miss; any quest done that day rescues", async () => {
  const { familyId, kid, day, rescue } = await cracked({ streak: 5, jobs: 0 });
  assert.deepEqual([rescue.fallback, rescue.offered.length, rescue.due_on], [true, 0, TODAY]);
  await day(TODAY, { done: 1, open: 1 }); // one quest done today (another missed: absorbed)
  await reset(familyId, addDays(TODAY, 1));
  assert.equal((await rescues(kid))[0].status, "rescued");
  assert.equal((await streak(kid)).current_streak, 5);
});

test("empty pool, no quest done the next day: halved", async () => {
  const { familyId, kid, day } = await cracked({ streak: 5, jobs: 0 });
  await day(TODAY, { open: 1 });
  await reset(familyId, addDays(TODAY, 1));
  assert.equal((await rescues(kid))[0].status, "lapsed");
  assert.equal((await streak(kid)).current_streak, 3);
});

// --- Catch-up and idempotency ----------------------------------------------------------

test("idempotent: re-running a night's reset changes nothing and records nothing new", async () => {
  const { familyId, kid } = await cracked({ streak: 6 });
  const before = { s: await streak(kid), r: await rescues(kid), e: await recapEvents(kid) };
  await reset(familyId, TODAY);
  assert.deepEqual({ s: await streak(kid), r: await rescues(kid), e: await recapEvents(kid) }, before);
});

test("catch-up over missed nights: crack, then lapse, in one reset", async () => {
  const w = await world({ streak: 4, first: addDays(TODAY, -5) });
  await w.day(addDays(TODAY, -5), { open: 1 }); // crack at 4, due -3
  await w.day(addDays(TODAY, -4), { done: 1 }); // frozen
  await w.day(addDays(TODAY, -2), { done: 1 }); // lapsed (→ 2) first, then +1
  await reset(w.familyId, TODAY);
  assert.equal((await streak(w.kid)).current_streak, 3);
  assert.deepEqual((await recapEvents(w.kid)).map((e) => e.event), ["cracked", "halved"]);
});

// --- Access -------------------------------------------------------------------------

test("only the child picks, from the offer, and only his own rescue", async () => {
  const { kid, rescue } = await cracked();
  const other = await cracked();
  assert.match(await tryAsUser(db, kid, "select public.pick_rescue_job($1, $2)", [rescue.id, "00000000-0000-4000-8000-00000000ffff"]), /rescue_not_offered/);
  assert.match(await tryAsUser(db, other.kid, "select public.pick_rescue_job($1, $2)", [rescue.id, rescue.offered[0].job_id]), /rescue_not_found/);
  assert.match(await tryAsUser(db, other.kid, "select public.complete_rescue($1)", [rescue.id]), /rescue_not_found/);
});

test("complete: needs a pick, only once, and not past due", async () => {
  const { kid, rescue } = await cracked();
  assert.match(await tryAsUser(db, kid, "select public.complete_rescue($1)", [rescue.id]), /rescue_not_picked/);
  await pick(kid, rescue.id, rescue.offered[0].job_id);
  await complete(kid, rescue.id);
  assert.match(await tryAsUser(db, kid, "select public.complete_rescue($1)", [rescue.id]), /rescue_closed/);
  assert.match(await tryAsUser(db, kid, "select public.pick_rescue_job($1, $2)", [rescue.id, rescue.offered[1].job_id]), /rescue_closed/);

  // A rescue whose window closed before today (a crack 5 days ago).
  const late = await world({ first: addDays(TODAY, -5) });
  await late.day(addDays(TODAY, -5), { open: 1 });
  await reset(late.familyId, addDays(TODAY, -4));
  const [r] = await rescues(late.kid);
  assert.match(await tryAsUser(db, late.kid, "select public.pick_rescue_job($1, $2)", [r.id, r.offered[0].job_id]), /rescue_overdue/);
});

test("the fallback can't be 'completed' directly", async () => {
  const { kid, rescue } = await cracked({ jobs: 0 });
  assert.match(await tryAsUser(db, kid, "select public.complete_rescue($1)", [rescue.id]), /rescue_fallback/);
});

test("rescue tables: read own (child) / family (parent), no direct writes through the API", async () => {
  const { familyId, parentId, kid, rescue } = await cracked();
  const other = await cracked();
  const see = async (uid) => (await asUser(db, uid, "select id from public.streak_rescues")).rows.map((r) => r.id);
  assert.deepEqual(await see(kid), [rescue.id]);
  assert.deepEqual(await see(parentId), [rescue.id]);
  assert.ok(!(await see(other.kid)).includes(rescue.id));
  assert.ok(await tryAsUser(db, kid, "update public.streak_rescues set status = 'rescued' where id = $1", [rescue.id]) === null);
  assert.equal((await rescues(kid))[0].status, "open", "RLS: the update touched nothing");
  // Parents manage the job pool; children only read it.
  assert.equal(await tryAsUser(db, parentId, "insert into public.rescue_jobs (family_id, title) values ($1, 'Tidy shoes')", [familyId]), null);
  assert.match(await tryAsUser(db, kid, "insert into public.rescue_jobs (family_id, title) values ($1, 'Nothing')", [familyId]), /row-level security/);
  assert.match(await tryAsUser(db, kid, "select public.strike_active_boss($1, $2, 99, null, current_date)", [familyId, kid]), /permission denied/);
});

test("tonight's stakes report an open rescue (a frozen streak isn't at stake)", async () => {
  const { kid } = await cracked();
  const { rows } = await asUser(db, kid, "select public.tonight_stakes() as s");
  assert.equal(rows[0].s.rescue_open, true);
});
