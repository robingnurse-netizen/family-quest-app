// The live database got its migrations out of file order: …15 (boss
// retreat) was applied on 25 Sep 2026 BEFORE …14 (streak recovery), then
// …16 (Night Raid). A fresh database runs …14 → …15 → …16. Both orders must
// apply cleanly — …14's check against replacing …15's functions only runs
// when …15 is already in — and end in the same schema and functions.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { freshDb, migrationFiles } from "./helpers/db.mjs";

const FIFTEEN = "20260929000015_boss_retreat.sql";
const FOURTEEN = "20260928000014_streak_recovery.sql";

/** File order with …15 moved in front of …14 (how the live database got them). */
function liveOrder() {
  const files = migrationFiles().filter((f) => f !== FIFTEEN);
  files.splice(files.indexOf(FOURTEEN), 0, FIFTEEN);
  return files;
}

async function shape(db) {
  const fns = await db.query(
    `select p.oid::regprocedure::text as sig, pg_get_functiondef(p.oid) as def
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' order by 1`,
  );
  const cols = await db.query(
    `select table_name, column_name, data_type, is_nullable, column_default
       from information_schema.columns where table_schema = 'public' order by 1, 2`,
  );
  const checks = await db.query(
    `select conrelid::regclass::text as tbl, conname, pg_get_constraintdef(oid) as def
       from pg_constraint where connamespace = 'public'::regnamespace and contype = 'c' order by 1, 2`,
  );
  const grants = await db.query(
    `select p.oid::regprocedure::text as sig,
            has_function_privilege('authenticated', p.oid, 'execute') as authed,
            has_function_privilege('anon', p.oid, 'execute') as anon
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' order by 1`,
  );
  return { fns: fns.rows, cols: cols.rows, checks: checks.rows, grants: grants.rows };
}

test("live order (…15 before …14) applies cleanly and matches the fresh order exactly", async () => {
  const order = liveOrder();
  assert.ok(order.indexOf(FIFTEEN) < order.indexOf(FOURTEEN), "the replay really is out of order");
  const live = await shape(await freshDb({ order }));
  const fresh = await shape(await freshDb());
  assert.deepEqual(live.fns.map((f) => f.sig), fresh.fns.map((f) => f.sig));
  for (let i = 0; i < live.fns.length; i++) assert.equal(live.fns[i].def, fresh.fns[i].def, live.fns[i].sig);
  assert.deepEqual(live.cols, fresh.cols);
  assert.deepEqual(live.checks, fresh.checks);
  assert.deepEqual(live.grants, fresh.grants);
});

test("…14's guard: with …15 in, it refuses to commit if …15's finish_boss has been replaced", async () => {
  const upTo15 = liveOrder().slice(0, liveOrder().indexOf(FOURTEEN));
  const db = await freshDb({ order: upTo15 });
  await db.exec(
    "create or replace function public.finish_boss(p_boss_id uuid, p_outcome text, p_today date) returns jsonb language sql as $$ select '{}'::jsonb $$",
  );
  const sql = readFileSync(new URL(`../supabase/migrations/${FOURTEEN}`, import.meta.url), "utf8");
  await assert.rejects(db.exec(sql), /…15's finish_boss \/ activate_next_boss were replaced/);
});
