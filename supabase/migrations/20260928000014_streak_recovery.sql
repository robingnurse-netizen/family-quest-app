-- Family Quest: streak recovery — a missed day CRACKS the streak instead of
-- resetting it, and opens a rescue quest (docs: the feature backlog's
-- "Streak recovery (carrot-style)"; design signed off 25 Sep 2026).
--
--   * A miss on a day while the streak is 1 or more cracks it: the streak is
--     FROZEN at that value and a rescue opens (streak_rescues), due by the
--     end of the missed day + 2 (family days). A miss at streak 0 changes
--     nothing (there's nothing to protect).
--   * The child is OFFERED up to 5 jobs drawn at random from the family's
--     rescue_jobs pool, PICKS one (pick_rescue_job) and ticks it done
--     (complete_rescue) — which deals normal boss damage and XP, like any
--     quest. Empty pool: the fallback rescue is "finish any quest on the
--     missed day + 1" (due that day).
--   * While frozen, the streak doesn't grow or drop: further misses are
--     absorbed (the window isn't reset or extended) and perfect days don't
--     add to it (they still count as perfect days — …16's Night Raid).
--   * Resolution is nightly (run_daily_reset → evaluate_streaks): done →
--     RESCUED, the streak is back at exactly its frozen value (no credit for
--     frozen days); not done by due_on → LAPSED, the streak halves, rounded
--     up (never 0: 1 → 1, 7 → 4). best_streak is never lowered.
--   * Every crack / rescue / halving is written into that night's
--     reset_recaps row (rescue_events), so the "while you were away" recap
--     tells him.
--
-- PROGRESS NEVER GOES BACKWARDS (the 26 Sep 2026 rewind): streak recovery is
-- now the ONLY thing a missed quest sets off. The nightly reset still marks
-- past open quests 'missed', but no longer damages the party (no
-- 'miss_penalty' rows), knocks it out, lets the boss escape, refills it or
-- heals it on perfect days. party_health, party_log and the potions are left
-- DORMANT (dropped in a later cleanup); reset_recaps' party columns are
-- written as 0 / false / null (hp_* as the dormant party row stands).
-- 20260930000016_night_raid.sql adds the perfect-day reward (Rogue's Night
-- Raid) on top of this reset.
--
-- Also: the boss-strike core is shared (strike_active_boss) by quest ticks
-- and rescues; tonight_stakes() reports an open rescue, and its `damage` is
-- always 0 now (kept, with party_hp, for the app until …16's UI).
--
-- ORDER: live, …15 was applied before this one (25 Sep 2026). This file
-- redefines none of …15's functions (activate_boss, activate_next_boss,
-- finish_boss, set_boss_base_max_hp) and checks that at the end; on a fresh
-- database it runs before …15, which is fine for the same reason.
--
-- LOCK ORDER: family row (the nightly reset only) → task slot → boss →
-- streak rescue → player_stats. complete_rescue takes the boss before the
-- rescue row, as the nightly reset does. (party_health is no longer locked.)
--
-- Hand-applied in the SQL editor: one transaction, all or nothing.

begin;

-- ---------------------------------------------------------------------------
-- 1. rescue_jobs: the parents' pool of rescue quests
-- ---------------------------------------------------------------------------
create table public.rescue_jobs (
  id         uuid primary key default gen_random_uuid(),
  family_id  uuid not null references public.families (id) on delete cascade,
  title      text not null check (char_length(title) between 1 and 80),
  -- Tunable per job; the backlog's rescue jobs are 10-minute jobs.
  minutes    integer not null default 10 check (minutes between 5 and 60),
  -- Hidden jobs aren't offered (open rescues keep their snapshot).
  active     boolean not null default true,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);
create index rescue_jobs_family_idx on public.rescue_jobs (family_id);

alter table public.rescue_jobs enable row level security;
create policy "rescue_jobs: family read"
  on public.rescue_jobs for select to authenticated
  using (family_id = public.current_family_id());
create policy "rescue_jobs: parents write"
  on public.rescue_jobs for all to authenticated
  using (family_id = public.current_family_id() and public.is_parent())
  with check (family_id = public.current_family_id() and public.is_parent());

-- ---------------------------------------------------------------------------
-- 2. streak_rescues: one row per crack
-- ---------------------------------------------------------------------------
create table public.streak_rescues (
  id              uuid primary key default gen_random_uuid(),
  family_id       uuid not null references public.families (id) on delete cascade,
  child_id        uuid not null references public.profiles (id) on delete cascade,
  -- The day whose miss cracked the streak, and the streak it froze at.
  missed_day      date not null,
  streak_at_crack integer not null check (streak_at_crack >= 1),
  -- Last family day the rescue can be done (missed_day + 2; + 1 for the
  -- fallback).
  due_on          date not null,
  -- The jobs he may choose from: up to 5, drawn at random from the active
  -- pool when it opened, snapshotted ([{ "job_id", "title", "minutes" }])
  -- so editing or hiding a job doesn't change an open rescue.
  offered         jsonb not null default '[]'::jsonb,
  -- The pool was empty: the rescue is "finish any quest on due_on".
  fallback        boolean not null default false,
  -- His pick (one of `offered`; may change until it's done).
  job_id          uuid,
  job_title       text,
  minutes         integer,
  picked_at       timestamptz,
  -- He ticked it done (complete_rescue): damage + XP dealt then.
  completed_at    timestamptz,
  completed_on    date,
  -- open → rescued | lapsed, set by the nightly reset.
  status          text not null default 'open' check (status in ('open', 'rescued', 'lapsed')),
  resolved_on     date,
  streak_after    integer,
  created_at      timestamptz not null default now()
);
-- One open rescue per child.
create unique index streak_rescues_one_open on public.streak_rescues (child_id) where status = 'open';
create index streak_rescues_family_idx on public.streak_rescues (family_id, created_at);

alter table public.streak_rescues enable row level security;
-- Read only; every write goes through the reset, pick_rescue_job() or
-- complete_rescue().
create policy "streak_rescues: own or parent read"
  on public.streak_rescues for select to authenticated
  using (
    child_id = auth.uid()
    or (public.is_parent() and family_id = public.current_family_id())
  );

-- The recap's story of each night's rescue events:
-- [{ "event": "cracked" | "rescued" | "halved", "rescue_id", "missed_day",
--    "due_on", "streak_at_crack", "streak_after", "fallback",
--    "offered_count", "job_title" }]
alter table public.reset_recaps
  add column rescue_events jsonb not null default '[]'::jsonb;

-- ---------------------------------------------------------------------------
-- 3. The boss strike, shared by quest ticks and rescues
-- ---------------------------------------------------------------------------
-- Damage the family's active boss (if any) by p_amount, log it for the
-- child, and finish it at 0 HP. Returns whether a boss was hit. The caller
-- holds its own earlier locks (slot or rescue order: see LOCK ORDER).
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

  if v_boss.current_hp = 0 then
    perform public.finish_boss(v_boss.id, 'defeated', p_today);
  end if;
  return true;
end;
$$;

-- The completion trigger's body, now through strike_active_boss (same
-- behaviour as …11). Trigger task_slots_strike_boss keeps its name — it
-- must still sort after task_slots_guard_child_writes.
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
  end if;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. The child picks a rescue job, then ticks it done
-- ---------------------------------------------------------------------------
-- Pick (or change the pick of) one of the offered jobs, while the rescue is
-- open, not yet done, and not past due (family time).
create or replace function public.pick_rescue_job(p_rescue_id uuid, p_job_id uuid)
returns public.streak_rescues
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rescue public.streak_rescues%rowtype;
  v_tz     text;
  v_job    jsonb;
begin
  select * into v_rescue from public.streak_rescues
    where id = p_rescue_id and child_id = auth.uid()
    for update;
  if not found then
    raise exception 'rescue_not_found' using errcode = 'P0002';
  end if;
  if v_rescue.status <> 'open' or v_rescue.completed_at is not null then
    raise exception 'rescue_closed';
  end if;
  select timezone into v_tz from public.families where id = v_rescue.family_id;
  if (now() at time zone v_tz)::date > v_rescue.due_on then
    raise exception 'rescue_overdue';
  end if;
  select e into v_job from jsonb_array_elements(v_rescue.offered) e
    where (e ->> 'job_id')::uuid = p_job_id;
  if v_job is null then
    raise exception 'rescue_not_offered';
  end if;

  update public.streak_rescues
    set job_id = p_job_id,
        job_title = v_job ->> 'title',
        minutes = (v_job ->> 'minutes')::integer,
        picked_at = now()
    where id = p_rescue_id
    returning * into v_rescue;
  return v_rescue;
end;
$$;

-- Tick the picked job done: normal boss damage and XP (1 per minute), once.
-- The streak repairs in that night's reset (the recap says so).
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

  return jsonb_build_object('rescue', to_jsonb(v_rescue), 'boss_hit', v_hit);
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Streaks: crack, freeze, repair or halve (replaces …12's)
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
  v_rescue  public.streak_rescues%rowtype;
  v_open    boolean;
  v_from    date;
  v_day     date;
  v_streak  integer;
  v_best    integer;
  v_total   integer;
  v_missed  integer;
  v_done    integer;
  v_done_on date;
  v_perfect jsonb;
  v_events  jsonb;
  v_offered jsonb;
  v_out     jsonb := '[]'::jsonb;
begin
  for v_child in
    select id from public.profiles
    where family_id = p_family_id and role = 'child'
    order by id
  loop
    -- Lock order: rescue → player_stats.
    select * into v_rescue from public.streak_rescues
      where child_id = v_child.id and status = 'open'
      for update;
    v_open := found;

    insert into public.player_stats (child_id) values (v_child.id)
      on conflict (child_id) do nothing;
    select * into v_stats from public.player_stats
      where child_id = v_child.id for update;

    -- First evaluation looks at yesterday only (no backfill).
    v_from := coalesce(v_stats.streak_through + 1, p_today - 1);
    continue when v_from > p_today - 1;

    v_streak := v_stats.current_streak;
    v_best := v_stats.best_streak;
    v_perfect := '[]'::jsonb;
    v_events := '[]'::jsonb;

    -- Days in order, then p_today itself (only to resolve a rescue done
    -- yesterday, or due yesterday).
    for v_day in
      select d::date from generate_series(v_from, p_today, interval '1 day') d
    loop
      -- A. Resolve an open rescue before judging this day: done on an
      -- earlier day → rescued (back to its frozen value); past due →
      -- lapsed (halved, rounded up: never 0).
      if v_open then
        v_done_on := case
          when v_rescue.fallback then
            case when exists (
              select 1 from public.task_slots s
              join public.weekly_pools p on p.id = s.pool_id
              where p.child_id = v_child.id and s.scheduled_date = v_rescue.due_on
                and s.status = 'completed'
            ) then v_rescue.due_on end
          else v_rescue.completed_on
        end;
        if v_done_on is not null and v_done_on < v_day then
          v_streak := v_rescue.streak_at_crack;
          update public.streak_rescues
            set status = 'rescued', resolved_on = v_day, streak_after = v_streak
            where id = v_rescue.id;
          v_events := v_events || jsonb_build_object(
            'event', 'rescued', 'rescue_id', v_rescue.id, 'missed_day', v_rescue.missed_day,
            'due_on', v_rescue.due_on, 'streak_at_crack', v_rescue.streak_at_crack,
            'streak_after', v_streak, 'fallback', v_rescue.fallback,
            'job_title', v_rescue.job_title);
          v_open := false;
        elsif v_day > v_rescue.due_on then
          v_streak := ceil(v_rescue.streak_at_crack / 2.0)::integer;
          update public.streak_rescues
            set status = 'lapsed', resolved_on = v_day, streak_after = v_streak
            where id = v_rescue.id;
          v_events := v_events || jsonb_build_object(
            'event', 'halved', 'rescue_id', v_rescue.id, 'missed_day', v_rescue.missed_day,
            'due_on', v_rescue.due_on, 'streak_at_crack', v_rescue.streak_at_crack,
            'streak_after', v_streak, 'fallback', v_rescue.fallback,
            'job_title', v_rescue.job_title);
          v_open := false;
        end if;
      end if;

      exit when v_day = p_today;  -- today isn't over: nothing to judge

      -- B. Judge the day.
      select count(*),
             count(*) filter (where s.status = 'missed'),
             count(*) filter (where s.status = 'completed')
        into v_total, v_missed, v_done
        from public.task_slots s
        join public.weekly_pools p on p.id = s.pool_id
       where p.child_id = v_child.id and s.scheduled_date = v_day;

      if v_total = 0 then
        null;                         -- rest day: no change
      elsif v_open then
        -- Frozen: misses are absorbed and perfect days don't add to the
        -- streak — but a perfect day is still reported (…16's Night Raid).
        if v_missed = 0 and v_done = v_total then
          v_perfect := v_perfect || to_jsonb(v_day);
        end if;
      elsif v_missed > 0 then
        if v_streak >= 1 then
          -- Crack: freeze at v_streak and open a rescue, offering up to 5
          -- active jobs at random (none: the "any quest tomorrow" fallback).
          -- TODO(rest days): once rest days exist, excused days must not
          -- count toward this window — due_on should skip them.
          select coalesce(jsonb_agg(jsonb_build_object(
                   'job_id', j.id, 'title', j.title, 'minutes', j.minutes)), '[]'::jsonb)
            into v_offered
            from (select * from public.rescue_jobs
                  where family_id = p_family_id and active
                  order by random() limit 5) j;
          insert into public.streak_rescues
            (family_id, child_id, missed_day, streak_at_crack, due_on, offered, fallback)
          values (
            p_family_id, v_child.id, v_day, v_streak,
            v_day + case when jsonb_array_length(v_offered) = 0 then 1 else 2 end,
            v_offered, jsonb_array_length(v_offered) = 0)
          returning * into v_rescue;
          v_open := true;
          v_events := v_events || jsonb_build_object(
            'event', 'cracked', 'rescue_id', v_rescue.id, 'missed_day', v_day,
            'due_on', v_rescue.due_on, 'streak_at_crack', v_streak,
            'streak_after', v_streak, 'fallback', v_rescue.fallback,
            'offered_count', jsonb_array_length(v_offered));
        end if;
        -- (A miss at 0: nothing to protect; it stays 0.)
      elsif v_done = v_total then
        v_streak := v_streak + 1;     -- everything done: a perfect day
        v_best := greatest(v_best, v_streak);
        v_perfect := v_perfect || to_jsonb(v_day);
      end if;
    end loop;

    update public.player_stats
      set current_streak = v_streak,
          best_streak = v_best,
          streak_through = p_today - 1
      where child_id = v_child.id;

    v_out := v_out || jsonb_build_object(
      'child_id', v_child.id, 'before', v_stats.current_streak, 'streak', v_streak,
      'best', v_best, 'from', v_from, 'through', p_today - 1, 'perfect_days', v_perfect,
      'rescue_events', v_events);
  end loop;
  return v_out;
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. The nightly reset: misses are marked, nothing is taken away. …12's
--    party damage / knock-out / escape / refill / perfect-day heal steps are
--    gone (see the header); a recap row is written whenever a child missed
--    quests, had a perfect day or a rescue event.
-- ---------------------------------------------------------------------------
create or replace function public.run_daily_reset(p_family_id uuid, p_today date default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tz          text;
  v_today       date;
  v_party       public.party_health%rowtype;
  v_boss        public.bosses%rowtype;
  v_has_boss    boolean;
  r             record;
  v_missed      integer := 0;
  v_missed_rows jsonb := '[]'::jsonb;
  v_finish      jsonb;
  v_awards      jsonb := '[]'::jsonb;
  v_defeated    uuid;
  v_activated   uuid;
  v_streaks     jsonb;
  v_child       record;
  m             jsonb;
  st            jsonb;
  v_quests      integer;
  v_perfect     integer;
  v_recaps      integer := 0;
begin
  -- Serialize runs per family (the family row; party_health is dormant).
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

  -- 2. Safety net: a boss left active at 0 HP is defeated (with its gold).
  -- A boss never escapes.
  if v_has_boss and v_boss.current_hp = 0 then
    v_finish := public.finish_boss(v_boss.id, 'defeated', v_today);
    v_defeated := v_boss.id;
    v_awards := coalesce(v_finish -> 'gold_awarded', '[]'::jsonb);
    v_activated := coalesce((v_finish ->> 'activated')::uuid, v_activated);
  end if;

  -- 3. Streaks, after misses are marked (lock order: … → player_stats).
  v_streaks := public.evaluate_streaks(p_family_id, v_today);

  -- The dormant party row, only to fill reset_recaps' hp_* columns (not
  -- null); never locked or changed.
  select * into v_party from public.party_health where family_id = p_family_id;

  -- 4. Recaps: a row for each child this run affected (his misses, perfect
  -- days or rescue events).
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
      party_damage, boss_id, perfect_days, healed, streak_before, streak_after,
      knocked_out, escaped_boss_id, next_boss_id, hp_before, hp_after, max_hp, rescue_events)
    select
      p_family_id, v_child.id,
      least((m ->> 'from')::date, (st ->> 'from')::date),
      greatest((m ->> 'to')::date, (st ->> 'through')::date),
      v_quests, coalesce((m ->> 'minutes')::integer, 0),
      0, case when v_has_boss then v_boss.id end,
      v_perfect, 0,
      coalesce((st ->> 'before')::integer, ps.current_streak, 0),
      coalesce((st ->> 'streak')::integer, ps.current_streak, 0),
      false, null, null,
      coalesce(v_party.current_hp, 100), coalesce(v_party.current_hp, 100), coalesce(v_party.max_hp, 100),
      coalesce(st -> 'rescue_events', '[]'::jsonb)
    from (select 1) one
    left join public.player_stats ps on ps.child_id = v_child.id;
    v_recaps := v_recaps + 1;
  end loop;

  -- (party_damage / knocked_out / party_healed / escaped stay in the result,
  -- always 0 / false / null, for the app until …16's UI.)
  return jsonb_build_object(
    'family_id', p_family_id,
    'today', v_today,
    'boss_id', case when v_has_boss then v_boss.id end,
    'missed_minutes', v_missed,
    'party_damage', 0,
    'knocked_out', false,
    'party_healed', 0,
    'party_hp', coalesce(v_party.current_hp, 100),
    'defeated', v_defeated,
    'escaped', null,
    'gold_awarded', v_awards,
    'activated', v_activated,
    'streaks', v_streaks,
    'recaps', v_recaps
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. Tonight's stakes: …12's, plus whether his streak is frozen by an open
--    rescue. Nothing is taken away tonight any more, so `damage` is always 0
--    (…12's app hides the warning at 0); `party_hp` is the dormant party row.
--    …16 adds the Night Raid on offer.
-- ---------------------------------------------------------------------------
create or replace function public.tonight_stakes()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid     uuid := auth.uid();
  v_family  uuid;
  v_tz      text;
  v_today   date;
  v_boss    public.bosses%rowtype;
  v_has     boolean;
  v_mine    integer;
  v_open    integer;
  v_minutes integer;
  v_hp      integer;
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

  select current_hp into v_hp from public.party_health where family_id = v_family;
  -- An open rescue: his streak is frozen, so tonight can't crack it.
  v_rescue := exists (select 1 from public.streak_rescues where child_id = v_uid and status = 'open');

  return jsonb_build_object(
    'today', v_today,
    'timezone', v_tz,
    'boss_active', v_has,
    'boss_name', case when v_has then v_boss.name end,
    'my_open_quests', v_mine,
    'open_quests', v_open,
    'open_minutes', v_minutes,
    'damage', 0,
    'party_hp', coalesce(v_hp, 0),
    'rescue_open', v_rescue);
end;
$$;

-- ---------------------------------------------------------------------------
-- 8. Privileges. Supabase grants new functions to anon/authenticated by
-- default: revoke, then grant the two the child calls. (create or replace
-- keeps run_daily_reset's, evaluate_streaks' and tonight_stakes' grants.)
-- ---------------------------------------------------------------------------
revoke all on function public.strike_active_boss(uuid, uuid, integer, uuid, date) from public, anon, authenticated;
revoke all on function public.pick_rescue_job(uuid, uuid) from public, anon;
revoke all on function public.complete_rescue(uuid) from public, anon;
grant execute on function public.pick_rescue_job(uuid, uuid) to authenticated;
grant execute on function public.complete_rescue(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 9. Check before committing: this file must not have replaced …15's boss
--    functions. Only when …15 is already in (live: applied 25 Sep 2026);
--    on a fresh database …15 runs after this file, so there's nothing to
--    check yet.
-- ---------------------------------------------------------------------------
do $$
begin
  if to_regprocedure('public.activate_boss(uuid, date, text)') is not null then
    if position('retreats' in pg_get_functiondef('public.finish_boss(uuid, text, date)'::regprocedure)) = 0
       or position('activate_boss' in pg_get_functiondef('public.activate_next_boss(uuid, date)'::regprocedure)) = 0 then
      raise exception 'streak recovery check: …15''s finish_boss / activate_next_boss were replaced';
    end if;
  end if;
end $$;

commit;
