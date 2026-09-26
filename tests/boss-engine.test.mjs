// The boss engine: roster + activation (…06), instant damage and
// finish_boss (…08, …11), the nightly reset's misses / escape / refill, and
// retreat + return (…15).
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { importTs } from "./helpers/load-ts.mjs";
import {
  freshDb, as, tryAsUser, makeFamily, makePool, makeSlot, stats, slot, activeBoss, londonToday, addDays, mondayOf, setBossHp,
} from "./helpers/db.mjs";

const retreat = await importTs(fileURLToPath(new URL("../lib/rpg/retreat.ts", import.meta.url)));

let db;
before(async () => {
  db = await freshDb();
});

const tick = (uid, id) => as(db, uid, "update public.task_slots set status = 'completed' where id = $1", [id]);
const reset = async (familyId, today) =>
  (await db.query("select public.run_daily_reset($1, $2) as r", [familyId, today])).rows[0].r;
const finish = (bossId, outcome, today) =>
  db.query("select public.finish_boss($1, $2, $3) as r", [bossId, outcome, today]);

async function bossById(id) {
  const { rows } = await db.query("select * from public.bosses where id = $1", [id]);
  return rows[0];
}
async function party(familyId) {
  const { rows } = await db.query("select current_hp, max_hp from public.party_health where family_id = $1", [familyId]);
  return rows[0];
}
async function log(bossId, eventType) {
  const { rows } = await db.query(
    "select amount, child_id, source_task_slot_id from public.boss_log where boss_id = $1 and event_type = $2 order by created_at, id",
    [bossId, eventType],
  );
  return rows;
}
/** A child's quest on `day`, in its own pool. */
async function quest(familyId, childId, day, minutes) {
  const pool = await makePool(db, { familyId, childId, day, minutes: Math.max(minutes, 600) });
  return makeSlot(db, { poolId: pool, day, minutes });
}

// --- Roster & activation ------------------------------------------------------

test("a new family gets the 12-boss roster, with Trash-Bag Slime active at full HP", async () => {
  const { familyId } = await makeFamily(db);
  const { rows } = await db.query(
    "select name, tier, status from public.bosses where family_id = $1 order by case tier when 'low' then 1 when 'mid' then 2 else 3 end, queue_position",
    [familyId],
  );
  assert.equal(rows.length, 12);
  assert.deepEqual(rows.map((r) => r.tier), [
    "low", "low", "low", "low", "mid", "mid", "mid", "mid", "epic", "epic", "epic", "epic",
  ]);
  assert.deepEqual(rows.filter((r) => r.status === "active").map((r) => r.name), ["Trash-Bag Slime"]);

  const boss = await activeBoss(db, familyId);
  assert.equal(boss.current_hp, boss.max_hp);
  const today = await londonToday(db);
  assert.equal(boss.week_start_date.toISOString().slice(0, 10), mondayOf(today));
  assert.equal((await log(boss.id, "activated")).length, 1);
});

test("bosses activate low tier first, in queue order, then mid, then epic; then none", async () => {
  const { familyId } = await makeFamily(db);
  const today = await londonToday(db);
  const order = [];
  // All wins: an escape now sends the boss to the return line (…15), so the
  // roster only runs out once every boss is beaten.
  for (let i = 0; i < 12; i++) {
    const boss = await activeBoss(db, familyId);
    order.push(boss.name);
    await finish(boss.id, "defeated", today);
  }
  assert.deepEqual(order, [
    "Trash-Bag Slime", "Alarm Clock Swarm", "Laundry Goblin", "Cable Spider",
    "Swamp-Bag Ooze", "Tupperware Troll", "Scatter-Brick Serpent", "Mud-Track Minotaur",
    "Magma Behemoth", "Chronosphinx", "Abyssal Kraken", "Shogun-Bot",
  ]);
  assert.equal(await activeBoss(db, familyId), null);
  const { rows } = await db.query("select public.activate_next_boss($1, $2) as id", [familyId, today]);
  assert.equal(rows[0].id, null, "nothing left to activate");
});

test("activation is a no-op while a boss is already active", async () => {
  const { familyId } = await makeFamily(db);
  const before = await activeBoss(db, familyId);
  const { rows } = await db.query("select public.activate_next_boss($1, $2) as id", [familyId, await londonToday(db)]);
  assert.equal(rows[0].id, null);
  const { rows: active } = await db.query("select id from public.bosses where family_id = $1 and status = 'active'", [familyId]);
  assert.deepEqual(active.map((r) => r.id), [before.id]);
});

test("finish_boss only finishes an active boss, once", async () => {
  const { familyId } = await makeFamily(db);
  const today = await londonToday(db);
  const boss = await activeBoss(db, familyId);
  const first = (await finish(boss.id, "defeated", today)).rows[0].r;
  assert.equal(first.finished, true);
  const again = (await finish(boss.id, "escaped", today)).rows[0].r;
  assert.equal(again.finished, false);
  assert.equal((await bossById(boss.id)).status, "defeated");
  await assert.rejects(finish((await activeBoss(db, familyId)).id, "fled", today), /invalid outcome/);
});

// --- Instant damage -----------------------------------------------------------

test("completing a quest strikes the active boss at once: 1 minute = 1 damage, logged", async () => {
  const { familyId, childIds: [kid] } = await makeFamily(db);
  const today = await londonToday(db);
  const boss = await activeBoss(db, familyId);
  const s = await quest(familyId, kid, today, 15);

  await tick(kid, s);

  assert.equal((await bossById(boss.id)).current_hp, boss.max_hp - 15);
  assert.deepEqual(await log(boss.id, "damage"), [{ amount: 15, child_id: kid, source_task_slot_id: s }]);
  const after = await slot(db, s);
  assert.equal(after.applied_to_boss, true);
  assert.ok(after.completed_at, "completed_at set");
});

test("a parent or SQL completion strikes too, credited to the pool's child", async () => {
  const { familyId, parentId, childIds: [kid] } = await makeFamily(db);
  const today = await londonToday(db);
  const boss = await activeBoss(db, familyId);
  const s1 = await quest(familyId, kid, today, 10);
  const s2 = await quest(familyId, kid, today, 5);
  await tick(parentId, s1);
  await tick(null, s2);
  assert.equal((await bossById(boss.id)).current_hp, boss.max_hp - 15);
  assert.deepEqual((await log(boss.id, "damage")).map((r) => r.child_id), [kid, kid]);
});

test("damage is dealt once: no strike for re-saving a completed slot or for other edits", async () => {
  const { familyId, childIds: [kid] } = await makeFamily(db);
  const today = await londonToday(db);
  const boss = await activeBoss(db, familyId);
  const s = await quest(familyId, kid, today, 10);
  await tick(kid, s);
  await db.query("update public.task_slots set status = 'completed', sort_order = 3 where id = $1", [s]);
  // Even un-ticked and re-ticked by SQL (bypassing the child guard).
  await db.query("update public.task_slots set status = 'scheduled' where id = $1", [s]);
  await db.query("update public.task_slots set status = 'completed' where id = $1", [s]);
  assert.equal((await bossById(boss.id)).current_hp, boss.max_hp - 10);
  assert.equal((await log(boss.id, "damage")).length, 1);
});

test("a quest ticked while no boss is active does no damage and stays unapplied", async () => {
  const { familyId, childIds: [kid] } = await makeFamily(db);
  await db.query("update public.bosses set status = 'defeated' where family_id = $1", [familyId]);
  const today = await londonToday(db);
  const s = await quest(familyId, kid, today, 20);
  await tick(kid, s);
  assert.equal((await slot(db, s)).applied_to_boss, false);
  const { rows } = await db.query(
    "select count(*)::int as n from public.boss_log l join public.bosses b on b.id = l.boss_id where b.family_id = $1 and l.event_type = 'damage'",
    [familyId],
  );
  assert.equal(rows[0].n, 0);
});

test("the final blow defeats the boss (overkill floors at 0), pays gold and brings on the next", async () => {
  const { familyId, childIds: [kid] } = await makeFamily(db);
  const today = await londonToday(db);
  const boss = await activeBoss(db, familyId);
  await setBossHp(db, familyId, 20);
  const s = await quest(familyId, kid, today, 45);

  await tick(kid, s);

  const done = await bossById(boss.id);
  assert.equal(done.status, "defeated");
  assert.equal(done.current_hp, 0);
  assert.deepEqual((await log(boss.id, "defeated")).map((r) => r.amount), [25], "low tier: 25 gold");
  assert.deepEqual(await log(boss.id, "gold_awarded"), [{ amount: 25, child_id: kid, source_task_slot_id: null }]);
  assert.equal((await stats(db, kid)).gold, 25);

  const next = await activeBoss(db, familyId);
  assert.equal(next.name, "Alarm Clock Swarm");
  assert.equal(next.current_hp, next.max_hp, "overkill doesn't carry over");
});

test("gold is split by damage share; the rounding remainder goes to the top damage dealer", async () => {
  const { familyId, childIds: [a, b, c] } = await makeFamily(db, { children: 3 });
  const today = await londonToday(db);
  const boss = await activeBoss(db, familyId);
  await setBossHp(db, familyId, 70);
  // Damage 30 / 20 / 20 of 70 → 25 × share = 10.7 / 7.1 / 7.1 → 10 / 7 / 7, +1 to a.
  await tick(a, await quest(familyId, a, today, 30));
  await tick(b, await quest(familyId, b, today, 20));
  await tick(c, await quest(familyId, c, today, 20));

  assert.equal((await bossById(boss.id)).status, "defeated");
  assert.deepEqual(
    [(await stats(db, a)).gold, (await stats(db, b)).gold, (await stats(db, c)).gold],
    [11, 7, 7],
  );
  const awarded = await log(boss.id, "gold_awarded");
  assert.equal(awarded.reduce((n, r) => n + r.amount, 0), 25, "exactly the tier's gold, no more, no less");
});

test("epic bosses pay 100 gold", async () => {
  const { familyId, childIds: [kid] } = await makeFamily(db);
  const today = await londonToday(db);
  for (let i = 0; i < 8; i++) await finish((await activeBoss(db, familyId)).id, "escaped", today);
  const epic = await activeBoss(db, familyId);
  assert.equal(epic.tier, "epic");
  await setBossHp(db, familyId, 10);
  await tick(kid, await quest(familyId, kid, today, 10));
  assert.deepEqual((await log(epic.id, "defeated")).map((r) => r.amount), [100]);
  assert.equal((await stats(db, kid)).gold, 100);
});

// --- Retreat & return (…15) ------------------------------------------------------

/** Every boss in the family except `keep` (names) marked defeated. */
async function onlyLeft(familyId, ...keep) {
  await db.query("update public.bosses set status = 'defeated' where family_id = $1 and not (name = any($2))", [familyId, keep]);
}
const byName = async (familyId, name) =>
  (await db.query("select * from public.bosses where family_id = $1 and name = $2", [familyId, name])).rows[0];

test("every activation sets active_since (first-time too); new bosses get base_max_hp = max_hp", async () => {
  const { familyId } = await makeFamily(db);
  const today = await londonToday(db);
  const { rows } = await db.query("select count(*)::int as n from public.bosses where family_id = $1 and base_max_hp = max_hp", [familyId]);
  assert.equal(rows[0].n, 12);
  const slime = await activeBoss(db, familyId);
  assert.ok(slime.active_since, "the first boss, activated at family creation");
  assert.equal(slime.retreats, 0);
  await finish(slime.id, "defeated", today);
  const swarm = await activeBoss(db, familyId);
  assert.ok(swarm.active_since >= slime.active_since);
});

test("an escape brings on the next queued boss, never the one that fled; the retreat is counted, its HP untouched", async () => {
  const { familyId } = await makeFamily(db);
  const today = await londonToday(db);
  const slime = await activeBoss(db, familyId);
  await db.query("update public.bosses set current_hp = 42 where id = $1", [slime.id]);
  const r = (await finish(slime.id, "escaped", today)).rows[0].r;
  const fled = await bossById(slime.id);
  assert.deepEqual([fled.status, fled.retreats, fled.max_hp, fled.current_hp], ["escaped", 1, 60, 42]);
  assert.ok(fled.escaped_at);
  const next = await activeBoss(db, familyId);
  assert.equal(next.name, "Alarm Clock Swarm");
  assert.equal(r.activated, next.id);
  assert.deepEqual(r.comeback_bonus, { gold: 0, xp: 0 });
});

test("a retreated boss returns after the party's next win, before the queue: +10% max HP, at full HP", async () => {
  const { familyId } = await makeFamily(db);
  const today = await londonToday(db);
  const slime = await activeBoss(db, familyId);
  await finish(slime.id, "escaped", today);
  const swarm = await activeBoss(db, familyId);
  await finish(swarm.id, "defeated", today);
  const back = await activeBoss(db, familyId);
  assert.equal(back.id, slime.id, "the Slime is back, not the Laundry Goblin");
  assert.deepEqual([back.max_hp, back.current_hp, back.base_max_hp, back.retreats], [66, 66, 60, 1]);
  assert.ok(back.active_since > swarm.active_since);
  assert.equal((await log(slime.id, "activated")).length, 2);
  // Beaten again, the queue carries on.
  await finish(back.id, "defeated", today);
  assert.equal((await activeBoss(db, familyId)).name, "Laundry Goblin");
});

test("the oldest escape returns first, whatever its tier; one return per win", async () => {
  const { familyId } = await makeFamily(db);
  const today = await londonToday(db);
  // All four low-tier bosses flee in turn: Slime, Swarm, Goblin, Spider.
  for (let i = 0; i < 4; i++) await finish((await activeBoss(db, familyId)).id, "escaped", today);
  const ooze = await activeBoss(db, familyId);
  assert.equal(ooze.name, "Swamp-Bag Ooze", "escapes only draw from the queue");
  const order = [];
  for (let i = 0; i < 5; i++) {
    const boss = await activeBoss(db, familyId);
    await finish(boss.id, "defeated", today);
    order.push((await activeBoss(db, familyId)).name);
  }
  assert.deepEqual(order, ["Trash-Bag Slime", "Alarm Clock Swarm", "Laundry Goblin", "Cable Spider", "Tupperware Troll"]);
});

test("an escape that leaves nothing queued: no boss until the next nightly reset brings it back", async () => {
  const { familyId, childIds: [kid] } = await makeFamily(db);
  await onlyLeft(familyId, "Trash-Bag Slime");
  const slime = await activeBoss(db, familyId);
  await quest(familyId, kid, D, 150); // knocks the party out

  const first = await reset(familyId, addDays(D, 1));
  assert.equal(first.escaped, slime.id);
  assert.equal(first.activated, null, "never re-picked on its own escape");
  assert.equal(await activeBoss(db, familyId), null);
  const p = await party(familyId);
  assert.equal(p.current_hp, p.max_hp, "the party still refills");

  const second = await reset(familyId, addDays(D, 2));
  const back = await activeBoss(db, familyId);
  assert.equal(back.id, slime.id);
  assert.equal(second.activated, slime.id);
  assert.deepEqual([back.max_hp, back.current_hp], [66, 66]);
  assert.equal(back.week_start_date.toISOString().slice(0, 10), mondayOf(addDays(D, 2)));
});

test("HP bump: +10% of the ORIGINAL max HP per retreat (not compounding), rounded up, capped at +30%", async () => {
  const { familyId } = await makeFamily(db);
  const today = await londonToday(db);
  await onlyLeft(familyId, "Trash-Bag Slime");
  const seen = [];
  for (let i = 0; i < 4; i++) {
    const boss = await activeBoss(db, familyId);
    await finish(boss.id, "escaped", today);
    await db.query("select public.activate_next_boss($1, $2)", [familyId, today]); // as the next reset would
    seen.push((await activeBoss(db, familyId)).max_hp);
  }
  assert.deepEqual(seen, [66, 72, 78, 78]);
  // lib/rpg/retreat.ts (the on-screen "+N%") mirrors the database's rule.
  assert.deepEqual(seen, [1, 2, 3, 4].map((n) => Math.ceil(60 * (1 + retreat.retreatHpBonusPct(n) / 100))));
  assert.equal((await byName(familyId, "Trash-Bag Slime")).retreats, 4, "retreats keep counting past the cap");

  // Rounding up: an original 61 HP, one retreat → 67.1 → 68.
  const boss = await activeBoss(db, familyId);
  await db.query("update public.bosses set base_max_hp = 61, retreats = 0 where id = $1", [boss.id]);
  await finish(boss.id, "escaped", today);
  await db.query("select public.activate_next_boss($1, $2)", [familyId, today]);
  assert.equal((await activeBoss(db, familyId)).max_hp, 68);
});

test("comeback bonus: +50% of the tier's gold and XP, flat, split by damage share; a first defeat has none", async () => {
  const { familyId, childIds: [a, b] } = await makeFamily(db, { children: 2 });
  const today = await londonToday(db);
  const slime = await activeBoss(db, familyId);
  // First defeat of a boss: the plain 25 gold, no bonus row.
  await finish(slime.id, "defeated", today);
  assert.equal((await log(slime.id, "comeback_bonus")).length, 0);
  assert.deepEqual((await log(slime.id, "defeated")).map((r) => r.amount), [25]);

  // The Swarm retreats twice, then is beaten: still +50%, not +100%.
  const swarm = await activeBoss(db, familyId);
  await onlyLeft(familyId, "Alarm Clock Swarm");
  for (let i = 0; i < 2; i++) {
    await finish((await activeBoss(db, familyId)).id, "escaped", today);
    await db.query("select public.activate_next_boss($1, $2)", [familyId, today]);
  }
  assert.equal((await activeBoss(db, familyId)).retreats, 2);
  await setBossHp(db, familyId, 60);
  const xpBefore = [(await stats(db, a)).xp, (await stats(db, b)).xp];
  // Damage 40 / 20: gold 38 × ⅔ = 25.3 / 12.7 → 25 / 12, +1 to a; XP 75 → 50 / 25.
  await tick(a, await quest(familyId, a, today, 40));
  await tick(b, await quest(familyId, b, today, 20));

  assert.equal((await bossById(swarm.id)).status, "defeated");
  assert.deepEqual((await log(swarm.id, "defeated")).map((r) => r.amount), [38], "25 + 13 in the pool");
  assert.deepEqual((await log(swarm.id, "comeback_bonus")).map((r) => r.amount), [13]);
  assert.equal(Math.ceil((25 * retreat.COMEBACK_BONUS_PCT) / 100), 13, "lib/rpg/retreat.ts mirrors the bonus");
  // (The Slime's 25 went to no one: nobody hit it before finish_boss.)
  assert.deepEqual([(await stats(db, a)).gold, (await stats(db, b)).gold], [26, 12]);
  assert.deepEqual(
    [(await stats(db, a)).xp - xpBefore[0], (await stats(db, b)).xp - xpBefore[1]],
    [40 + 50, 20 + 25],
    "1 XP per quest minute, plus the defeat XP (50 + 25 bonus) by share",
  );
});

test("the reward counts only the current fight: damage from before a retreat earns nothing", async () => {
  const { familyId, childIds: [a, b] } = await makeFamily(db, { children: 2 });
  const today = await londonToday(db);
  const slime = await activeBoss(db, familyId);
  await tick(a, await quest(familyId, a, today, 30)); // the first fight
  await finish(slime.id, "escaped", today);
  await finish((await activeBoss(db, familyId)).id, "defeated", today); // no one hit the Swarm: no awards
  const back = await activeBoss(db, familyId);
  assert.equal(back.id, slime.id);
  await tick(b, await quest(familyId, b, today, 66)); // the rematch, all b

  assert.equal((await bossById(slime.id)).status, "defeated");
  assert.equal((await stats(db, a)).gold, 0, "a's damage was in the lost fight");
  assert.equal((await stats(db, b)).gold, 38);
  assert.deepEqual((await log(slime.id, "gold_awarded")).map((r) => [r.child_id, r.amount]), [[b, 38]]);
  // Every fight's damage stays in the log (the Trophy Case sums it all).
  assert.equal((await log(slime.id, "damage")).reduce((n, r) => n + r.amount, 0), 96);
});

// --- Nightly reset ------------------------------------------------------------
// Days far in the future, driven through run_daily_reset(family, today).

const D = "2031-03-05"; // a Wednesday

test("the reset marks past open quests missed and hurts the party by their minutes", async () => {
  const { familyId, childIds: [a, b] } = await makeFamily(db, { children: 2 });
  const boss = await activeBoss(db, familyId);
  const missA = await quest(familyId, a, D, 10);
  const missB = await quest(familyId, b, D, 15);
  const todays = await quest(familyId, a, addDays(D, 1), 20); // "today": not missed yet
  const done = await quest(familyId, a, D, 5);
  await db.query("update public.task_slots set status = 'completed' where id = $1", [done]);

  const r = await reset(familyId, addDays(D, 1));

  assert.equal((await slot(db, missA)).status, "missed");
  assert.equal((await slot(db, missB)).status, "missed");
  assert.equal((await slot(db, todays)).status, "scheduled");
  assert.equal((await slot(db, done)).status, "completed");
  assert.equal(r.missed_minutes, 25);
  assert.equal(r.party_damage, 25);
  assert.equal((await party(familyId)).current_hp, 75);
  assert.deepEqual(
    (await log(boss.id, "miss_penalty")).map((x) => [x.child_id, x.amount]).sort(),
    [[a, 10], [b, 15]].sort(),
  );
  assert.equal((await bossById(boss.id)).status, "active", "party still standing: boss stays");
});

test("running the reset twice for the same day doesn't double the penalty", async () => {
  const { familyId, childIds: [kid] } = await makeFamily(db);
  await quest(familyId, kid, D, 30);
  await reset(familyId, addDays(D, 1));
  const second = await reset(familyId, addDays(D, 1));
  assert.equal(second.party_damage, 0);
  assert.equal((await party(familyId)).current_hp, 70);
});

test("party at 0: the boss escapes with its HP logged, the next boss comes, the party refills", async () => {
  const { familyId, childIds: [kid] } = await makeFamily(db);
  const boss = await activeBoss(db, familyId);
  await db.query("update public.bosses set current_hp = 42 where id = $1", [boss.id]);
  await quest(familyId, kid, D, 150); // more than the party's 100 HP

  const r = await reset(familyId, addDays(D, 1));

  assert.equal((await bossById(boss.id)).status, "escaped");
  assert.equal(r.escaped, boss.id);
  assert.deepEqual((await log(boss.id, "escaped")).map((x) => x.amount), [42]);
  assert.equal((await log(boss.id, "gold_awarded")).length, 0, "no gold for an escape");
  assert.equal((await stats(db, kid)).gold, 0);
  const p = await party(familyId);
  assert.equal(p.current_hp, p.max_hp);
  const next = await activeBoss(db, familyId);
  assert.equal(next.name, "Alarm Clock Swarm");
  assert.equal(r.activated, next.id);
  assert.equal(next.week_start_date.toISOString().slice(0, 10), mondayOf(addDays(D, 1)), "week of the reset day");
});

test("safety net: a boss left active at 0 HP is defeated by the reset, with its gold", async () => {
  const { familyId, childIds: [kid] } = await makeFamily(db);
  const boss = await activeBoss(db, familyId);
  await db.query(
    "insert into public.boss_log (boss_id, event_type, amount, child_id) values ($1, 'damage', 60, $2)",
    [boss.id, kid],
  );
  await db.query("update public.bosses set current_hp = 0 where id = $1", [boss.id]);

  const r = await reset(familyId, addDays(D, 1));

  assert.equal(r.defeated, boss.id);
  assert.equal((await bossById(boss.id)).status, "defeated");
  assert.equal((await stats(db, kid)).gold, 25);
  assert.equal((await activeBoss(db, familyId)).name, "Alarm Clock Swarm");
});

test("with no boss left, misses are still marked but the party isn't hurt", async () => {
  const { familyId, childIds: [kid] } = await makeFamily(db);
  await db.query("update public.bosses set status = 'defeated' where family_id = $1", [familyId]);
  const s = await quest(familyId, kid, D, 30);
  const r = await reset(familyId, addDays(D, 1));
  assert.equal((await slot(db, s)).status, "missed");
  assert.equal(r.party_damage, 0);
  assert.equal((await party(familyId)).current_hp, 100);
});

test("the reset only touches its own family", async () => {
  const one = await makeFamily(db);
  const two = await makeFamily(db);
  const s = await quest(two.familyId, two.childIds[0], D, 30);
  await reset(one.familyId, addDays(D, 1));
  assert.equal((await slot(db, s)).status, "scheduled");
  assert.equal((await party(two.familyId))?.current_hp ?? 100, 100);
});

// --- Access -------------------------------------------------------------------

test("engine functions can't be called through the API, except the reset by the service role", async () => {
  const { familyId, parentId, childIds: [kid] } = await makeFamily(db);
  const boss = await activeBoss(db, familyId);
  for (const uid of [kid, parentId]) {
    for (const [sql, params] of [
      ["select public.run_daily_reset($1)", [familyId]],
      ["select public.run_daily_reset_all()", []],
      ["select public.finish_boss($1, 'defeated', current_date)", [boss.id]],
      ["select public.activate_next_boss($1, current_date)", [familyId]],
      ["select public.activate_boss($1, current_date, 'any')", [familyId]],
      ["select public.seed_family_bosses($1)", [familyId]],
      ["select public.award_xp($1, 1000)", [kid]],
    ]) {
      assert.match((await tryAsUser(db, uid, sql, params)) ?? "", /permission denied/, sql);
    }
  }
  const { rows } = await db.query(
    "select has_function_privilege('service_role', 'public.run_daily_reset(uuid, date)', 'execute') as reset, has_function_privilege('service_role', 'public.run_daily_reset_all()', 'execute') as reset_all",
  );
  assert.deepEqual(rows[0], { reset: true, reset_all: true });
  assert.equal((await bossById(boss.id)).status, "active");
});

test("a child can't write bosses, the boss log or the party's health directly", async () => {
  const { familyId, childIds: [kid] } = await makeFamily(db);
  const boss = await activeBoss(db, familyId);
  const hit = async (sql, params) => {
    const err = await tryAsUser(db, kid, sql, params);
    return err === null ? "ok" : err;
  };
  await hit("update public.bosses set current_hp = 0 where id = $1", [boss.id]);
  await hit("update public.party_health set current_hp = 1 where family_id = $1", [familyId]);
  assert.notEqual(
    await hit("insert into public.boss_log (boss_id, event_type, amount, child_id) values ($1, 'damage', 999, $2)", [boss.id, kid]),
    "ok",
  );
  // RLS silently filters the updates to zero rows; nothing changed.
  assert.equal((await bossById(boss.id)).current_hp, boss.max_hp);
  assert.equal((await party(familyId))?.current_hp ?? 100, 100);
});
