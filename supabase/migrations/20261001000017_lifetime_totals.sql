-- Family Quest: lifetime stat counters per child (player_stats), written
-- ONLY by the game engine, incremented once at the moment of the real event
-- and never decremented.
--
--   * total_damage_dealt: += the damage amount in strike_active_boss() (quest
--     ticks and rescue jobs; the logged amount, overkill included — the same
--     number boss_log / the Trophy Case record), and += each Night Raid in
--     run_daily_reset().
--   * total_quests_completed: +1 in strike_boss_on_completion()'s xp_awarded
--     branch (once per slot, boss or no boss); +1 in complete_rescue() (a
--     job rescue). A FALLBACK (no-jobs) rescue adds nothing of its own: the
--     quest that satisfied it already counted when it was ticked.
--   * total_bosses_defeated: +1 in finish_boss() for every distinct child
--     with at least one 'damage' or 'night_raid' row against the boss since
--     its active_since (the current fight) — not only gold recipients.
--   * No backfill: all three start at 0.
--
-- ENGINE-ONLY WRITES (new pattern; nothing like it existed before):
--   * public.bump_player_totals(child, damage, quests, bosses) is the one
--     writer. It sets the transaction-local setting app.engine_stats_write =
--     'on', upserts the increments, and sets it back to 'off'. It's
--     SECURITY DEFINER and revoked from every API role.
--   * Trigger player_stats_guard_totals (BEFORE INSERT OR UPDATE) rejects
--     any change to the three columns unless that setting is 'on' — for
--     every caller: the child, a parent through the API (RLS "player_stats:
--     parents write" still lets parents write the OTHER columns), even SQL —
--     and rejects a decrease even from the engine. The setting can't be set
--     through the API (PostgREST exposes no set_config).
--   * 'reset' is the one escape: the hand-run
--     supabase/scripts/reset-family-progress.sql sets it for its own
--     transaction to zero the counters.
--   * DELETE on player_stats is revoked from anon / authenticated: deleting
--     a child's row would wipe his totals. (No app code deletes it; a
--     profile / family delete still cascades — referential actions run with
--     the table owner's rights.)
--
-- Redefines, from their current versions (…14 / …16) with only the bump
-- calls added: strike_active_boss, strike_boss_on_completion,
-- complete_rescue, finish_boss, run_daily_reset. (evaluate_streaks is
-- untouched.)
-- Lock order unchanged: player_stats is still taken last.
--
-- Hand-applied in the SQL editor: one transaction; the checks at the end
-- raise (rolling everything back) if anything is off.

begin;

-- ---------------------------------------------------------------------------
-- 1. Columns
-- ---------------------------------------------------------------------------
alter table public.player_stats
  add column total_damage_dealt     integer not null default 0 check (total_damage_dealt >= 0),
  add column total_quests_completed integer not null default 0 check (total_quests_completed >= 0),
  add column total_bosses_defeated  integer not null default 0 check (total_bosses_defeated >= 0);

-- ---------------------------------------------------------------------------
-- 2. The one writer, and the guard
-- ---------------------------------------------------------------------------
create or replace function public.bump_player_totals(
  p_child_id uuid, p_damage integer, p_quests integer, p_bosses integer
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_child_id is null then
    return;
  end if;
  if p_damage < 0 or p_quests < 0 or p_bosses < 0 then
    raise exception 'bump_player_totals: increments must be >= 0 (% / % / %)', p_damage, p_quests, p_bosses;
  end if;
  if p_damage = 0 and p_quests = 0 and p_bosses = 0 then
    return;
  end if;

  perform set_config('app.engine_stats_write', 'on', true);
  insert into public.player_stats (child_id, total_damage_dealt, total_quests_completed, total_bosses_defeated)
    values (p_child_id, p_damage, p_quests, p_bosses)
    on conflict (child_id) do update
    set total_damage_dealt     = public.player_stats.total_damage_dealt + excluded.total_damage_dealt,
        total_quests_completed = public.player_stats.total_quests_completed + excluded.total_quests_completed,
        total_bosses_defeated  = public.player_stats.total_bosses_defeated + excluded.total_bosses_defeated;
  perform set_config('app.engine_stats_write', 'off', true);
end;
$$;

create or replace function public.guard_player_stats_totals()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_mode text := coalesce(current_setting('app.engine_stats_write', true), '');
begin
  -- The hand-run reset script only.
  if v_mode = 'reset' then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if (new.total_damage_dealt <> 0 or new.total_quests_completed <> 0 or new.total_bosses_defeated <> 0)
       and v_mode <> 'on' then
      raise exception 'player_stats_totals_engine_only: lifetime totals are written by the game engine'
        using errcode = 'insufficient_privilege';
    end if;
    return new;
  end if;

  if (new.total_damage_dealt, new.total_quests_completed, new.total_bosses_defeated)
     is not distinct from (old.total_damage_dealt, old.total_quests_completed, old.total_bosses_defeated) then
    return new;
  end if;
  if v_mode <> 'on' then
    raise exception 'player_stats_totals_engine_only: lifetime totals are written by the game engine'
      using errcode = 'insufficient_privilege';
  end if;
  if new.total_damage_dealt < old.total_damage_dealt
     or new.total_quests_completed < old.total_quests_completed
     or new.total_bosses_defeated < old.total_bosses_defeated then
    raise exception 'player_stats_totals_never_decrease: lifetime totals only go up';
  end if;
  return new;
end;
$$;

create trigger player_stats_guard_totals
  before insert or update on public.player_stats
  for each row execute function public.guard_player_stats_totals();

-- ---------------------------------------------------------------------------
-- 3. The increments (current definitions, bump calls added)
-- ---------------------------------------------------------------------------
create or replace function public.strike_active_boss(
  p_family_id uuid, p_child_id uuid, p_amount integer, p_slot_id uuid, p_today date
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_boss public.bosses%rowtype;
begin
  select * into v_boss from public.bosses
    where family_id = p_family_id and status = 'active'
    for update;
  if not found then
    return false;
  end if;

  update public.bosses
    set current_hp = greatest(0, current_hp - p_amount)
    where id = v_boss.id
    returning * into v_boss;

  insert into public.boss_log (boss_id, event_type, amount, child_id, source_task_slot_id)
    values (v_boss.id, 'damage', p_amount, p_child_id, p_slot_id);
  -- …17: his lifetime damage (the logged amount, as the Trophy Case sums it).
  perform public.bump_player_totals(p_child_id, p_amount, 0, 0);

  if v_boss.current_hp = 0 then
    perform public.finish_boss(v_boss.id, 'defeated', p_today);
  end if;
  return true;
end;
$$;

create or replace function public.strike_boss_on_completion()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  -- Tunables: 1 minute = 1 damage = 1 XP.
  c_damage_per_minute constant integer := 1;
  c_xp_per_minute     constant integer := 1;

  v_family_id uuid;
  v_child_id  uuid;
  v_tz        text;
begin
  -- Only the transition into 'completed'; damage and XP once each.
  if new.status <> 'completed' or old.status = 'completed' then
    return new;
  end if;
  if new.applied_to_boss and new.xp_awarded then
    return new;
  end if;

  select p.family_id, p.child_id, f.timezone
    into v_family_id, v_child_id, v_tz
  from public.weekly_pools p
  join public.families f on f.id = p.family_id
  where p.id = new.pool_id;

  -- Damage first (lock order: slot → boss → player_stats). No active boss:
  -- the slot stays unapplied (but still earns XP below, and xp_awarded
  -- locks it).
  if not new.applied_to_boss then
    if public.strike_active_boss(
      v_family_id, v_child_id, new.duration_minutes * c_damage_per_minute, new.id,
      (now() at time zone v_tz)::date
    ) then
      new.applied_to_boss := true;
    end if;
  end if;

  -- XP, whether or not a boss was hit.
  if not new.xp_awarded then
    perform public.award_xp(v_child_id, new.duration_minutes * c_xp_per_minute);
    new.xp_awarded := true;
    -- …17: a completed quest, counted once per slot (xp_awarded locks it).
    perform public.bump_player_totals(v_child_id, 0, 1, 0);
  end if;

  return new;
end;
$$;

create or replace function public.complete_rescue(p_rescue_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  c_damage_per_minute constant integer := 1;
  c_xp_per_minute     constant integer := 1;

  v_rescue public.streak_rescues%rowtype;
  v_family uuid;
  v_tz     text;
  v_today  date;
  v_hit    boolean;
begin
  select family_id into v_family from public.streak_rescues
    where id = p_rescue_id and child_id = auth.uid();
  if not found then
    raise exception 'rescue_not_found' using errcode = 'P0002';
  end if;
  select timezone into v_tz from public.families where id = v_family;
  v_today := (now() at time zone v_tz)::date;

  -- Lock order: boss → rescue → player_stats (as the nightly reset).
  perform 1 from public.bosses where family_id = v_family and status = 'active' for update;
  select * into v_rescue from public.streak_rescues where id = p_rescue_id for update;

  if v_rescue.status <> 'open' or v_rescue.completed_at is not null then
    raise exception 'rescue_closed';
  end if;
  if v_rescue.fallback then
    raise exception 'rescue_fallback';   -- done by finishing any quest instead
  end if;
  if v_rescue.job_id is null then
    raise exception 'rescue_not_picked';
  end if;
  if v_today > v_rescue.due_on then
    raise exception 'rescue_overdue';
  end if;

  update public.streak_rescues
    set completed_at = now(), completed_on = v_today
    where id = p_rescue_id
    returning * into v_rescue;

  v_hit := public.strike_active_boss(
    v_family, v_rescue.child_id, v_rescue.minutes * c_damage_per_minute, null, v_today);
  perform public.award_xp(v_rescue.child_id, v_rescue.minutes * c_xp_per_minute);
  -- …17: a finished rescue job counts as a completed quest (once: a second
  -- call raises rescue_closed above).
  perform public.bump_player_totals(v_rescue.child_id, 0, 1, 0);

  return jsonb_build_object('rescue', to_jsonb(v_rescue), 'boss_hit', v_hit);
end;
$$;

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

  -- …17: a boss defeated for EVERY child who hit it in this fight (quest
  -- hits and Night Raids since active_since) — not just gold recipients.
  -- Child-id order (player_stats locks in a fixed order).
  for r in
    select distinct child_id
    from public.boss_log
    where boss_id = p_boss_id and event_type in ('damage', 'night_raid') and child_id is not null
      and created_at >= coalesce(v_boss.active_since, '-infinity'::timestamptz)
    order by child_id
  loop
    perform public.bump_player_totals(r.child_id, 0, 0, 1);
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
      -- …17: his lifetime damage.
      perform public.bump_player_totals(r.child_id, v_amount, 0, 0);
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
-- 4. Privileges. create or replace keeps the redefined functions' grants
--    (complete_rescue stays callable by signed-in users; the rest engine /
--    service role only). The new functions get Supabase's default grants:
--    revoke them. No deleting a child's stats row through the API.
-- ---------------------------------------------------------------------------
revoke all on function public.bump_player_totals(uuid, integer, integer, integer) from public, anon, authenticated;
revoke all on function public.guard_player_stats_totals() from public, anon, authenticated;
revoke delete on public.player_stats from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. Checks before committing: any failure raises and rolls it all back.
-- ---------------------------------------------------------------------------
do $$
declare
  v_fn text;
begin
  foreach v_fn in array array[
    'public.strike_active_boss(uuid, uuid, integer, uuid, date)',
    'public.strike_boss_on_completion()',
    'public.complete_rescue(uuid)',
    'public.finish_boss(uuid, text, date)',
    'public.run_daily_reset(uuid, date)'
  ] loop
    if position('bump_player_totals' in pg_get_functiondef(v_fn::regprocedure)) = 0 then
      raise exception 'lifetime totals check: % does not bump the totals', v_fn;
    end if;
  end loop;
  if position('night_raid' in pg_get_functiondef('public.run_daily_reset(uuid, date)'::regprocedure)) = 0 then
    raise exception 'lifetime totals check: run_daily_reset lost the Night Raid';
  end if;
  if has_function_privilege('authenticated', 'public.bump_player_totals(uuid, integer, integer, integer)', 'execute') then
    raise exception 'lifetime totals check: bump_player_totals is callable by signed-in users';
  end if;
  if has_table_privilege('authenticated', 'public.player_stats', 'delete') then
    raise exception 'lifetime totals check: signed-in users can still delete player_stats rows';
  end if;
  if exists (select 1 from public.player_stats
              where total_damage_dealt <> 0 or total_quests_completed <> 0 or total_bosses_defeated <> 0) then
    raise exception 'lifetime totals check: totals should all start at 0';
  end if;
end $$;

commit;
