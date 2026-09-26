-- Family Quest: PROGRESS NEVER GOES BACKWARDS — Rogue's Night Raid, and the
-- end of boss escape / retreat and party HP (the 26 Sep 2026 rewind).
--
--   * NIGHT RAID: every perfect day (all of a child's quests that day done —
--     evaluate_streaks' perfect_days, frozen streaks included) earns a raid
--     on the active boss at the nightly reset: 5% of its max HP, rounded up
--     (so at least 1), never taking it below 1 HP — a raid never finishes a
--     boss; the next quest does. Raids go one at a time in a fixed order
--     (day, then child id), each clamped at 1 HP on its own. Each one is a
--     boss_log 'night_raid' row for that child, and counts toward his gold /
--     XP share when the boss is beaten (finish_boss splits by 'damage' +
--     'night_raid' since the boss's active_since — the current fight).
--     Idempotent like the streaks: only newly evaluated days raid, so a
--     re-run raids nothing and missed nights catch up (one raid per perfect
--     day). No active boss: no raid.
--   * The recap: reset_recaps.raid_damage / raids, per child (his own
--     raids that night).
--   * NO ESCAPE: finish_boss only ends a fight in a defeat ('escaped' is
--     refused); activation only draws from the queue. …15's retreat line,
--     HP bump and comeback bonus are gone. KEPT from …15: base_max_hp (a
--     boss's original HP, set on insert) and active_since (the current-fight
--     reward split).
--   * DORMANT, dropped in a later cleanup: bosses.retreats / escaped_at /
--     bosses_returning_idx; the 'escaped' boss status and the 'escaped' /
--     'miss_penalty' / 'comeback_bonus' log types (still allowed by the
--     constraints, never written); party_health, party_log, potions and
--     buy_potion (no longer callable through the API); reset_recaps'
--     party_damage / healed / knocked_out / escaped_boss_id / next_boss_id /
--     hp_before / hp_after / max_hp (defaulted, no longer written).
--   * tonight_stakes(): the raid on offer tonight (raid_damage, boss HP)
--     for the evening nudge; …12's damage / party_hp keys are gone.
--
-- Tunable: c_raid_pct in run_daily_reset() and tonight_stakes() (keep them
-- equal; lib/rpg/night-raid.ts mirrors it for on-screen wording, checked by
-- tests/night-raid.test.mjs).
--
-- Needs 20260928000014_streak_recovery.sql (this reset is built on its
-- streaks and rescues) and 20260929000015_boss_retreat.sql (base_max_hp,
-- active_since, activate_boss). Hand-applied in the SQL editor: one
-- transaction; the checks raise (rolling everything back) if the database
-- isn't in the expected state.

begin;

-- ---------------------------------------------------------------------------
-- 0. Pre-flight: …14 and …15 are in, and nothing has escaped or retreated.
-- ---------------------------------------------------------------------------
do $$
declare
  v_bad integer;
begin
  if to_regclass('public.streak_rescues') is null then
    raise exception 'night raid pre-flight: apply 20260928000014_streak_recovery.sql first';
  end if;
  if to_regprocedure('public.activate_boss(uuid, date, text)') is null then
    raise exception 'night raid pre-flight: apply 20260929000015_boss_retreat.sql first';
  end if;

  select count(*) into v_bad from public.bosses where status = 'escaped' or retreats > 0;
  if v_bad > 0 then
    raise exception 'night raid pre-flight: % boss(es) escaped or retreated — decide what happens to them first', v_bad;
  end if;

  select count(*) into v_bad from public.boss_log where event_type in ('escaped', 'comeback_bonus');
  if v_bad > 0 then
    raise exception 'night raid pre-flight: % escaped / comeback_bonus log row(s) exist', v_bad;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 1. Columns and constraints
-- ---------------------------------------------------------------------------
-- 'night_raid' joins the log types; the old ones stay allowed (dormant).
alter table public.boss_log drop constraint boss_log_event_type_check;
alter table public.boss_log add constraint boss_log_event_type_check
  check (event_type in (
    'damage', 'night_raid', 'miss_penalty', 'defeated', 'escaped', 'activated', 'gold_awarded', 'comeback_bonus'
  ));

-- His raids that night (0 / 0: none).
alter table public.reset_recaps
  add column raid_damage integer not null default 0 check (raid_damage >= 0),
  add column raids       integer not null default 0 check (raids >= 0);

-- The party columns are no longer written (dormant): give the not-null ones
-- defaults.
alter table public.reset_recaps
  alter column hp_before set default 0,
  alter column hp_after  set default 0,
  alter column max_hp    set default 0;

-- ---------------------------------------------------------------------------
-- 2. Activation: the next queued boss, at full HP
-- ---------------------------------------------------------------------------
-- p_after is kept for …15's callers: 'defeated' (finish_boss) or 'any' (the
-- nightly reset's step 0, a new family). Both now mean the same: the next
-- queued boss (low → mid → epic, then queue order). Escaped bosses never
-- come back. current_hp = max_hp (…06's rule — a parent's HP edit on a
-- queued boss holds); active_since starts the reward split's current fight.
create or replace function public.activate_boss(p_family_id uuid, p_today date, p_after text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if p_after not in ('defeated', 'any') then
    raise exception 'activate_boss: invalid reason %', p_after;
  end if;

  if exists (
    select 1 from public.bosses where family_id = p_family_id and status = 'active'
  ) then
    return null;
  end if;

  select id into v_id from public.bosses
    where family_id = p_family_id and status = 'inactive'
    order by case tier when 'low' then 1 when 'mid' then 2 else 3 end,
             queue_position, created_at
    limit 1
    for update;
  if v_id is null then
    return null;
  end if;

  update public.bosses
  set status = 'active',
      current_hp = max_hp,
      active_since = now(),
      -- Monday of the activation week.
      week_start_date = p_today - (extract(isodow from p_today)::integer - 1)
  where id = v_id;

  insert into public.boss_log (boss_id, event_type, amount)
  values (v_id, 'activated', 0);

  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Finishing a boss: a defeat only
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

  v_boss     public.bosses%rowtype;
  v_gold     integer;
  v_xp       integer;
  v_awards   jsonb := '[]'::jsonb;
  v_xp_rows  jsonb := '[]'::jsonb;
  v_next     uuid;
  r          record;
begin
  -- A boss is only ever beaten: it never escapes (…16).
  if p_outcome <> 'defeated' then
    raise exception 'finish_boss: invalid outcome %', p_outcome;
  end if;

  select * into v_boss from public.bosses where id = p_boss_id for update;
  if not found or v_boss.status <> 'active' then
    return jsonb_build_object('finished', false, 'boss_id', p_boss_id);
  end if;

  update public.bosses set status = 'defeated' where id = p_boss_id;

  v_gold := case v_boss.tier
    when 'low' then c_gold_low when 'mid' then c_gold_mid else c_gold_epic end;
  v_xp := case v_boss.tier
    when 'low' then c_xp_low when 'mid' then c_xp_mid else c_xp_epic end;

  insert into public.boss_log (boss_id, event_type, amount)
    values (p_boss_id, 'defeated', v_gold);

  -- Split gold and bonus XP by each child's share of the damage dealt to
  -- this boss IN THIS FIGHT (since its activation) — quest hits and Night
  -- Raids alike; the rounding remainder goes to the top damage dealer.
  for r in
    with dealt as (
      select child_id, sum(amount)::numeric as dmg
      from public.boss_log
      where boss_id = p_boss_id and event_type in ('damage', 'night_raid') and child_id is not null
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

  v_next := public.activate_boss(v_boss.family_id, p_today, 'defeated');

  return jsonb_build_object(
    'finished', true,
    'outcome', 'defeated',
    'boss_id', p_boss_id,
    'gold_awarded', v_awards,
    'xp_awarded', v_xp_rows,
    'activated', v_next
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. The nightly reset: …14's, plus the Night Raid
-- ---------------------------------------------------------------------------
create or replace function public.run_daily_reset(p_family_id uuid, p_today date default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  -- Tunable: a raid deals this % of the boss's max HP (rounded up).
  -- Keep equal to tonight_stakes()'s.
  c_raid_pct constant integer := 5;

  v_tz          text;
  v_today       date;
  v_boss        public.bosses%rowtype;
  v_has_boss    boolean;
  r             record;
  v_amount      integer;
  v_missed      integer := 0;
  v_missed_rows jsonb := '[]'::jsonb;
  v_finish      jsonb;
  v_awards      jsonb := '[]'::jsonb;
  v_defeated    uuid;
  v_activated   uuid;
  v_streaks     jsonb;
  v_raids       jsonb := '[]'::jsonb;
  v_raid_total  integer := 0;
  v_child       record;
  m             jsonb;
  st            jsonb;
  v_quests      integer;
  v_perfect     integer;
  v_recaps      integer := 0;
begin
  -- Serialize runs per family.
  select timezone into v_tz from public.families where id = p_family_id for update;
  if not found then
    raise exception 'family_not_found: %', p_family_id;
  end if;
  v_today := coalesce(p_today, (now() at time zone v_tz)::date);

  -- 0. Something to fight.
  v_activated := public.activate_next_boss(p_family_id, v_today);

  -- 1. Mark misses first (slot locks), before locking the boss — the same
  -- order the completion trigger uses. No penalty: a miss only feeds the
  -- streak (evaluate_streaks, below).
  for r in
    with missed as (
      update public.task_slots s
      set status = 'missed'
      from public.weekly_pools p
      where p.id = s.pool_id
        and p.family_id = p_family_id
        and s.status = 'scheduled'
        and s.scheduled_date < v_today
      returning p.child_id, s.duration_minutes, s.scheduled_date
    )
    select child_id, sum(duration_minutes)::integer as minutes, count(*)::integer as quests,
           min(scheduled_date) as day_from, max(scheduled_date) as day_to
    from missed group by child_id order by child_id
  loop
    v_missed := v_missed + r.minutes;
    v_missed_rows := v_missed_rows || jsonb_build_object(
      'child_id', r.child_id, 'minutes', r.minutes, 'quests', r.quests,
      'from', r.day_from, 'to', r.day_to);
  end loop;

  select * into v_boss from public.bosses
    where family_id = p_family_id and status = 'active' for update;
  v_has_boss := found;

  -- 2. Safety net: a boss left active at 0 HP is defeated (with its gold),
  -- and the raids go to whoever comes next (finish_boss has locked it).
  if v_has_boss and v_boss.current_hp = 0 then
    v_finish := public.finish_boss(v_boss.id, 'defeated', v_today);
    v_defeated := v_boss.id;
    v_awards := coalesce(v_finish -> 'gold_awarded', '[]'::jsonb);
    v_activated := coalesce((v_finish ->> 'activated')::uuid, v_activated);
    select * into v_boss from public.bosses
      where family_id = p_family_id and status = 'active' for update;
    v_has_boss := found;
  end if;

  -- 3. Streaks, after misses are marked (lock order: … → player_stats).
  v_streaks := public.evaluate_streaks(p_family_id, v_today);

  -- 4. Night Raids: one per newly evaluated perfect day, in (day, child)
  -- order, each clamped so the boss keeps at least 1 HP. The boss row is
  -- already locked.
  if v_has_boss then
    for r in
      select (st_row ->> 'child_id')::uuid as child_id, d::date as day
      from jsonb_array_elements(v_streaks) st_row,
           jsonb_array_elements_text(st_row -> 'perfect_days') d
      order by d::date, (st_row ->> 'child_id')::uuid
    loop
      v_amount := least((v_boss.max_hp * c_raid_pct + 99) / 100, v_boss.current_hp - 1);
      continue when v_amount <= 0;
      update public.bosses set current_hp = current_hp - v_amount
        where id = v_boss.id returning * into v_boss;
      insert into public.boss_log (boss_id, event_type, amount, child_id)
        values (v_boss.id, 'night_raid', v_amount, r.child_id);
      v_raids := v_raids || jsonb_build_object(
        'child_id', r.child_id, 'day', r.day, 'amount', v_amount, 'hp_after', v_boss.current_hp);
      v_raid_total := v_raid_total + v_amount;
    end loop;
  end if;

  -- 5. Recaps: a row for each child this run affected (his misses, perfect
  -- days or rescue events), with his own raids.
  for v_child in
    select id from public.profiles
    where family_id = p_family_id and role = 'child'
    order by id
  loop
    m := (select e from jsonb_array_elements(v_missed_rows) e
          where (e ->> 'child_id')::uuid = v_child.id limit 1);
    st := (select e from jsonb_array_elements(v_streaks) e
           where (e ->> 'child_id')::uuid = v_child.id limit 1);
    v_quests := coalesce((m ->> 'quests')::integer, 0);
    v_perfect := coalesce(jsonb_array_length(st -> 'perfect_days'), 0);
    continue when v_quests = 0 and v_perfect = 0
      and coalesce(jsonb_array_length(st -> 'rescue_events'), 0) = 0;

    insert into public.reset_recaps (
      family_id, child_id, day_from, day_to, missed_quests, missed_minutes,
      boss_id, perfect_days, streak_before, streak_after, rescue_events,
      raid_damage, raids)
    select
      p_family_id, v_child.id,
      least((m ->> 'from')::date, (st ->> 'from')::date),
      greatest((m ->> 'to')::date, (st ->> 'through')::date),
      v_quests, coalesce((m ->> 'minutes')::integer, 0),
      case when v_has_boss then v_boss.id end,
      v_perfect,
      coalesce((st ->> 'before')::integer, ps.current_streak, 0),
      coalesce((st ->> 'streak')::integer, ps.current_streak, 0),
      coalesce(st -> 'rescue_events', '[]'::jsonb),
      coalesce((select sum((x ->> 'amount')::integer) from jsonb_array_elements(v_raids) x
                where (x ->> 'child_id')::uuid = v_child.id), 0),
      (select count(*) from jsonb_array_elements(v_raids) x
        where (x ->> 'child_id')::uuid = v_child.id)
    from (select 1) one
    left join public.player_stats ps on ps.child_id = v_child.id;
    v_recaps := v_recaps + 1;
  end loop;

  return jsonb_build_object(
    'family_id', p_family_id,
    'today', v_today,
    'boss_id', case when v_has_boss then v_boss.id end,
    'missed_minutes', v_missed,
    'raids', v_raids,
    'raid_damage', v_raid_total,
    'defeated', v_defeated,
    'gold_awarded', v_awards,
    'activated', v_activated,
    'streaks', v_streaks,
    'recaps', v_recaps
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Tonight's stakes: the raid on offer (the evening nudge)
-- ---------------------------------------------------------------------------
-- raid_damage: what one raid would deal the active boss tonight (5% of its
-- max HP, rounded up, never below 1 HP left; 0 with no boss or a boss at
-- 1 HP). It doesn't guess at a brother or sister raiding first.
create or replace function public.tonight_stakes()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  -- Keep equal to run_daily_reset()'s.
  c_raid_pct constant integer := 5;

  v_uid     uuid := auth.uid();
  v_family  uuid;
  v_tz      text;
  v_today   date;
  v_boss    public.bosses%rowtype;
  v_has     boolean;
  v_mine    integer;
  v_open    integer;
  v_minutes integer;
  v_rescue  boolean;
begin
  select family_id into v_family from public.profiles where id = v_uid;
  if v_family is null then
    return null;
  end if;
  select timezone into v_tz from public.families where id = v_family;
  v_today := (now() at time zone v_tz)::date;

  select * into v_boss from public.bosses where family_id = v_family and status = 'active';
  v_has := found;

  select count(*) filter (where p.child_id = v_uid), count(*), coalesce(sum(s.duration_minutes), 0)
    into v_mine, v_open, v_minutes
    from public.task_slots s
    join public.weekly_pools p on p.id = s.pool_id
   where p.family_id = v_family and s.status = 'scheduled' and s.scheduled_date <= v_today;

  -- An open rescue: his streak is frozen.
  v_rescue := exists (select 1 from public.streak_rescues where child_id = v_uid and status = 'open');

  return jsonb_build_object(
    'today', v_today,
    'timezone', v_tz,
    'boss_active', v_has,
    'boss_name', case when v_has then v_boss.name end,
    'boss_hp', case when v_has then v_boss.current_hp end,
    'boss_max_hp', case when v_has then v_boss.max_hp end,
    'my_open_quests', v_mine,
    'open_quests', v_open,
    'open_minutes', v_minutes,
    'raid_damage', case when v_has
      then greatest(0, least((v_boss.max_hp * c_raid_pct + 99) / 100, v_boss.current_hp - 1))
      else 0 end,
    'rescue_open', v_rescue);
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. Privileges. create or replace keeps every function's grants (the
--    engine's revokes, tonight_stakes' grant to authenticated). Potions are
--    retired: buy_potion is no longer callable through the API.
-- ---------------------------------------------------------------------------
revoke all on function public.buy_potion(text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 7. Checks before committing
-- ---------------------------------------------------------------------------
do $$
begin
  if position('night_raid' in pg_get_functiondef('public.run_daily_reset(uuid, date)'::regprocedure)) = 0 then
    raise exception 'night raid check: run_daily_reset is not the Night Raid version';
  end if;
  if position('escaped' in pg_get_functiondef('public.activate_boss(uuid, date, text)'::regprocedure)) > 0 then
    raise exception 'night raid check: activate_boss still draws escaped bosses';
  end if;
  if has_function_privilege('authenticated', 'public.buy_potion(text)', 'execute') then
    raise exception 'night raid check: buy_potion is still callable by signed-in users';
  end if;
end $$;

commit;
