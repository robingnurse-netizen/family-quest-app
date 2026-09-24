// "While you were away" recaps, the evening warning's stakes, potions and
// perfect-day heals (supabase/migrations/20260926000012_recap_evening_healing.sql).
import { test, before } from "node:test";
import assert from "node:assert/strict";
import {
  freshDb,
  asUser,
  tryAsUser,
  makeFamily,
  makePool,
  makeSlot,
  stats,
  activeBoss,
  addDays,
  londonToday,
} from "./helpers/db.mjs";

let db;
before(async () => {
  db = await freshDb();
});

const reset = (familyId, today) => db.query("select public.run_daily_reset($1, $2) as r", [familyId, today]);
const party = async (familyId) =>
  (await db.query("select current_hp, max_hp from public.party_health where family_id = $1", [familyId])).rows[0];
const setParty = (familyId, hp) =>
  db.query(
    "insert into public.party_health (family_id, current_hp) values ($1, $2) on conflict (family_id) do update set current_hp = excluded.current_hp",
    [familyId, hp],
  );
const setGold = (childId, gold) =>
  db.query(
    "insert into public.player_stats (child_id, gold) values ($1, $2) on conflict (child_id) do update set gold = excluded.gold",
    [childId, gold],
  );
const recaps = async (childId) =>
  (
    await db.query(
      "select *, to_char(day_from, 'YYYY-MM-DD') as day_from, to_char(day_to, 'YYYY-MM-DD') as day_to from public.reset_recaps where child_id = $1 order by created_at, id",
      [childId],
    )
  ).rows;
const unseen = async (childId) => (await recaps(childId)).filter((r) => r.seen_at === null);
const healLog = async (familyId) =>
  (
    await db.query(
      "select event_type, amount, hp_after, potion_id, gold_spent, child_id, to_char(day, 'YYYY-MM-DD') as day from public.party_log where family_id = $1 order by created_at, day",
      [familyId],
    )
  ).rows;

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

test("a reset with misses records his recap: quests, minutes, damage, the boss, HP", async () => {
  const { familyId, kid, day } = await world();
  const boss = await activeBoss(db, familyId);
  await day(0, { done: 1, open: 2, minutes: 15 }); // 2 missed, 30 min
  await reset(familyId, addDays(D, 1));

  const [r] = await recaps(kid);
  assert.equal(r.missed_quests, 2);
  assert.equal(r.missed_minutes, 30);
  assert.equal(r.party_damage, 30);
  assert.equal(r.boss_id, boss.id);
  assert.deepEqual([r.hp_before, r.hp_after, r.max_hp], [100, 70, 100]);
  assert.deepEqual([r.day_from, r.day_to], [D, D]);
  assert.equal(r.knocked_out, false);
  assert.equal(r.seen_at, null);
});

test("streak lost: the recap keeps the streak before and after", async () => {
  const { familyId, kid, day } = await world();
  await day(0, { done: 1 });
  await day(1, { done: 1 });
  await reset(familyId, addDays(D, 2)); // streak 2
  await day(2, { open: 1 });
  await reset(familyId, addDays(D, 3));
  const last = (await recaps(kid)).at(-1);
  assert.equal(last.streak_before, 2);
  assert.equal(last.streak_after, 0);
});

test("knocked out: the recap records the knock-out, who escaped and who came next", async () => {
  const { familyId, kid, day } = await world();
  const escaped = await activeBoss(db, familyId);
  await setParty(familyId, 20);
  await day(0, { open: 2, minutes: 15 }); // 30 damage > 20 HP
  await reset(familyId, addDays(D, 1));

  const next = await activeBoss(db, familyId);
  const [r] = await recaps(kid);
  assert.equal(r.knocked_out, true);
  assert.equal(r.escaped_boss_id, escaped.id);
  assert.equal(r.next_boss_id, next.id);
  assert.notEqual(next.id, escaped.id);
  assert.deepEqual([r.hp_before, r.hp_after], [20, 100], "refilled after the knock-out");
});

test("no boss: misses are recorded with no damage and no boss", async () => {
  const { familyId, kid, day } = await world();
  await db.query("update public.bosses set status = 'defeated' where family_id = $1", [familyId]);
  await day(0, { open: 1, minutes: 20 });
  await reset(familyId, addDays(D, 1));

  const [r] = await recaps(kid);
  assert.equal(r.missed_quests, 1);
  assert.equal(r.missed_minutes, 20);
  assert.equal(r.party_damage, 0);
  assert.equal(r.boss_id, null);
  assert.equal((await party(familyId)).current_hp, 100);
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

// --- Evening stakes -------------------------------------------------------------------------

test("tonight's stakes: open quests up to today (family time) × the miss penalty", async () => {
  const f = await makeFamily(db);
  const kid = f.childIds[0];
  const today = await londonToday(db);
  const pool = await makePool(db, { familyId: f.familyId, childId: kid, day: today, minutes: 3000 });
  await makeSlot(db, { poolId: pool, day: today, minutes: 30 });
  await makeSlot(db, { poolId: pool, day: today, minutes: 15 });
  const done = await makeSlot(db, { poolId: pool, day: today, minutes: 60 });
  await db.query("update public.task_slots set status = 'completed' where id = $1", [done]);
  await makeSlot(db, { poolId: pool, day: addDays(today, 1), minutes: 60 }); // tomorrow: not tonight

  const stakes = async () => (await asUser(db, kid, "select public.tonight_stakes() as s")).rows[0].s;
  let s = await stakes();
  assert.equal(s.today, today);
  assert.equal(s.boss_active, true);
  assert.equal(s.my_open_quests, 2);
  assert.equal(s.open_minutes, 45);
  assert.equal(s.damage, 45);

  // What the reset would actually deal: run it for tomorrow and compare.
  const { rows } = await db.query("select public.run_daily_reset($1, $2) as r", [f.familyId, addDays(today, 1)]);
  assert.equal(rows[0].r.party_damage, 45);

  // No boss: the reset deals nothing, so neither do the stakes.
  await makeSlot(db, { poolId: pool, day: addDays(today, 1), minutes: 10 });
  await db.query("update public.bosses set status = 'defeated' where family_id = $1", [f.familyId]);
  s = await stakes();
  assert.equal(s.boss_active, false);
  assert.equal(s.damage, 0);
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

// --- Potions ---------------------------------------------------------------------------------

const buy = (uid, potion) => asUser(db, uid, "select public.buy_potion($1) as r", [potion]).then((x) => x.rows[0].r);
const tryBuy = (uid, potion) => tryAsUser(db, uid, "select public.buy_potion($1)", [potion]);

test("a potion is priced from the database, heals at once and is logged", async () => {
  const { familyId, childIds: [kid] } = await makeFamily(db);
  await setGold(kid, 200);
  await setParty(familyId, 40);

  const r = await buy(kid, "small");
  assert.deepEqual([r.healed, r.hp, r.gold, r.gold_spent], [20, 60, 170, 30]);

  // Retune the price in the table: the next purchase pays that.
  await db.query("update public.potions set gold_cost = 45 where id = 'small'");
  const r2 = await buy(kid, "small");
  assert.equal(r2.gold_spent, 45);
  assert.equal((await stats(db, kid)).gold, 125);
  await db.query("update public.potions set gold_cost = 30 where id = 'small'");

  const log = await healLog(familyId);
  assert.deepEqual(
    log.map((l) => [l.event_type, l.potion_id, l.amount, l.gold_spent, l.child_id]),
    [["potion", "small", 20, 30, kid], ["potion", "small", 20, 45, kid]],
  );
});

test("no buying at full HP, and no overhealing", async () => {
  const { familyId, childIds: [kid] } = await makeFamily(db);
  await setGold(kid, 200);
  assert.match(await tryBuy(kid, "small"), /potion_party_full/);
  assert.equal((await stats(db, kid)).gold, 200, "no gold taken");

  await setParty(familyId, 90);
  const r = await buy(kid, "large"); // heals 50, only 10 fits
  assert.deepEqual([r.healed, r.hp, r.max_hp], [10, 100, 100]);
  assert.equal((await party(familyId)).current_hp, 100);
  assert.equal((await healLog(familyId)).at(-1).amount, 10);
});

test("no spending beyond the balance, even back to back", async () => {
  const { familyId, childIds: [kid] } = await makeFamily(db);
  await setGold(kid, 100);
  await setParty(familyId, 10);

  // Back-to-back requests: each re-checks the balance the last one left.
  // (True concurrency — row locks on party_health, then player_stats —
  // can't be exercised in single-connection PGlite.)
  const results = [];
  for (let i = 0; i < 3; i++) results.push(await tryBuy(kid, "large"));
  assert.equal(results[0], null);
  assert.match(results[1], /potion_insufficient_gold/);
  assert.match(results[2], /potion_insufficient_gold/);
  assert.equal((await stats(db, kid)).gold, 30);
  assert.equal((await party(familyId)).current_hp, 60, "only the paid-for potion healed");
  assert.equal((await healLog(familyId)).length, 1);
});

test("only a player spends, and only his own gold", async () => {
  const { familyId, parentId, childIds: [kid, sister] } = await makeFamily(db, { children: 2 });
  await setParty(familyId, 10);
  await setGold(kid, 0);
  await setGold(sister, 500);

  assert.match(await tryBuy(kid, "small"), /potion_insufficient_gold/, "his sister's gold isn't his");
  assert.equal((await stats(db, sister)).gold, 500);
  assert.match(await tryBuy(parentId, "small"), /potion_not_a_player/);
  assert.match(await tryBuy(sister, "elixir"), /potion_unavailable/);

  // The catalogue and the log are read-only through the API.
  await asUser(db, sister, "update public.potions set gold_cost = 0");
  assert.equal((await db.query("select gold_cost from public.potions where id = 'small'")).rows[0].gold_cost, 30);
  assert.match(
    await tryAsUser(
      db, sister,
      "insert into public.party_log (family_id, child_id, event_type, amount, hp_after) values ($1, $2, 'potion', 50, 60)",
      [familyId, sister],
    ),
    /row-level security/,
  );

  // Anonymous callers can't buy.
  await db.exec("set role anon");
  try {
    await assert.rejects(db.query("select public.buy_potion('small')"), /permission denied/);
  } finally {
    await db.exec("reset role");
  }
});

test("parents see the family's potion log; other families don't", async () => {
  const a = await makeFamily(db);
  const b = await makeFamily(db);
  await setGold(a.childIds[0], 100);
  await setParty(a.familyId, 50);
  await buy(a.childIds[0], "small");
  const count = async (uid) =>
    (await asUser(db, uid, "select count(*)::int as n from public.party_log where family_id = $1", [a.familyId])).rows[0].n;
  assert.equal(await count(a.parentId), 1);
  assert.equal(await count(b.parentId), 0);
});

// --- Perfect-day heals ------------------------------------------------------------------------

test("a perfect day heals the party (after that night's penalties)", async () => {
  const { familyId, kid, day } = await world();
  await setParty(familyId, 50);
  await day(0, { done: 2 });
  await reset(familyId, addDays(D, 1));
  assert.equal((await party(familyId)).current_hp, 60);
  const [log] = await healLog(familyId);
  assert.deepEqual([log.event_type, log.amount, log.hp_after, log.day, log.child_id], ["perfect_day", 10, 60, D, kid]);
  assert.deepEqual(
    (await recaps(kid)).map((r) => [r.perfect_days, r.healed, r.hp_after]),
    [[1, 10, 60]],
  );
});

test("perfect-day heals are capped at max HP", async () => {
  const { familyId, day } = await world();
  await setParty(familyId, 95);
  await day(0, { done: 1 });
  await reset(familyId, addDays(D, 1));
  assert.equal((await party(familyId)).current_hp, 100);
  assert.equal((await healLog(familyId))[0].amount, 5);

  // Already full: nothing healed, nothing logged.
  await day(1, { done: 1 });
  await reset(familyId, addDays(D, 2));
  assert.equal((await party(familyId)).current_hp, 100);
  assert.equal((await healLog(familyId)).length, 1);
});

test("perfect-day heals are idempotent", async () => {
  const { familyId, day } = await world();
  await setParty(familyId, 50);
  await day(0, { done: 1 });
  for (let i = 0; i < 3; i++) await reset(familyId, addDays(D, 1));
  assert.equal((await party(familyId)).current_hp, 60);
  assert.equal((await healLog(familyId)).length, 1);
});

test("missed nights catch up: one heal per perfect day, in order, none for a missed day", async () => {
  const { familyId, kid, day } = await world();
  await setParty(familyId, 40);
  await day(0, { done: 1 }); // perfect
  await day(1, { done: 1, open: 1, minutes: 5 }); // a miss: no heal, 5 damage
  await day(2, { done: 2 }); // perfect
  // D+3: rest day
  await day(4, { done: 1 }); // perfect
  await reset(familyId, addDays(D, 5)); // one reset after five nights

  // 40 − 5 (penalty first) + 3 × 10.
  assert.equal((await party(familyId)).current_hp, 65);
  assert.deepEqual((await healLog(familyId)).map((l) => l.day), [D, addDays(D, 2), addDays(D, 4)]);
  const [r] = await recaps(kid);
  assert.deepEqual([r.perfect_days, r.healed, r.missed_quests, r.party_damage], [3, 30, 1, 5]);
  assert.deepEqual([r.day_from, r.day_to], [D, addDays(D, 4)]);
});

test("after a knock-out and refill, a perfect day's heal is capped (party already full)", async () => {
  const { familyId, childIds: [kid, sister], day } = await world({ children: 2 });
  await setParty(familyId, 10);
  await day(0, { open: 1, minutes: 30, child: kid }); // knocks the party out
  await day(0, { done: 1, child: sister }); // her perfect day
  await reset(familyId, addDays(D, 1));
  assert.equal((await party(familyId)).current_hp, 100);
  assert.equal((await healLog(familyId)).length, 0);
  const sisterRecap = (await recaps(sister))[0];
  assert.deepEqual([sisterRecap.perfect_days, sisterRecap.healed, sisterRecap.knocked_out], [1, 0, true]);
});
