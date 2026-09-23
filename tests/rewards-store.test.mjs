// The rewards store (…09): the gold ledger triggers on reward_redemptions
// (hold for every caller) and the RLS around them (run as `authenticated`).
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { freshDb, as, asUser, tryAsUser, makeFamily, stats } from "./helpers/db.mjs";

let db;
before(async () => {
  db = await freshDb();
});

async function setGold(childId, gold) {
  await db.query(
    "insert into public.player_stats (child_id, gold) values ($1, $2) on conflict (child_id) do update set gold = excluded.gold",
    [childId, gold],
  );
}
async function makeReward(familyId, cost, { active = true } = {}) {
  const { rows } = await db.query(
    "insert into public.rewards (family_id, title, gold_cost, active) values ($1, 'Treat', $2, $3) returning id",
    [familyId, cost, active],
  );
  return rows[0].id;
}
/** The child's request, as the app sends it (through RLS). Returns the row. */
async function redeem(childId, familyId, rewardId, goldSpent) {
  const { rows } = await asUser(
    db, childId,
    `insert into public.reward_redemptions (family_id, child_id, reward_id, gold_spent)
     values ($1, $2, $3, $4) returning *`,
    [familyId, childId, rewardId, goldSpent],
  );
  return rows[0];
}
const tryRedeem = (childId, familyId, rewardId, goldSpent) =>
  tryAsUser(
    db, childId,
    "insert into public.reward_redemptions (family_id, child_id, reward_id, gold_spent) values ($1, $2, $3, $4)",
    [familyId, childId, rewardId, goldSpent],
  );
/** Direct SQL insert (no RLS), to reach the trigger with any values. */
const trySqlRedeem = async (values) => {
  const cols = Object.keys(values);
  try {
    await db.query(
      `insert into public.reward_redemptions (${cols.join(", ")}) values (${cols.map((_, i) => `$${i + 1}`).join(", ")})`,
      Object.values(values),
    );
    return null;
  } catch (e) {
    return e.message;
  }
};
const resolve = (uid, id, status) =>
  as(db, uid, "update public.reward_redemptions set status = $2 where id = $1", [id, status]);
const tryResolve = async (uid, id, status) => {
  try {
    await resolve(uid, id, status);
    return null;
  } catch (e) {
    return e.message;
  }
};
async function redemption(id) {
  const { rows } = await db.query("select * from public.reward_redemptions where id = $1", [id]);
  return rows[0];
}
const gold = async (childId) => (await stats(db, childId)).gold;

// --- Requesting -----------------------------------------------------------------

test("a request is priced from the reward's current cost and the gold is spent at once", async () => {
  const { familyId, childIds: [kid] } = await makeFamily(db);
  await setGold(kid, 100);
  const reward = await makeReward(familyId, 40);

  const r = await redeem(kid, familyId, reward, 40);

  assert.equal(r.status, "pending");
  assert.equal(r.gold_spent, 40);
  assert.equal(await gold(kid), 60);
});

test("the client can't choose the price or the time", async () => {
  const { familyId, childIds: [kid] } = await makeFamily(db);
  await setGold(kid, 100);
  const reward = await makeReward(familyId, 40);
  // Service role / SQL bypasses RLS, but the trigger still prices it.
  assert.equal(
    await trySqlRedeem({ family_id: familyId, child_id: kid, reward_id: reward, gold_spent: 1, redeemed_at: "2000-01-01" }),
    null,
  );
  const { rows } = await db.query(
    "select gold_spent, redeemed_at > now() - interval '1 minute' as fresh from public.reward_redemptions where child_id = $1",
    [kid],
  );
  assert.deepEqual(rows, [{ gold_spent: 40, fresh: true }]);
  assert.equal(await gold(kid), 60);
});

test("not enough gold: the request is refused and nothing is spent", async () => {
  const { familyId, childIds: [kid] } = await makeFamily(db);
  await setGold(kid, 39);
  const reward = await makeReward(familyId, 40);
  assert.match((await tryRedeem(kid, familyId, reward, 40)) ?? "", /^redemption_insufficient_gold/);
  assert.equal(await gold(kid), 39);
  const { rows } = await db.query("select count(*)::int as n from public.reward_redemptions where child_id = $1", [kid]);
  assert.equal(rows[0].n, 0);
});

test("a child with no stats row yet has no gold to spend", async () => {
  const { familyId, childIds: [kid] } = await makeFamily(db);
  await db.query("delete from public.player_stats where child_id = $1", [kid]);
  const reward = await makeReward(familyId, 1);
  assert.match((await tryRedeem(kid, familyId, reward, 1)) ?? "", /^redemption_insufficient_gold/);
});

test("a free reward can be requested with 0 gold", async () => {
  const { familyId, childIds: [kid] } = await makeFamily(db);
  await setGold(kid, 0);
  const reward = await makeReward(familyId, 0);
  assert.equal((await redeem(kid, familyId, reward, 0)).gold_spent, 0);
});

test("back-to-back requests can't spend more than the balance", async () => {
  const { familyId, childIds: [kid] } = await makeFamily(db);
  await setGold(kid, 50);
  const reward = await makeReward(familyId, 20);
  await redeem(kid, familyId, reward, 20);
  await redeem(kid, familyId, reward, 20);
  assert.match((await tryRedeem(kid, familyId, reward, 20)) ?? "", /^redemption_insufficient_gold/);
  assert.equal(await gold(kid), 10);
  // (True concurrency — the row lock — can't be exercised in single-connection
  // PGlite; the atomic `update … where gold >= cost` is what this relies on.)
});

test("hidden rewards, other families' rewards and non-players can't be requested", async () => {
  const { familyId, parentId, childIds: [kid] } = await makeFamily(db);
  const other = await makeFamily(db);
  await setGold(kid, 100);
  const hidden = await makeReward(familyId, 10, { active: false });
  const theirs = await makeReward(other.familyId, 10);
  const ours = await makeReward(familyId, 10);

  // Through the ledger trigger (SQL, no RLS in the way).
  const req = (childId, rewardId) => trySqlRedeem({ family_id: familyId, child_id: childId, reward_id: rewardId });
  assert.match((await req(kid, hidden)) ?? "", /^redemption_reward_unavailable/);
  assert.match((await req(kid, theirs)) ?? "", /^redemption_reward_unavailable/);
  assert.match((await req(parentId, ours)) ?? "", /^redemption_reward_unavailable/, "a parent isn't a player");
  assert.match((await req(other.childIds[0], ours)) ?? "", /^redemption_reward_unavailable/, "another family's child");
  assert.equal(await gold(kid), 100);
});

test("new requests must start pending and unresolved", async () => {
  const { familyId, parentId, childIds: [kid] } = await makeFamily(db);
  await setGold(kid, 100);
  const reward = await makeReward(familyId, 10);
  const base = { family_id: familyId, child_id: kid, reward_id: reward };
  assert.match((await trySqlRedeem({ ...base, status: "approved" })) ?? "", /^redemption_bad_status/);
  assert.match((await trySqlRedeem({ ...base, status: "fulfilled" })) ?? "", /^redemption_bad_status/);
  assert.match((await trySqlRedeem({ ...base, resolved_by: parentId })) ?? "", /^redemption_bad_status/);
  assert.equal(await gold(kid), 100);
});

// --- Resolving --------------------------------------------------------------------

test("denying a request refunds exactly what was spent, even if the price changed since", async () => {
  const { familyId, parentId, childIds: [kid] } = await makeFamily(db);
  await setGold(kid, 100);
  const reward = await makeReward(familyId, 30);
  const r = await redeem(kid, familyId, reward, 30);
  await db.query("update public.rewards set gold_cost = 80 where id = $1", [reward]);

  await resolve(parentId, r.id, "denied");

  assert.equal(await gold(kid), 100);
  const after = await redemption(r.id);
  assert.equal(after.status, "denied");
  assert.equal(after.resolved_by, parentId);
});

test("approve → fulfil keeps the gold spent; approve → deny refunds it", async () => {
  const { familyId, parentId, childIds: [kid] } = await makeFamily(db);
  await setGold(kid, 100);
  const reward = await makeReward(familyId, 25);
  const kept = await redeem(kid, familyId, reward, 25);
  const refunded = await redeem(kid, familyId, reward, 25);
  const straight = await redeem(kid, familyId, reward, 25);
  assert.equal(await gold(kid), 25);

  await resolve(parentId, kept.id, "approved");
  await resolve(parentId, kept.id, "fulfilled");
  await resolve(parentId, refunded.id, "approved");
  await resolve(parentId, refunded.id, "denied");
  await resolve(parentId, straight.id, "fulfilled"); // pending → fulfilled directly

  assert.equal(await gold(kid), 50);
});

test("denied and fulfilled are final; approved can't go back to pending", async () => {
  const { familyId, parentId, childIds: [kid] } = await makeFamily(db);
  await setGold(kid, 100);
  const reward = await makeReward(familyId, 10);
  const denied = await redeem(kid, familyId, reward, 10);
  const fulfilled = await redeem(kid, familyId, reward, 10);
  const approved = await redeem(kid, familyId, reward, 10);
  await resolve(parentId, denied.id, "denied");
  await resolve(parentId, fulfilled.id, "fulfilled");
  await resolve(parentId, approved.id, "approved");
  const goldBefore = await gold(kid);

  for (const status of ["pending", "approved", "fulfilled"]) {
    assert.match((await tryResolve(parentId, denied.id, status)) ?? "", /^redemption_bad_status/, `denied → ${status}`);
  }
  for (const status of ["pending", "approved", "denied"]) {
    assert.match((await tryResolve(parentId, fulfilled.id, status)) ?? "", /^redemption_bad_status/, `fulfilled → ${status}`);
  }
  assert.match((await tryResolve(parentId, approved.id, "pending")) ?? "", /^redemption_bad_status/);
  assert.equal(await gold(kid), goldBefore, "no second refund");
});

test("re-saving the same status is a no-op and keeps who resolved it", async () => {
  const { familyId, parentId, childIds: [kid] } = await makeFamily(db);
  await setGold(kid, 100);
  const r = await redeem(kid, familyId, await makeReward(familyId, 10), 10);
  await resolve(parentId, r.id, "denied");
  await db.query("update public.reward_redemptions set status = 'denied', resolved_by = null where id = $1", [r.id]);
  const after = await redemption(r.id);
  assert.equal(after.resolved_by, parentId);
  assert.equal(await gold(kid), 100, "no double refund");
});

test("only the status can change: price, child, reward and time are immutable", async () => {
  const { familyId, childIds: [kid, sib] } = await makeFamily(db, { children: 2 });
  await setGold(kid, 100);
  const reward = await makeReward(familyId, 10);
  const r = await redeem(kid, familyId, reward, 10);
  for (const [col, val] of [
    ["gold_spent", 0],
    ["child_id", sib],
    ["reward_id", await makeReward(familyId, 1)],
    ["redeemed_at", "2000-01-01"],
  ]) {
    await assert.rejects(
      db.query(`update public.reward_redemptions set ${col} = $2 where id = $1`, [r.id, val]),
      /^error: redemption_immutable|redemption_immutable/,
      col,
    );
  }
});

test("resolved_by records the signed-in parent; SQL/service-role changes leave it empty", async () => {
  const { familyId, childIds: [kid] } = await makeFamily(db);
  await setGold(kid, 100);
  const r = await redeem(kid, familyId, await makeReward(familyId, 10), 10);
  await resolve(null, r.id, "approved");
  assert.equal((await redemption(r.id)).resolved_by, null);
});

// --- RLS ----------------------------------------------------------------------------

test("a child can only request for themselves, and can't resolve or delete requests", async () => {
  const { familyId, childIds: [kid, sib] } = await makeFamily(db, { children: 2 });
  await setGold(kid, 100);
  await setGold(sib, 100);
  const reward = await makeReward(familyId, 10);

  assert.match(
    (await tryAsUser(db, kid,
      "insert into public.reward_redemptions (family_id, child_id, reward_id, gold_spent) values ($1, $2, $3, 10)",
      [familyId, sib, reward])) ?? "",
    /row-level security/,
  );
  assert.equal(await gold(sib), 100);

  const r = await redeem(kid, familyId, reward, 10);
  const upd = await asUser(db, kid, "update public.reward_redemptions set status = 'denied' where id = $1", [r.id]);
  const del = await asUser(db, kid, "delete from public.reward_redemptions where id = $1", [r.id]);
  assert.equal(upd.affectedRows, 0);
  assert.equal(del.affectedRows, 0);
  assert.equal((await redemption(r.id)).status, "pending");
  assert.equal(await gold(kid), 90);
});

test("a parent resolves requests but can't create or delete them", async () => {
  const { familyId, parentId, childIds: [kid] } = await makeFamily(db);
  await setGold(kid, 100);
  const reward = await makeReward(familyId, 10);

  assert.match(
    (await tryAsUser(db, parentId,
      "insert into public.reward_redemptions (family_id, child_id, reward_id, gold_spent) values ($1, $2, $3, 10)",
      [familyId, kid, reward])) ?? "",
    /row-level security/,
  );
  assert.equal(await gold(kid), 100);

  const r = await redeem(kid, familyId, reward, 10);
  const del = await asUser(db, parentId, "delete from public.reward_redemptions where id = $1", [r.id]);
  assert.equal(del.affectedRows, 0, "a deleted pending request would make gold vanish");

  const upd = await asUser(db, parentId, "update public.reward_redemptions set status = 'denied' where id = $1", [r.id]);
  assert.equal(upd.affectedRows, 1);
  assert.equal((await redemption(r.id)).resolved_by, parentId);
  assert.equal(await gold(kid), 100);
});

test("another family's parent can't see or resolve a request", async () => {
  const { familyId, childIds: [kid] } = await makeFamily(db);
  const other = await makeFamily(db);
  await setGold(kid, 100);
  const r = await redeem(kid, familyId, await makeReward(familyId, 10), 10);

  const seen = await asUser(db, other.parentId, "select id from public.reward_redemptions where id = $1", [r.id]);
  assert.equal(seen.rows.length, 0);
  const upd = await asUser(db, other.parentId, "update public.reward_redemptions set status = 'denied' where id = $1", [r.id]);
  assert.equal(upd.affectedRows, 0);
  assert.equal(await gold(kid), 90);
});

test("a child can't hand themselves gold", async () => {
  const { childIds: [kid] } = await makeFamily(db);
  await setGold(kid, 5);
  await tryAsUser(db, kid, "update public.player_stats set gold = 9999 where child_id = $1", [kid]);
  await tryAsUser(db, kid, "insert into public.player_stats (child_id, gold) values ($1, 9999) on conflict (child_id) do update set gold = 9999", [kid]);
  assert.equal(await gold(kid), 5);
});

// --- Catalogue ----------------------------------------------------------------------

test("a reward with requests can't be deleted; one never requested can; a family deletes cleanly", async () => {
  const { familyId, childIds: [kid] } = await makeFamily(db);
  await setGold(kid, 100);
  const used = await makeReward(familyId, 10);
  const unused = await makeReward(familyId, 10);
  const r = await redeem(kid, familyId, used, 10);
  await resolve(null, r.id, "denied");

  await assert.rejects(db.query("delete from public.rewards where id = $1", [used]), /foreign key/);
  await db.query("delete from public.rewards where id = $1", [unused]);

  await db.query("delete from public.families where id = $1", [familyId]);
  const { rows } = await db.query("select count(*)::int as n from public.reward_redemptions where family_id = $1", [familyId]);
  assert.equal(rows[0].n, 0);
});

test("children see their family's rewards but can't edit the catalogue", async () => {
  const { familyId, childIds: [kid] } = await makeFamily(db);
  const reward = await makeReward(familyId, 50);
  const seen = await asUser(db, kid, "select id from public.rewards where family_id = $1", [familyId]);
  assert.deepEqual(seen.rows.map((x) => x.id), [reward]);
  const upd = await asUser(db, kid, "update public.rewards set gold_cost = 0 where id = $1", [reward]);
  assert.equal(upd.affectedRows, 0);
  assert.match(
    (await tryAsUser(db, kid, "insert into public.rewards (family_id, title, gold_cost) values ($1, 'Free', 0)", [familyId])) ?? "",
    /row-level security/,
  );
});
