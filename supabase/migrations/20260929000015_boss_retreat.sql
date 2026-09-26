-- Family Quest: boss escape becomes a RETREAT — the boss comes back
-- (design signed off 25 Sep 2026).
--
--   * An escape (party knocked out at the nightly reset) still ends the fight
--     the same way — status 'escaped', an 'escaped' log row with the HP it had
--     left, no gold, the party refills, the next queued boss comes on — but
--     'escaped' now means "away, coming back", not gone for good. The boss
--     counts the retreat (bosses.retreats) and joins the line of returning
--     bosses (bosses.escaped_at: oldest first). Its damage progress is lost:
--     it returns at full HP.
--   * RETURN: after the party's next WIN (finish_boss 'defeated'), the
--     longest-waiting escaped boss comes back instead of the next queued one,
--     whatever its tier. An escape never brings a boss back (the next one
--     comes from the queue, so a boss is never re-picked on its own escape).
--     If an escape leaves nothing queued, the escaped boss returns at the next
--     nightly reset (its step 0, activate_next_boss).
--   * STRONGER: on return, max_hp = ceil(base_max_hp × (1 + 0.10 × retreats)),
--     retreats capped at 3 (+30%). base_max_hp is its original max HP. The
--     bump is applied at return, not at the escape, so the fleeing boss's row
--     (which the battle scene plays out) keeps its HP.
--   * COMEBACK BONUS: re-defeating a boss that has retreated pays an extra 50%
--     of its tier's gold and defeat XP (rounded up; flat — not more for more
--     retreats), split by damage share with the normal reward, inside the same
--     gold_awarded rows. A 'comeback_bonus' log row records the bonus gold.
--   * REWARD SPLIT FIX: finish_boss now splits by damage dealt in the CURRENT
--     fight only (boss_log.created_at >= bosses.active_since). Before, it summed
--     every damage row the boss ever took — harmless while a boss was only ever
--     fought once, wrong once it can come back. activate_next_boss sets
--     active_since on EVERY activation (first-time and returns).
--
-- Tunables: c_retreat_hp_pct / c_retreat_cap in activate_boss(),
-- c_comeback_pct in finish_boss().
--
-- Only the boss functions change: run_daily_reset / evaluate_streaks
-- (20260928000014) are untouched — the reset's escape path already goes
-- through finish_boss, and its step 0 through activate_next_boss. Apply
-- …14 first to keep the sequence.
--
-- Hand-applied in the SQL editor: all-or-nothing, and the checks at the end
-- raise (rolling everything back) if the backfill didn't hold.

begin;

-- ---------------------------------------------------------------------------
-- 1. Columns
-- ---------------------------------------------------------------------------
alter table public.bosses
  add column base_max_hp  integer,
  add column retreats     integer not null default 0 check (retreats >= 0),
  add column escaped_at   timestamptz,
  add column active_since timestamptz;

-- Backfill: every existing boss's original HP is its current max_hp (no boss
-- has been bumped yet — nothing retreated before this migration).
update public.bosses set base_max_hp = max_hp;
alter table public.bosses
  alter column base_max_hp set not null,
  add constraint bosses_base_max_hp_positive check (base_max_hp > 0);

-- Existing escaped bosses (if any) join the return line in escape order.
update public.bosses b
  set retreats = 1,
      escaped_at = coalesce(
        (select max(l.created_at) from public.boss_log l
          where l.boss_id = b.id and l.event_type = 'escaped'),
        b.created_at)
  where b.status = 'escaped';

-- The boss being fought now: its fight started at its latest activation
-- (fallback: its creation, so no damage already dealt is left out).
update public.bosses b
  set active_since = coalesce(
        (select max(l.created_at) from public.boss_log l
          where l.boss_id = b.id and l.event_type = 'activated'),
        b.created_at)
  where b.status = 'active';

-- New bosses (seed_family_bosses, a parent's insert) start with
-- base_max_hp = max_hp unless one is given.
create or replace function public.set_boss_base_max_hp()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.base_max_hp := coalesce(new.base_max_hp, new.max_hp);
  return new;
end;
$$;
create trigger bosses_set_base_max_hp
  before insert on public.bosses
  for each row execute function public.set_boss_base_max_hp();

-- The oldest escape first.
create index bosses_returning_idx on public.bosses (family_id, escaped_at)
  where status = 'escaped';

alter table public.boss_log drop constraint boss_log_event_type_check;
alter table public.boss_log add constraint boss_log_event_type_check
  check (event_type in (
    'damage', 'miss_penalty', 'defeated', 'escaped', 'activated', 'gold_awarded', 'comeback_bonus'
  ));

-- ---------------------------------------------------------------------------
-- 2. Activation: who comes on next
-- ---------------------------------------------------------------------------
-- p_after: why a boss is needed —
--   'defeated'  the party just won: the oldest escaped boss returns; else the
--               next queued boss.
--   'escaped'   the boss just fled: the next queued boss only (escaped bosses
--               wait for a win — and so the one that just fled isn't re-picked).
--   'any'       nothing is active (the nightly reset's step 0, a new family):
--               the next queued boss; else the oldest escaped boss.
-- Every activation sets active_since (the reward split counts damage from
-- then) and the week; a returning boss comes back stronger, at full HP.
create or replace function public.activate_boss(p_family_id uuid, p_today date, p_after text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  -- Tunables: +10% of its original max HP per retreat, up to 3 retreats.
  c_retreat_hp_pct constant integer := 10;
  c_retreat_cap    constant integer := 3;

  v_id uuid;
begin
  if p_after not in ('defeated', 'escaped', 'any') then
    raise exception 'activate_boss: invalid reason %', p_after;
  end if;

  if exists (
    select 1 from public.bosses where family_id = p_family_id and status = 'active'
  ) then
    return null;
  end if;

  if p_after = 'defeated' then
    select id into v_id from public.bosses
      where family_id = p_family_id and status = 'escaped'
      order by escaped_at, id
      limit 1
      for update;
  end if;

  if v_id is null then
    select id into v_id from public.bosses
      where family_id = p_family_id and status = 'inactive'
      order by case tier when 'low' then 1 when 'mid' then 2 else 3 end,
               queue_position, created_at
      limit 1
      for update;
  end if;

  if v_id is null and p_after = 'any' then
    select id into v_id from public.bosses
      where family_id = p_family_id and status = 'escaped'
      order by escaped_at, id
      limit 1
      for update;
  end if;

  if v_id is null then
    return null;
  end if;

  -- max_hp: the original, +10% per retreat (capped), rounded up — integer
  -- maths, so 60 × 1.1 is exactly 66. First-time bosses have retreats = 0.
  update public.bosses
  set status = 'active',
      max_hp = (base_max_hp * (100 + c_retreat_hp_pct * least(retreats, c_retreat_cap)) + 99) / 100,
      current_hp = (base_max_hp * (100 + c_retreat_hp_pct * least(retreats, c_retreat_cap)) + 99) / 100,
      active_since = now(),
      -- Monday of the activation week.
      week_start_date = p_today - (extract(isodow from p_today)::integer - 1)
  where id = v_id;

  insert into public.boss_log (boss_id, event_type, amount)
  values (v_id, 'activated', 0);

  return v_id;
end;
$$;

-- The existing entry point (the nightly reset's step 0, the new-family
-- trigger, hand-run scripts): "nothing is active".
create or replace function public.activate_next_boss(p_family_id uuid, p_today date)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
begin
  return public.activate_boss(p_family_id, p_today, 'any');
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Finishing a boss: …11's, plus the retreat bookkeeping, the comeback
--    bonus and the current-fight reward split
-- ---------------------------------------------------------------------------
create or replace function public.finish_boss(p_boss_id uuid, p_outcome text, p_today date)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  -- Tunables: gold and bonus XP for defeating a boss, by tier.
  c_gold_low  constant integer := 25;
  c_gold_mid  constant integer := 50;
  c_gold_epic constant integer := 100;
  c_xp_low    constant integer := 50;
  c_xp_mid    constant integer := 100;
  c_xp_epic   constant integer := 200;
  -- Re-defeating a boss that retreated: +50% gold and XP (flat).
  c_comeback_pct constant integer := 50;

  v_boss     public.bosses%rowtype;
  v_gold     integer;
  v_xp       integer;
  v_bonus_gold integer := 0;
  v_bonus_xp   integer := 0;
  v_awards   jsonb := '[]'::jsonb;
  v_xp_rows  jsonb := '[]'::jsonb;
  v_next     uuid;
  r          record;
begin
  if p_outcome not in ('defeated', 'escaped') then
    raise exception 'finish_boss: invalid outcome %', p_outcome;
  end if;

  select * into v_boss from public.bosses where id = p_boss_id for update;
  if not found or v_boss.status <> 'active' then
    return jsonb_build_object('finished', false, 'boss_id', p_boss_id);
  end if;

  if p_outcome = 'defeated' then
    update public.bosses set status = 'defeated' where id = p_boss_id;

    v_gold := case v_boss.tier
      when 'low' then c_gold_low when 'mid' then c_gold_mid else c_gold_epic end;
    v_xp := case v_boss.tier
      when 'low' then c_xp_low when 'mid' then c_xp_mid else c_xp_epic end;
    if v_boss.retreats > 0 then
      v_bonus_gold := (v_gold * c_comeback_pct + 99) / 100;
      v_bonus_xp := (v_xp * c_comeback_pct + 99) / 100;
      v_gold := v_gold + v_bonus_gold;
      v_xp := v_xp + v_bonus_xp;
    end if;

    -- 'defeated' carries the whole gold pool (bonus included), as before.
    insert into public.boss_log (boss_id, event_type, amount)
      values (p_boss_id, 'defeated', v_gold);
    if v_bonus_gold > 0 then
      insert into public.boss_log (boss_id, event_type, amount)
        values (p_boss_id, 'comeback_bonus', v_bonus_gold);
    end if;

    -- Split gold and bonus XP by each child's share of the damage dealt to
    -- this boss IN THIS FIGHT (since its activation); the rounding remainder
    -- goes to the top damage dealer.
    for r in
      with dealt as (
        select child_id, sum(amount)::numeric as dmg
        from public.boss_log
        where boss_id = p_boss_id and event_type = 'damage' and child_id is not null
          and created_at >= coalesce(v_boss.active_since, '-infinity'::timestamptz)
        group by child_id
      ),
      shares as (
        select child_id, dmg,
               floor(v_gold * dmg / sum(dmg) over ())::integer as gold_base,
               floor(v_xp * dmg / sum(dmg) over ())::integer as xp_base,
               row_number() over (order by dmg desc, child_id) as rn
        from dealt
      )
      select child_id,
             gold_base + case when rn = 1 then v_gold - (sum(gold_base) over ())::integer else 0 end as gold,
             xp_base + case when rn = 1 then v_xp - (sum(xp_base) over ())::integer else 0 end as xp
      from shares
      order by rn
    loop
      if r.gold > 0 then
        insert into public.player_stats (child_id, gold) values (r.child_id, r.gold)
          on conflict (child_id) do update
          set gold = public.player_stats.gold + excluded.gold;
        insert into public.boss_log (boss_id, event_type, amount, child_id)
          values (p_boss_id, 'gold_awarded', r.gold, r.child_id);
        v_awards := v_awards || jsonb_build_object('child_id', r.child_id, 'gold', r.gold);
      end if;
      if r.xp > 0 then
        perform public.award_xp(r.child_id, r.xp);
        v_xp_rows := v_xp_rows || jsonb_build_object('child_id', r.child_id, 'xp', r.xp);
      end if;
    end loop;
  else
    -- A retreat: it joins the return line (counted, stamped). Its HP isn't
    -- touched here — the bump is applied when it returns.
    update public.bosses
      set status = 'escaped', retreats = retreats + 1, escaped_at = now()
      where id = p_boss_id;
    insert into public.boss_log (boss_id, event_type, amount)
      values (p_boss_id, 'escaped', v_boss.current_hp);
  end if;

  v_next := public.activate_boss(v_boss.family_id, p_today, p_outcome);

  return jsonb_build_object(
    'finished', true,
    'outcome', p_outcome,
    'boss_id', p_boss_id,
    'gold_awarded', v_awards,
    'xp_awarded', v_xp_rows,
    'comeback_bonus', jsonb_build_object('gold', v_bonus_gold, 'xp', v_bonus_xp),
    'activated', v_next
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Privileges: engine internals, service role / definer functions only.
--    (create or replace keeps finish_boss' and activate_next_boss' revokes;
--    the new functions get Supabase's default grants, so revoke them.)
-- ---------------------------------------------------------------------------
revoke all on function public.activate_boss(uuid, date, text) from public, anon, authenticated;
revoke all on function public.set_boss_base_max_hp() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. Checks before committing: any failure raises and rolls it all back.
-- ---------------------------------------------------------------------------
do $$
declare
  v_bad integer;
begin
  select count(*) into v_bad from public.bosses
    where base_max_hp is null or (retreats = 0 and base_max_hp <> max_hp);
  if v_bad > 0 then
    raise exception 'boss retreat check: % boss(es) with a missing / wrong base_max_hp', v_bad;
  end if;

  select count(*) into v_bad from public.bosses
    where status = 'active' and active_since is null;
  if v_bad > 0 then
    raise exception 'boss retreat check: % active boss(es) without active_since', v_bad;
  end if;

  select count(*) into v_bad from public.bosses
    where status = 'escaped' and (escaped_at is null or retreats < 1);
  if v_bad > 0 then
    raise exception 'boss retreat check: % escaped boss(es) not in the return line', v_bad;
  end if;
end $$;

-- For the eye (the SQL editor shows the last result set): every family's
-- roster by status, with the backfilled HP.
select f.name as family,
       count(*)                                         as bosses,
       count(*) filter (where b.status = 'active')      as active,
       count(*) filter (where b.status = 'inactive')    as queued,
       count(*) filter (where b.status = 'defeated')    as defeated,
       count(*) filter (where b.status = 'escaped')     as returning,
       bool_and(b.base_max_hp = b.max_hp)               as base_hp_matches,
       max(b.active_since)                              as active_since
  from public.bosses b
  join public.families f on f.id = b.family_id
 group by f.name
 order by f.name;

commit;
