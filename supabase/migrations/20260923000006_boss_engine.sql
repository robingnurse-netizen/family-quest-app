-- Family Quest: RPG Phase A — boss data & daily reset engine.
--
-- The RPG tables (bosses, boss_log, party_health, player_stats, companions,
-- rewards, reward_redemptions) and their base RLS already exist from
-- 20260922000001/2. "One active boss per family" is already enforced by the
-- unique partial index bosses_one_active_per_family. This migration adds:
--
--   1. Small schema additions the engine needs (boss queue order, damage
--      attribution per child, extra log event types).
--   2. Per-family boss seeding (4 low-tier + 4 epic, all inactive), run for
--      every existing family and automatically for new ones; the first
--      low-tier boss (Trash-Bag Slime) is activated.
--   3. run_daily_reset(): the whole daily game tick for one family, in one
--      transaction. Executable ONLY by the service role — it deliberately
--      runs outside any user session so the child slot guard doesn't apply.
--   4. Tighter reads: a child sees only their own player_stats/companions.
--
-- Tunables live as constants at the top of run_daily_reset() and
-- seed_family_bosses().

-- ---------------------------------------------------------------------------
-- 1. Schema additions
-- ---------------------------------------------------------------------------

-- Seeded bosses wait in a queue; their week is set when they're activated.
alter table public.bosses alter column week_start_date drop not null;
alter table public.bosses add column queue_position integer not null default 0;

-- Who dealt the damage / took the penalty / got the gold (null for boss-wide
-- events). Lets the defeat payout split gold by each child's share.
alter table public.boss_log
  add column child_id uuid references public.profiles (id) on delete set null;
create index boss_log_boss_child_idx on public.boss_log (boss_id, child_id);

alter table public.boss_log drop constraint boss_log_event_type_check;
alter table public.boss_log add constraint boss_log_event_type_check
  check (event_type in (
    'damage', 'miss_penalty', 'defeated', 'escaped', 'activated', 'gold_awarded'
  ));

-- ---------------------------------------------------------------------------
-- 2. Boss seeding & activation
-- ---------------------------------------------------------------------------

-- Seeds the standard boss roster for a family (no-op if it has any bosses).
create or replace function public.seed_family_bosses(p_family_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from public.bosses where family_id = p_family_id) then
    return;
  end if;

  -- Tunable: HP at 1 minute of completed work = 1 damage.
  insert into public.bosses
    (family_id, name, tier, sprite_key, max_hp, current_hp, queue_position)
  values
    (p_family_id, 'Trash-Bag Slime',   'low',  'trash_bag_slime',    60,  60, 1),
    (p_family_id, 'Alarm Clock Swarm', 'low',  'alarm_clock_swarm',  90,  90, 2),
    (p_family_id, 'Laundry Goblin',    'low',  'laundry_goblin',    120, 120, 3),
    (p_family_id, 'Cable Spider',      'low',  'cable_spider',      150, 150, 4),
    (p_family_id, 'Magma Behemoth',    'epic', 'magma_behemoth',    300, 300, 1),
    (p_family_id, 'Chronosphinx',      'epic', 'chronosphinx',      360, 360, 2),
    (p_family_id, 'Abyssal Kraken',    'epic', 'abyssal_kraken',    420, 420, 3),
    (p_family_id, 'Shogun-Bot',        'epic', 'shogun_bot',        500, 500, 4);
end;
$$;

-- Activates the next queued boss (low tier first, then mid, then epic) if
-- the family has no active boss. Returns its id, or null.
create or replace function public.activate_next_boss(p_family_id uuid, p_today date)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if exists (
    select 1 from public.bosses where family_id = p_family_id and status = 'active'
  ) then
    return null;
  end if;

  select id into v_id
  from public.bosses
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
      -- Monday of the activation week.
      week_start_date = p_today - (extract(isodow from p_today)::integer - 1)
  where id = v_id;

  insert into public.boss_log (boss_id, event_type, amount)
  values (v_id, 'activated', 0);

  return v_id;
end;
$$;

-- New families get the roster and their first boss automatically.
create or replace function public.handle_new_family()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.seed_family_bosses(new.id);
  perform public.activate_next_boss(new.id, (now() at time zone new.timezone)::date);
  return new;
end;
$$;

create trigger families_seed_bosses
  after insert on public.families
  for each row execute function public.handle_new_family();

-- Existing families: seed, make sure party_health / player_stats rows exist,
-- and activate Trash-Bag Slime.
do $$
declare
  f record;
begin
  for f in select id, timezone from public.families loop
    perform public.seed_family_bosses(f.id);
    insert into public.party_health (family_id) values (f.id)
      on conflict (family_id) do nothing;
    perform public.activate_next_boss(f.id, (now() at time zone f.timezone)::date);
  end loop;

  insert into public.player_stats (child_id)
  select id from public.profiles where role = 'child'
  on conflict (child_id) do nothing;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Daily reset
-- ---------------------------------------------------------------------------
--
-- One family, one transaction, in this order:
--   0. If no boss is active, activate the next one.
--   1. Damage: every completed, not-yet-applied slot dated today or earlier
--      becomes damage on the active boss (per child, logged), and is marked
--      applied_to_boss. Future-dated completions wait for their day.
--   2. Misses: every still-scheduled slot dated before today becomes
--      'missed'; with an active boss, the minutes damage party_health
--      (per child, logged).
--   3. Defeat: boss at 0 HP → 'defeated'; its gold is split by each child's
--      share of the damage dealt to that boss (remainder to the top dealer).
--   4. Escape: otherwise, party_health at 0 → boss 'escaped'.
--   Party health at 0 is always restored to max, and after a defeat or
--   escape the next boss is activated.
--
-- Idempotent: running twice on the same day changes nothing the second time
-- (applied_to_boss and 'missed' are the markers). `p_today` overrides the
-- family's local date (used by tests).

create or replace function public.run_daily_reset(p_family_id uuid, p_today date default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  -- Tunables
  c_damage_per_minute  constant integer := 1;
  c_penalty_per_minute constant integer := 1;
  c_gold_low           constant integer := 25;
  c_gold_mid           constant integer := 50;
  c_gold_epic          constant integer := 100;

  v_tz        text;
  v_today     date;
  v_party     public.party_health%rowtype;
  v_boss      public.bosses%rowtype;
  v_has_boss  boolean;
  r           record;
  v_amount    integer;
  v_penalty   integer := 0;
  v_missed    integer := 0;
  v_gold      integer;
  v_damage    jsonb := '[]'::jsonb;
  v_awards    jsonb := '[]'::jsonb;
  v_defeated  uuid;
  v_escaped   uuid;
  v_activated uuid;
  v_next      uuid;
begin
  select timezone into v_tz from public.families where id = p_family_id;
  if not found then
    raise exception 'family_not_found: %', p_family_id;
  end if;
  v_today := coalesce(p_today, (now() at time zone v_tz)::date);

  -- Lock the family's party row: concurrent runs for a family serialize here.
  insert into public.party_health (family_id) values (p_family_id)
    on conflict (family_id) do nothing;
  select * into v_party from public.party_health
    where family_id = p_family_id for update;

  -- 0. Something to fight.
  v_activated := public.activate_next_boss(p_family_id, v_today);
  select * into v_boss from public.bosses
    where family_id = p_family_id and status = 'active' for update;
  v_has_boss := found;

  -- 1. Damage. Marking and summing happen in one statement, so a slot
  -- completed mid-run is either fully counted or left for next time.
  if v_has_boss then
    for r in
      with applied as (
        update public.task_slots s
        set applied_to_boss = true
        from public.weekly_pools p
        where p.id = s.pool_id
          and p.family_id = p_family_id
          and s.status = 'completed'
          and not s.applied_to_boss
          and s.scheduled_date <= v_today
        returning p.child_id, s.duration_minutes
      )
      select child_id, sum(duration_minutes)::integer as minutes
      from applied group by child_id order by child_id
    loop
      v_amount := r.minutes * c_damage_per_minute;
      update public.bosses
        set current_hp = greatest(0, current_hp - v_amount)
        where id = v_boss.id
        returning * into v_boss;
      insert into public.boss_log (boss_id, event_type, amount, child_id)
        values (v_boss.id, 'damage', v_amount, r.child_id);
      v_damage := v_damage || jsonb_build_object(
        'child_id', r.child_id, 'minutes', r.minutes, 'damage', v_amount);
    end loop;
  end if;

  -- 2. Misses (always marked; only penalised while a boss is active).
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
    if v_has_boss then
      v_amount := r.minutes * c_penalty_per_minute;
      v_penalty := v_penalty + v_amount;
      insert into public.boss_log (boss_id, event_type, amount, child_id)
        values (v_boss.id, 'miss_penalty', v_amount, r.child_id);
    end if;
  end loop;

  if v_penalty > 0 then
    update public.party_health
      set current_hp = greatest(0, current_hp - v_penalty)
      where id = v_party.id
      returning * into v_party;
  end if;

  -- 3. Defeat.
  if v_has_boss and v_boss.current_hp = 0 then
    update public.bosses set status = 'defeated' where id = v_boss.id;
    v_defeated := v_boss.id;
    v_gold := case v_boss.tier
      when 'low' then c_gold_low when 'mid' then c_gold_mid else c_gold_epic end;

    insert into public.boss_log (boss_id, event_type, amount)
      values (v_boss.id, 'defeated', v_gold);

    for r in
      with dealt as (
        select child_id, sum(amount)::numeric as dmg
        from public.boss_log
        where boss_id = v_boss.id and event_type = 'damage' and child_id is not null
        group by child_id
      ),
      shares as (
        select child_id, dmg,
               floor(v_gold * dmg / sum(dmg) over ())::integer as base,
               row_number() over (order by dmg desc, child_id) as rn
        from dealt
      )
      select child_id,
             base + case when rn = 1 then v_gold - (sum(base) over ())::integer else 0 end as gold
      from shares
      order by rn
    loop
      if r.gold > 0 then
        insert into public.player_stats (child_id, gold) values (r.child_id, r.gold)
          on conflict (child_id) do update
          set gold = public.player_stats.gold + excluded.gold;
        insert into public.boss_log (boss_id, event_type, amount, child_id)
          values (v_boss.id, 'gold_awarded', r.gold, r.child_id);
        v_awards := v_awards || jsonb_build_object('child_id', r.child_id, 'gold', r.gold);
      end if;
    end loop;

  -- 4. Escape.
  elsif v_has_boss and v_party.current_hp = 0 then
    update public.bosses set status = 'escaped' where id = v_boss.id;
    v_escaped := v_boss.id;
    insert into public.boss_log (boss_id, event_type, amount)
      values (v_boss.id, 'escaped', v_boss.current_hp);
  end if;

  -- The party always recovers from 0 (even when a defeat won the day).
  if v_party.current_hp = 0 then
    update public.party_health set current_hp = max_hp
      where id = v_party.id returning * into v_party;
  end if;

  if v_defeated is not null or v_escaped is not null then
    v_next := public.activate_next_boss(p_family_id, v_today);
    v_activated := coalesce(v_next, v_activated);
  end if;

  return jsonb_build_object(
    'family_id', p_family_id,
    'today', v_today,
    'boss_id', case when v_has_boss then v_boss.id end,
    'damage', v_damage,
    'missed_minutes', v_missed,
    'party_damage', v_penalty,
    'party_hp', v_party.current_hp,
    'defeated', v_defeated,
    'escaped', v_escaped,
    'gold_awarded', v_awards,
    'activated', v_activated
  );
end;
$$;

-- Runs every family; one family failing doesn't stop the others.
create or replace function public.run_daily_reset_all()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  f record;
  v_results jsonb := '[]'::jsonb;
begin
  for f in select id from public.families order by created_at loop
    begin
      v_results := v_results || public.run_daily_reset(f.id);
    exception when others then
      v_results := v_results || jsonb_build_object('family_id', f.id, 'error', sqlerrm);
    end;
  end loop;
  return v_results;
end;
$$;

-- Service role only. (Supabase grants new functions to anon/authenticated by
-- default, so revoke those explicitly, not just PUBLIC.)
revoke all on function public.seed_family_bosses(uuid) from public, anon, authenticated;
revoke all on function public.activate_next_boss(uuid, date) from public, anon, authenticated;
revoke all on function public.handle_new_family() from public, anon, authenticated;
revoke all on function public.run_daily_reset(uuid, date) from public, anon, authenticated;
revoke all on function public.run_daily_reset_all() from public, anon, authenticated;
grant execute on function public.run_daily_reset(uuid, date) to service_role;
grant execute on function public.run_daily_reset_all() to service_role;

-- ---------------------------------------------------------------------------
-- 4. A child reads only their own stats and companions (parents: family).
-- ---------------------------------------------------------------------------
drop policy "player_stats: family read" on public.player_stats;
create policy "player_stats: own or parent read"
  on public.player_stats for select to authenticated
  using (
    child_id = auth.uid()
    or (public.is_parent() and exists (
      select 1 from public.profiles c
      where c.id = child_id and c.family_id = public.current_family_id()
    ))
  );

drop policy "companions: family read" on public.companions;
create policy "companions: own or parent read"
  on public.companions for select to authenticated
  using (
    child_id = auth.uid()
    or (public.is_parent() and exists (
      select 1 from public.profiles c
      where c.id = child_id and c.family_id = public.current_family_id()
    ))
  );
