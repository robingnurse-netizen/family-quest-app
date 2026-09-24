-- Family Quest: "while you were away" recaps, the evening warning's stakes,
-- and healing the party (potions + perfect-day heals).
--
--   1. Tunables as functions / rows, one place each:
--        miss_penalty_per_minute()  party damage per missed minute (1)
--        perfect_day_heal_hp()      HP healed per perfect day (10)
--        potions                    the potion catalogue (heal + price)
--   2. party_log: every heal (potion or perfect day), readable by the
--      family — how parents see potion spending. Realtime, so the battle
--      scene can show heals live.
--   3. potions + buy_potion(): bought and drunk in one step, no inventory.
--      Priced from the table, atomic, the child's own gold only.
--   4. Perfect-day heals: evaluate_streaks() now also reports each day a
--      child did every scheduled quest (the streak's +1 condition); the
--      reset heals the party per such day, after penalties and the
--      knock-out refill. Idempotent and catches up exactly like streaks
--      (streak_through).
--   5. reset_recaps: one row per child per reset run that affected him
--      (misses, damage, perfect days, knock-out) — a snapshot of what the
--      rest of the data doesn't keep (streak before/after, HP before/after,
--      who escaped and who came next). acknowledge_recaps() marks his own
--      rows seen and nothing else.
--   6. tonight_stakes(): what tonight's reset would deal right now, for the
--      evening warning.
--
-- Lock order is unchanged: party_health → task_slots → bosses →
-- player_stats. buy_potion takes party_health → player_stats.
--
-- Error prefixes (friendly text in lib/potions/errors.ts):
--   potion_not_a_player | potion_unavailable | potion_party_full |
--   potion_insufficient_gold

-- ---------------------------------------------------------------------------
-- 1. Tunables
-- ---------------------------------------------------------------------------
create or replace function public.miss_penalty_per_minute()
returns integer
language sql
immutable
set search_path = ''
as $$ select 1 $$;

create or replace function public.perfect_day_heal_hp()
returns integer
language sql
immutable
set search_path = ''
as $$ select 10 $$;

-- ---------------------------------------------------------------------------
-- 3. Potions (the catalogue; tune heal_hp / gold_cost here)
-- ---------------------------------------------------------------------------
create table public.potions (
  id         text primary key,
  name       text not null,
  heal_hp    integer not null check (heal_hp > 0),
  gold_cost  integer not null check (gold_cost >= 0),
  sort_order integer not null default 0,
  active     boolean not null default true
);
insert into public.potions (id, name, heal_hp, gold_cost, sort_order) values
  ('small', 'Small Potion', 20, 30, 1),
  ('large', 'Large Potion', 50, 70, 2);

alter table public.potions enable row level security;
create policy "potions: everyone signed in reads"
  on public.potions for select to authenticated
  using (true);

-- ---------------------------------------------------------------------------
-- 2. party_log
-- ---------------------------------------------------------------------------
create table public.party_log (
  id         uuid primary key default gen_random_uuid(),
  family_id  uuid not null references public.families (id) on delete cascade,
  child_id   uuid references public.profiles (id) on delete set null,
  event_type text not null check (event_type in ('potion', 'perfect_day')),
  -- HP actually healed (capped at max HP).
  amount     integer not null check (amount >= 0),
  hp_after   integer not null,
  potion_id  text references public.potions (id),
  gold_spent integer not null default 0 check (gold_spent >= 0),
  -- Perfect day: the day that was perfect.
  day        date,
  created_at timestamptz not null default now()
);
create index party_log_family_idx on public.party_log (family_id, created_at desc);

alter table public.party_log enable row level security;
create policy "party_log: family read"
  on public.party_log for select to authenticated
  using (family_id = public.current_family_id());

-- ---------------------------------------------------------------------------
-- 5. reset_recaps
-- ---------------------------------------------------------------------------
create table public.reset_recaps (
  id              uuid primary key default gen_random_uuid(),
  family_id       uuid not null references public.families (id) on delete cascade,
  child_id        uuid not null references public.profiles (id) on delete cascade,
  created_at      timestamptz not null default now(),
  -- Days this run looked at (his missed quests' dates and the streak days).
  day_from        date,
  day_to          date,
  -- His misses.
  missed_quests   integer not null default 0,
  missed_minutes  integer not null default 0,
  -- The whole party's damage this run (everyone's misses; 0 with no boss).
  party_damage    integer not null default 0,
  -- The boss that was active (dealt the blow), if any.
  boss_id         uuid references public.bosses (id) on delete set null,
  -- His perfect days, and the HP they healed.
  perfect_days    integer not null default 0,
  healed          integer not null default 0,
  streak_before   integer not null default 0,
  streak_after    integer not null default 0,
  knocked_out     boolean not null default false,
  escaped_boss_id uuid references public.bosses (id) on delete set null,
  next_boss_id    uuid references public.bosses (id) on delete set null,
  hp_before       integer not null,
  hp_after        integer not null,
  max_hp          integer not null,
  -- Set by acknowledge_recaps() (the child saw or skipped it).
  seen_at         timestamptz
);
create index reset_recaps_unseen_idx on public.reset_recaps (child_id, created_at) where seen_at is null;

alter table public.reset_recaps enable row level security;
-- Read only; every write goes through the reset or acknowledge_recaps().
create policy "reset_recaps: own or parent read"
  on public.reset_recaps for select to authenticated
  using (
    child_id = auth.uid()
    or (public.is_parent() and family_id = public.current_family_id())
  );

-- ---------------------------------------------------------------------------
-- 4. Streaks + perfect days (replaces …11's evaluate_streaks; same rules,
-- more output: the streak before, the first day evaluated and each perfect
-- day).
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
  v_perfect jsonb;
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
    v_perfect := '[]'::jsonb;
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
      'best', v_best, 'from', v_from, 'through', p_today - 1, 'perfect_days', v_perfect);
  end loop;
  return v_out;
end;
$$;

-- ---------------------------------------------------------------------------
-- The nightly reset: …11's steps unchanged, plus perfect-day heals (after
-- penalties and the knock-out refill) and a recap row per affected child.
-- ---------------------------------------------------------------------------
create or replace function public.run_daily_reset(p_family_id uuid, p_today date default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  c_penalty_per_minute constant integer := public.miss_penalty_per_minute();
  c_heal               constant integer := public.perfect_day_heal_hp();

  v_tz          text;
  v_today       date;
  v_party       public.party_health%rowtype;
  v_hp_before   integer;
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
  v_knocked     boolean := false;
  v_streaks     jsonb;
  v_healed      jsonb := '{}'::jsonb;
  v_healed_all  integer := 0;
  v_child       record;
  v_day         date;
  m             jsonb;
  st            jsonb;
  v_quests      integer;
  v_perfect     integer;
  v_recaps      integer := 0;
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
  v_hp_before := v_party.current_hp;

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
    v_knocked := v_party.current_hp = 0;
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

  -- 5. Perfect-day heals: after penalties and the refill, one heal per
  -- perfect day per child (days in order), capped at max HP. The party row
  -- is already locked. Only newly evaluated days count, so re-runs heal
  -- nothing and missed nights catch up.
  for st in select e from jsonb_array_elements(v_streaks) e order by e ->> 'child_id' loop
    for v_day in
      select d::date from jsonb_array_elements_text(st -> 'perfect_days') d order by 1
    loop
      v_amount := least(c_heal, v_party.max_hp - v_party.current_hp);
      if v_amount > 0 then
        update public.party_health set current_hp = current_hp + v_amount
          where id = v_party.id returning * into v_party;
        insert into public.party_log (family_id, child_id, event_type, amount, hp_after, day)
          values (p_family_id, (st ->> 'child_id')::uuid, 'perfect_day', v_amount, v_party.current_hp, v_day);
        v_healed_all := v_healed_all + v_amount;
      end if;
      v_healed := jsonb_set(
        v_healed, array[st ->> 'child_id'],
        to_jsonb(coalesce((v_healed ->> (st ->> 'child_id'))::integer, 0) + v_amount));
    end loop;
  end loop;

  -- 6. Recaps: a row for each child this run affected (his misses or
  -- perfect days, or party damage / a knock-out from anyone's misses).
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
    continue when v_quests = 0 and v_perfect = 0 and v_penalty = 0 and not v_knocked;

    insert into public.reset_recaps (
      family_id, child_id, day_from, day_to, missed_quests, missed_minutes,
      party_damage, boss_id, perfect_days, healed, streak_before, streak_after,
      knocked_out, escaped_boss_id, next_boss_id, hp_before, hp_after, max_hp)
    select
      p_family_id, v_child.id,
      least((m ->> 'from')::date, (st ->> 'from')::date),
      greatest((m ->> 'to')::date, (st ->> 'through')::date),
      v_quests, coalesce((m ->> 'minutes')::integer, 0),
      v_penalty, case when v_has_boss then v_boss.id end,
      v_perfect, coalesce((v_healed ->> v_child.id::text)::integer, 0),
      coalesce((st ->> 'before')::integer, ps.current_streak, 0),
      coalesce((st ->> 'streak')::integer, ps.current_streak, 0),
      v_knocked, v_escaped, case when v_escaped is not null then v_activated end,
      v_hp_before, v_party.current_hp, v_party.max_hp
    from (select 1) one
    left join public.player_stats ps on ps.child_id = v_child.id;
    v_recaps := v_recaps + 1;
  end loop;

  return jsonb_build_object(
    'family_id', p_family_id,
    'today', v_today,
    'boss_id', case when v_has_boss then v_boss.id end,
    'missed_minutes', v_missed,
    'party_damage', v_penalty,
    'knocked_out', v_knocked,
    'party_healed', v_healed_all,
    'party_hp', v_party.current_hp,
    'defeated', v_defeated,
    'escaped', v_escaped,
    'gold_awarded', v_awards,
    'activated', v_activated,
    'streaks', v_streaks,
    'recaps', v_recaps
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Buying a potion: drunk at once. The child's own gold only (auth.uid()),
-- priced from the table, all-or-nothing. The party row lock serializes
-- concurrent buys (and the nightly reset); the gold update re-checks the
-- balance, so back-to-back requests can't overspend.
-- ---------------------------------------------------------------------------
create or replace function public.buy_potion(p_potion_id text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid    uuid := auth.uid();
  v_family uuid;
  v_potion public.potions%rowtype;
  v_party  public.party_health%rowtype;
  v_heal   integer;
  v_gold   integer;
begin
  select family_id into v_family from public.profiles
    where id = v_uid and role = 'child';
  if v_family is null then
    raise exception 'potion_not_a_player: only a player can buy potions'
      using errcode = 'insufficient_privilege';
  end if;

  select * into v_potion from public.potions where id = p_potion_id and active;
  if not found then
    raise exception 'potion_unavailable: %', p_potion_id using errcode = 'check_violation';
  end if;

  insert into public.party_health (family_id) values (v_family)
    on conflict (family_id) do nothing;
  select * into v_party from public.party_health
    where family_id = v_family for update;
  if v_party.current_hp >= v_party.max_hp then
    raise exception 'potion_party_full: the party is already at full health'
      using errcode = 'check_violation';
  end if;
  v_heal := least(v_potion.heal_hp, v_party.max_hp - v_party.current_hp);

  update public.player_stats
    set gold = gold - v_potion.gold_cost
    where child_id = v_uid and gold >= v_potion.gold_cost
    returning gold into v_gold;
  if not found then
    raise exception 'potion_insufficient_gold: % gold needed', v_potion.gold_cost
      using errcode = 'check_violation';
  end if;

  update public.party_health set current_hp = current_hp + v_heal
    where id = v_party.id returning * into v_party;
  insert into public.party_log (family_id, child_id, event_type, amount, hp_after, potion_id, gold_spent)
    values (v_family, v_uid, 'potion', v_heal, v_party.current_hp, v_potion.id, v_potion.gold_cost);

  return jsonb_build_object(
    'potion_id', v_potion.id, 'healed', v_heal, 'hp', v_party.current_hp,
    'max_hp', v_party.max_hp, 'gold', v_gold, 'gold_spent', v_potion.gold_cost);
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Acknowledging recaps: marks the caller's own unseen recaps (up to
-- p_through, the newest one shown) as seen. Touches nothing else.
-- ---------------------------------------------------------------------------
create or replace function public.acknowledge_recaps(p_through timestamptz)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  n integer;
begin
  update public.reset_recaps
    set seen_at = now()
    where child_id = auth.uid()
      and seen_at is null
      and created_at <= p_through;
  get diagnostics n = row_count;
  return n;
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. Tonight's stakes, for the evening warning: what the reset would deal
-- if it ran now — every open quest up to today (family time) × the miss
-- penalty, only while a boss is active (the reset's own rule).
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

  return jsonb_build_object(
    'today', v_today,
    'timezone', v_tz,
    'boss_active', v_has,
    'boss_name', case when v_has then v_boss.name end,
    'my_open_quests', v_mine,
    'open_quests', v_open,
    'open_minutes', v_minutes,
    'damage', case when v_has then v_minutes * public.miss_penalty_per_minute() else 0 end,
    'party_hp', coalesce(v_hp, 0));
end;
$$;

-- ---------------------------------------------------------------------------
-- Privileges. Supabase grants new functions to anon/authenticated by
-- default: revoke, then grant the three the app calls to signed-in users.
-- (run_daily_reset keeps its service-role-only grant: create or replace
-- preserves privileges.)
-- ---------------------------------------------------------------------------
revoke all on function public.miss_penalty_per_minute() from public, anon, authenticated;
revoke all on function public.perfect_day_heal_hp() from public, anon, authenticated;
revoke all on function public.evaluate_streaks(uuid, date) from public, anon, authenticated;
revoke all on function public.buy_potion(text) from public, anon;
revoke all on function public.acknowledge_recaps(timestamptz) from public, anon;
revoke all on function public.tonight_stakes() from public, anon;
grant execute on function public.buy_potion(text) to authenticated;
grant execute on function public.acknowledge_recaps(timestamptz) to authenticated;
grant execute on function public.tonight_stakes() to authenticated;

-- ---------------------------------------------------------------------------
-- Realtime: heals show live in the battle scene (idempotent).
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'party_log'
  ) then
    alter publication supabase_realtime add table public.party_log;
  end if;
end;
$$;
