// Test database: every migration in supabase/migrations loaded into an
// in-memory Postgres (PGlite), behind a minimal Supabase shim. Each test
// file gets a fresh database via freshDb().
//
// The shim provides what the migrations use from Supabase: an auth schema
// (auth.users + auth.uid(), read from the `app.uid` setting so tests can
// act as a user), the anon / authenticated / service_role roles, and the
// supabase_realtime publication.

import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const migrationsDir = join(root, "supabase", "migrations");

const SHIM = `
  create schema auth;
  create table auth.users (
    id uuid primary key,
    email text,
    raw_user_meta_data jsonb not null default '{}'::jsonb,
    created_at timestamptz default now()
  );
  create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('app.uid', true), '')::uuid $$;
  create role anon; create role authenticated; create role service_role;
  create publication supabase_realtime;
  -- Supabase's default privileges: the API roles get every table and
  -- function in public; RLS and the migrations' revokes narrow that down.
  grant usage on schema public to anon, authenticated, service_role;
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
`;

/** Every migration file name, in the order a fresh database applies them. */
export function migrationFiles() {
  return readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort();
}

/**
 * A new database with every migration applied — in file-name order, or in
 * `order` (file names) to replay the order a live database got them in.
 */
export async function freshDb({ order = migrationFiles() } = {}) {
  const db = new PGlite();
  await db.exec(SHIM);
  for (const file of order) {
    await db.exec(readFileSync(join(migrationsDir, file), "utf8"));
  }
  // Test users are created directly (the signup trigger expects app metadata).
  await db.exec("alter table auth.users disable trigger user");
  return db;
}

/** Run `sql` as a user (a profile id), or as the service role / SQL (null). */
export async function as(db, uid, sql, params = []) {
  await db.exec(`set app.uid = '${uid ?? ""}'`);
  try {
    return await db.query(sql, params);
  } finally {
    await db.exec("set app.uid = ''");
  }
}

/**
 * Run `sql` as a signed-in user through the API: the `authenticated` role,
 * so RLS policies and grants apply (unlike `as`, which stays superuser and
 * only sets auth.uid()).
 */
export async function asUser(db, uid, sql, params = []) {
  await db.exec(`set app.uid = '${uid}'; set role authenticated`);
  try {
    return await db.query(sql, params);
  } finally {
    await db.exec("reset role; set app.uid = ''");
  }
}

/** Like `asUser`, but returns the error message instead of throwing. */
export async function tryAsUser(db, uid, sql, params = []) {
  try {
    await asUser(db, uid, sql, params);
    return null;
  } catch (e) {
    return e.message;
  }
}

/** Like `as`, but returns the error message instead of throwing. */
export async function tryAs(db, uid, sql, params = []) {
  try {
    await as(db, uid, sql, params);
    return null;
  } catch (e) {
    return e.message;
  }
}

let seq = 0;
const uuid = () => {
  seq += 1;
  return `00000000-0000-4000-8000-${String(seq).padStart(12, "0")}`;
};

/**
 * A family (Europe/London) with one parent and `children` child profiles.
 * Creating the family seeds and activates its boss roster.
 */
export async function makeFamily(db, { children = 1 } = {}) {
  const familyId = uuid();
  await db.query("insert into public.families (id, name, timezone) values ($1, 'Test', 'Europe/London')", [familyId]);
  const parentId = uuid();
  const childIds = Array.from({ length: children }, uuid);
  for (const [id, role] of [[parentId, "parent"], ...childIds.map((id) => [id, "child"])]) {
    await db.query("insert into auth.users (id, email) values ($1, $2)", [id, `${id}@test`]);
    await db.query(
      `insert into public.profiles (id, family_id, display_name, role) values ($1, $2, $3, $4)
       on conflict (id) do update set family_id = excluded.family_id, role = excluded.role`,
      [id, familyId, role, role],
    );
  }
  return { familyId, parentId, childIds };
}

/** Monday of the week containing `day` (YYYY-MM-DD). */
export function mondayOf(day) {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}

export function addDays(day, n) {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** A weekly pool for a child in the week containing `day`. */
export async function makePool(db, { familyId, childId, day, minutes = 600 }) {
  const { rows } = await db.query(
    `insert into public.weekly_pools (family_id, child_id, week_start_date, title, total_minutes)
     values ($1, $2, $3, 'Quest', $4) returning id`,
    [familyId, childId, mondayOf(day), minutes],
  );
  return rows[0].id;
}

/** A scheduled slot (inserted as SQL, so any date is allowed). */
export async function makeSlot(db, { poolId, day, minutes }) {
  const { rows } = await db.query(
    "insert into public.task_slots (pool_id, scheduled_date, duration_minutes) values ($1, $2, $3) returning id",
    [poolId, day, minutes],
  );
  return rows[0].id;
}

export async function stats(db, childId) {
  const { rows } = await db.query(
    "select *, to_char(streak_through, 'YYYY-MM-DD') as streak_through from public.player_stats where child_id = $1",
    [childId],
  );
  return rows[0] ?? { xp: 0, level: 1, gold: 0, current_streak: 0, best_streak: 0, streak_through: null };
}

/** Give the family's active boss this much (max and current) HP. */
export async function setBossHp(db, familyId, hp) {
  await db.query("update public.bosses set max_hp = $2, current_hp = $2 where family_id = $1 and status = 'active'", [familyId, hp]);
}

export async function slot(db, id) {
  const { rows } = await db.query("select * from public.task_slots where id = $1", [id]);
  return rows[0];
}

export async function activeBoss(db, familyId) {
  const { rows } = await db.query("select * from public.bosses where family_id = $1 and status = 'active'", [familyId]);
  return rows[0] ?? null;
}

/** "Today" in Europe/London, as the database sees it. */
export async function londonToday(db) {
  const { rows } = await db.query("select to_char((now() at time zone 'Europe/London')::date, 'YYYY-MM-DD') as d");
  return rows[0].d;
}
