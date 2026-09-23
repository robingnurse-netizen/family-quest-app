-- Family Quest: XP, levels and streaks (plus a guard fix).
--
--   1. XP: 1 XP per minute of a completed quest, to the pool's child, in the
--      same transaction as the instant boss damage (the strike trigger).
--      Awarded exactly once per slot — with or without an active boss —
--      tracked by task_slots.xp_awarded, which (like applied_to_boss) locks
--      the slot for a child: no un-tick / re-tick farming.
--   2. Defeat bonus XP: 50 (low) / 100 (mid) / 200 (epic), split by damage
--      share like the gold (remainder to the top damage dealer).
--   3. Levels: total XP to reach level L = xp_for_level(L) = 50·L·(L−1)
--      (level 2 at 100, 5 at 1,000, 10 at 4,500). THE CURVE LIVES ONLY IN
--      xp_for_level(); lib/rpg/levels.ts mirrors it for the UI and a test
--      checks they agree. Level is recomputed whenever XP is added.
--   4. Streaks, evaluated by the nightly reset per child, day by day in
--      order from the day after player_stats.streak_through up to
--      yesterday: a day with quests, all completed → +1 (best_streak kept);
--      any missed → 0; nothing scheduled → no change. Idempotent (the
--      "through" date only moves forward) and it catches up over several
--      missed nights. Judged by each quest's scheduled day.
--   5. Guard fix: 20260924000010 rebuilt guard_child_task_slot_writes()
--      from the original (…05) guard and so dropped the `slot_locked` rule
--      added in …08 (no status change once a slot's damage is dealt). It's
--      restored here, extended to xp_awarded.
--   No backfill: slots already completed are marked xp_awarded (and so
--   locked, like applied ones) without awarding anything.
--
-- TRIGGER ORDER (unchanged names): BEFORE triggers fire in name order —
--   task_slots_check_allocation → task_slots_guard_child_writes
--   → task_slots_set_completed_at → task_slots_strike_boss
-- so the guard sees the child's request before the strike trigger sets
-- applied_to_boss / xp_awarded.
--
-- LOCK ORDER: slot → boss → player_stats everywhere (XP is awarded after
-- the boss step in the trigger; the nightly job marks misses, then the
-- boss, then gold/XP, then streaks), so the two can't deadlock.

-- ---------------------------------------------------------------------------
-- Columns
-- ---------------------------------------------------------------------------
alter table public.task_slots
  add column if not exists xp_awarded boolean not null default false;

alter table public.player_stats
  add column if not exists best_streak integer not null default 0 check (best_streak >= 0),
  add column if not exists streak_through date;

-- No backfill: already-completed quests count as awarded (no XP granted).
update public.task_slots set xp_awarded = true where status = 'completed' and not xp_awarded;

-- ---------------------------------------------------------------------------
-- Level curve + XP award
-- ---------------------------------------------------------------------------
-- Total XP needed to reach `p_level`. Tune the curve HERE only (and in its
-- mirror, lib/rpg/levels.ts — tests/xp-level-streak.test.mjs checks both).
create or replace function public.xp_for_level(p_level integer)
returns integer
language sql
immutable
set search_path = ''
as $$
  select 50 * greatest(p_level, 1) * (greatest(p_level, 1) - 1)
$$;

-- The level reached with `p_xp` total XP (at least 1).
create or replace function public.level_for_xp(p_xp integer)
returns integer
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_level integer := 1;
begin
  while public.xp_for_level(v_level + 1) <= p_xp loop
    v_level := v_level + 1;
  end loop;
  return v_level;
end;
$$;

-- Add XP to a child and bring their level up to date.
create or replace function public.award_xp(p_child_id uuid, p_amount integer)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_amount is null or p_amount <= 0 then
    return;
  end if;
  insert into public.player_stats (child_id, xp, level)
    values (p_child_id, p_amount, public.level_for_xp(p_amount))
    on conflict (child_id) do update
    set xp = public.player_stats.xp + excluded.xp,
        level = public.level_for_xp(public.player_stats.xp + excluded.xp);
end;
$$;

-- ---------------------------------------------------------------------------
-- End of a boss: as in 20260923000008, plus the defeat XP bonus.
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
  if p_outcome not in ('defeated', 'escaped') then
    raise exception 'finish_boss: invalid outcome %', p_outcome;
  end if;

  select * into v_boss from public.bosses where id = p_boss_id for update;
  if not found or v_boss.status <> 'active' then
    return jsonb_build_object('finished', false, 'boss_id', p_boss_id);
  end if;

  update public.bosses set status = p_outcome where id = p_boss_id;

  if p_outcome = 'defeated' then
    v_gold := case v_boss.tier
      when 'low' then c_gold_low when 'mid' then c_gold_mid else c_gold_epic end;
    v_xp := case v_boss.tier
      when 'low' then c_xp_low when 'mid' then c_xp_mid else c_xp_epic end;
    insert into public.boss_log (boss_id, event_type, amount)
      values (p_boss_id, 'defeated', v_gold);

    -- Split gold and bonus XP by each child's share of the damage dealt to
    -- this boss; the rounding remainder goes to the top damage dealer.
    for r in
      with dealt as (
        select child_id, sum(amount)::numeric as dmg
        from public.boss_log
        where boss_id = p_boss_id and event_type = 'damage' and child_id is not null
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
    insert into public.boss_log (boss_id, event_type, amount)
      values (p_boss_id, 'escaped', v_boss.current_hp);
  end if;

  v_next := public.activate_next_boss(v_boss.family_id, p_today);

  return jsonb_build_object(
    'finished', true,
    'outcome', p_outcome,
    'boss_id', p_boss_id,
    'gold_awarded', v_awards,
    'xp_awarded', v_xp_rows,
    'activated', v_next
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Completion: instant damage (as in …08) + XP, each exactly once per slot.
-- ---------------------------------------------------------------------------
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
  v_boss      public.bosses%rowtype;
  v_amount    integer;
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

  -- Damage first (lock order: slot → boss → player_stats).
  if not new.applied_to_boss then
    select * into v_boss from public.bosses
      where family_id = v_family_id and status = 'active'
      for update;
    if found then
      v_amount := new.duration_minutes * c_damage_per_minute;

      update public.bosses
        set current_hp = greatest(0, current_hp - v_amount)
        where id = v_boss.id
        returning * into v_boss;

      insert into public.boss_log (boss_id, event_type, amount, child_id, source_task_slot_id)
        values (v_boss.id, 'damage', v_amount, v_child_id, new.id);

      new.applied_to_boss := true;

      if v_boss.current_hp = 0 then
        perform public.finish_boss(v_boss.id, 'defeated', (now() at time zone v_tz)::date);
      end if;
    end if;
    -- No active boss: the slot stays unapplied (but still earns XP below,
    -- and xp_awarded locks it).
  end if;

  -- XP, whether or not a boss was hit.
  if not new.xp_awarded then
    perform public.award_xp(v_child_id, new.duration_minutes * c_xp_per_minute);
    new.xp_awarded := true;
  end if;

  return new;
end;
$$;
-- (Trigger task_slots_strike_boss from …08 is unchanged and keeps its name.)

-- ---------------------------------------------------------------------------
-- Child guard: …10's rules + the restored slot lock, extended to XP.
-- ---------------------------------------------------------------------------
create or replace function public.guard_child_task_slot_writes()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_today date;
begin
  -- Only child accounts are restricted. The service role and SQL sessions
  -- have no auth.uid(), so this lookup finds nothing for them.
  -- (A BEFORE DELETE trigger must return OLD — returning NULL/NEW would
  -- silently cancel the delete.)
  if not exists (
    select 1 from public.profiles where id = auth.uid() and role = 'child'
  ) then
    if tg_op = 'DELETE' then
      return old;
    end if;
    return new;
  end if;

  if tg_op = 'DELETE' then
    if old.status <> 'scheduled' or old.applied_to_boss or old.xp_awarded then
      raise exception 'slot_child_forbidden: only scheduled slots can be removed'
        using errcode = 'insufficient_privilege';
    end if;
    return old;
  end if;

  -- No planning on past days: a new slot, or a move to another date.
  if tg_op = 'INSERT' or new.scheduled_date is distinct from old.scheduled_date then
    select (now() at time zone f.timezone)::date
      into v_today
      from public.weekly_pools p
      join public.families f on f.id = p.family_id
     where p.id = new.pool_id;
    if v_today is not null and new.scheduled_date < v_today then
      raise exception 'slot_past_day: % is before today (%)', new.scheduled_date, v_today
        using errcode = 'insufficient_privilege';
    end if;
  end if;

  if tg_op = 'INSERT' then
    if new.status <> 'scheduled' then
      raise exception 'slot_child_forbidden: new slots must start as scheduled'
        using errcode = 'insufficient_privilege';
    end if;
    if new.applied_to_boss or new.xp_awarded then
      raise exception 'slot_child_forbidden: applied_to_boss / xp_awarded are set by the game engine'
        using errcode = 'insufficient_privilege';
    end if;
    return new;
  end if;

  -- UPDATE
  if new.applied_to_boss is distinct from old.applied_to_boss
     or new.xp_awarded is distinct from old.xp_awarded then
    raise exception 'slot_child_forbidden: applied_to_boss / xp_awarded are set by the game engine'
      using errcode = 'insufficient_privilege';
  end if;
  -- Restored from …08 (lost in …10): once a slot's damage or XP has been
  -- dealt, its status is final — no un-tick / re-tick.
  if (old.applied_to_boss or old.xp_awarded) and new.status is distinct from old.status then
    raise exception 'slot_locked: this slot''s damage has already been dealt'
      using errcode = 'insufficient_privilege';
  end if;
  if new.status is distinct from old.status
     and not (old.status in ('scheduled', 'completed')
              and new.status in ('scheduled', 'completed')) then
    raise exception 'slot_child_forbidden: status can only toggle between scheduled and completed'
      using errcode = 'insufficient_privilege';
  end if;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Streaks (called by the nightly reset, after misses are marked)
-- ---------------------------------------------------------------------------
create or replace function public.evaluate_streaks(p_family_id uuid, p_today date)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_child   record;
  v_stats   public.player_stats%rowtype;
  v_from    date;
  v_day     date;
  v_streak  integer;
  v_best    integer;
  v_total   integer;
  v_missed  integer;
  v_done    integer;
  v_out     jsonb := '[]'::jsonb;
begin
  for v_child in
    select id from public.profiles
    where family_id = p_family_id and role = 'child'
    order by id
  loop
    insert into public.player_stats (child_id) values (v_child.id)
      on conflict (child_id) do nothing;
    select * into v_stats from public.player_stats
      where child_id = v_child.id for update;

    -- First evaluation looks at yesterday only (no backfill).
    v_from := coalesce(v_stats.streak_through + 1, p_today - 1);
    continue when v_from > p_today - 1;

    v_streak := v_stats.current_streak;
    v_best := v_stats.best_streak;
    for v_day in
      select d::date from generate_series(v_from, p_today - 1, interval '1 day') d
    loop
      select count(*),
             count(*) filter (where s.status = 'missed'),
             count(*) filter (where s.status = 'completed')
        into v_total, v_missed, v_done
        from public.task_slots s
        join public.weekly_pools p on p.id = s.pool_id
       where p.child_id = v_child.id and s.scheduled_date = v_day;

      if v_total = 0 then
        null;                         -- rest day: no change
      elsif v_missed > 0 then
        v_streak := 0;                -- any miss breaks it
      elsif v_done = v_total then
        v_streak := v_streak + 1;     -- everything done
        v_best := greatest(v_best, v_streak);
      end if;
    end loop;

    update public.player_stats
      set current_streak = v_streak,
          best_streak = v_best,
          streak_through = p_today - 1
      where child_id = v_child.id;

    v_out := v_out || jsonb_build_object(
      'child_id', v_child.id, 'streak', v_streak, 'best', v_best, 'through', p_today - 1);
  end loop;
  return v_out;
end;
$$;

-- ---------------------------------------------------------------------------
-- Nightly reset: as in …08, plus streak evaluation at the end.
-- ---------------------------------------------------------------------------
create or replace function public.run_daily_reset(p_family_id uuid, p_today date default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  -- Tunable
  c_penalty_per_minute constant integer := 1;

  v_tz          text;
  v_today       date;
  v_party       public.party_health%rowtype;
  v_boss        public.bosses%rowtype;
  v_has_boss    boolean;
  r             record;
  v_amount      integer;
  v_penalty     integer := 0;
  v_missed      integer := 0;
  v_missed_rows jsonb := '[]'::jsonb;
  v_finish      jsonb;
  v_awards      jsonb := '[]'::jsonb;
  v_defeated    uuid;
  v_escaped     uuid;
  v_activated   uuid;
  v_streaks     jsonb;
begin
  select timezone into v_tz from public.families where id = p_family_id;
  if not found then
    raise exception 'family_not_found: %', p_family_id;
  end if;
  v_today := coalesce(p_today, (now() at time zone v_tz)::date);

  -- Serialize runs per family.
  insert into public.party_health (family_id) values (p_family_id)
    on conflict (family_id) do nothing;
  select * into v_party from public.party_health
    where family_id = p_family_id for update;

  -- 0. Something to fight.
  v_activated := public.activate_next_boss(p_family_id, v_today);

  -- 1a. Mark misses first (slot locks), before locking the boss — the same
  -- order the completion trigger uses.
  for r in
    with missed as (
      update public.task_slots s
      set status = 'missed'
      from public.weekly_pools p
      where p.id = s.pool_id
        and p.family_id = p_family_id
        and s.status = 'scheduled'
        and s.scheduled_date < v_today
      returning p.child_id, s.duration_minutes
    )
    select child_id, sum(duration_minutes)::integer as minutes
    from missed group by child_id order by child_id
  loop
    v_missed := v_missed + r.minutes;
    v_missed_rows := v_missed_rows
      || jsonb_build_object('child_id', r.child_id, 'minutes', r.minutes);
  end loop;

  select * into v_boss from public.bosses
    where family_id = p_family_id and status = 'active' for update;
  v_has_boss := found;

  -- 1b. Penalties (only while a boss is active).
  if v_has_boss then
    for r in
      select (e ->> 'child_id')::uuid as child_id, (e ->> 'minutes')::integer as minutes
      from jsonb_array_elements(v_missed_rows) e
    loop
      v_amount := r.minutes * c_penalty_per_minute;
      v_penalty := v_penalty + v_amount;
      insert into public.boss_log (boss_id, event_type, amount, child_id)
        values (v_boss.id, 'miss_penalty', v_amount, r.child_id);
    end loop;
  end if;

  if v_penalty > 0 then
    update public.party_health
      set current_hp = greatest(0, current_hp - v_penalty)
      where id = v_party.id
      returning * into v_party;
  end if;

  -- 2 / 3. Defeat safety net, else escape.
  if v_has_boss and v_boss.current_hp = 0 then
    v_finish := public.finish_boss(v_boss.id, 'defeated', v_today);
    v_defeated := v_boss.id;
  elsif v_has_boss and v_party.current_hp = 0 then
    v_finish := public.finish_boss(v_boss.id, 'escaped', v_today);
    v_escaped := v_boss.id;
  end if;

  if v_finish is not null then
    v_awards := coalesce(v_finish -> 'gold_awarded', '[]'::jsonb);
    v_activated := coalesce((v_finish ->> 'activated')::uuid, v_activated);
  end if;

  -- The party always recovers from 0.
  if v_party.current_hp = 0 then
    update public.party_health set current_hp = max_hp
      where id = v_party.id returning * into v_party;
  end if;

  -- 4. Streaks, after misses are marked (lock order: … → player_stats).
  v_streaks := public.evaluate_streaks(p_family_id, v_today);

  return jsonb_build_object(
    'family_id', p_family_id,
    'today', v_today,
    'boss_id', case when v_has_boss then v_boss.id end,
    'missed_minutes', v_missed,
    'party_damage', v_penalty,
    'party_hp', v_party.current_hp,
    'defeated', v_defeated,
    'escaped', v_escaped,
    'gold_awarded', v_awards,
    'activated', v_activated,
    'streaks', v_streaks
  );
end;
$$;

-- Internal helpers: not callable through the API. (run_daily_reset keeps
-- its service-role-only grant: create or replace preserves privileges.)
revoke all on function public.award_xp(uuid, integer) from public, anon, authenticated;
revoke all on function public.evaluate_streaks(uuid, date) from public, anon, authenticated;
revoke all on function public.finish_boss(uuid, text, date) from public, anon, authenticated;
revoke all on function public.strike_boss_on_completion() from public, anon, authenticated;
revoke all on function public.guard_child_task_slot_writes() from public, anon, authenticated;
