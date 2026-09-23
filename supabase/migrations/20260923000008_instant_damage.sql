-- Family Quest: instant boss damage on task completion.
--
-- Design change: completing a slot damages the active boss immediately,
-- in the same transaction as the status update, instead of waiting for the
-- nightly reset. Missed-slot penalties stay nightly (a miss can't be known
-- until the day has ended).
--
--   1. finish_boss(): shared end-of-boss logic (defeat → gold split by damage
--      share; escape → log) + activate the next boss. Used by the completion
--      trigger (instant defeat) and the nightly reset (escape, safety net).
--   2. strike_boss_on_completion(): BEFORE UPDATE OF status trigger on
--      task_slots. SECURITY DEFINER — it is the one intentional, controlled
--      path by which a child's own update writes bosses / boss_log /
--      applied_to_boss. The child's direct privileges are unchanged.
--   3. Child guard: a slot is locked once applied_to_boss is true, so damage
--      can't be re-triggered by un-ticking and re-ticking.
--   4. run_daily_reset(): the damage step is removed; misses, party health,
--      escape and activation are unchanged in behaviour.
--
-- TRIGGER ORDER MATTERS. Postgres fires BEFORE triggers in name order:
--   task_slots_check_allocation → task_slots_guard_child_writes
--   → task_slots_set_completed_at → task_slots_strike_boss
-- The guard must see the child's request before strike_boss sets
-- applied_to_boss, otherwise it would (correctly) reject the change.
--
-- LOCK ORDER: slot row → active boss row, in both the trigger and the
-- nightly job, so a child ticking a past slot while the job marks it missed
-- can't deadlock.

-- ---------------------------------------------------------------------------
-- 1. Shared end-of-boss logic
-- ---------------------------------------------------------------------------
create or replace function public.finish_boss(p_boss_id uuid, p_outcome text, p_today date)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  -- Tunables: gold for defeating a boss, by tier.
  c_gold_low  constant integer := 25;
  c_gold_mid  constant integer := 50;
  c_gold_epic constant integer := 100;

  v_boss   public.bosses%rowtype;
  v_gold   integer;
  v_awards jsonb := '[]'::jsonb;
  v_next   uuid;
  r        record;
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
    insert into public.boss_log (boss_id, event_type, amount)
      values (p_boss_id, 'defeated', v_gold);

    -- Split by each child's share of the damage dealt to this boss; the
    -- rounding remainder goes to the top damage dealer.
    for r in
      with dealt as (
        select child_id, sum(amount)::numeric as dmg
        from public.boss_log
        where boss_id = p_boss_id and event_type = 'damage' and child_id is not null
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
          values (p_boss_id, 'gold_awarded', r.gold, r.child_id);
        v_awards := v_awards || jsonb_build_object('child_id', r.child_id, 'gold', r.gold);
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
    'activated', v_next
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Instant damage on completion
-- ---------------------------------------------------------------------------
create or replace function public.strike_boss_on_completion()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  -- Tunable: same formula the nightly reset used — 1 minute = 1 damage.
  c_damage_per_minute constant integer := 1;

  v_family_id uuid;
  v_child_id  uuid;
  v_tz        text;
  v_boss      public.bosses%rowtype;
  v_amount    integer;
begin
  -- Only the transition into 'completed', and only once per slot.
  if new.status <> 'completed'
     or old.status = 'completed'
     or new.applied_to_boss then
    return new;
  end if;

  select p.family_id, p.child_id, f.timezone
    into v_family_id, v_child_id, v_tz
  from public.weekly_pools p
  join public.families f on f.id = p.family_id
  where p.id = new.pool_id;

  select * into v_boss from public.bosses
    where family_id = v_family_id and status = 'active'
    for update;
  if not found then
    -- No boss to hit: the slot stays unapplied (it can be un-ticked and
    -- re-ticked once a boss is active).
    return new;
  end if;

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

  return new;
end;
$$;

-- Named to sort AFTER task_slots_guard_child_writes (see header).
create trigger task_slots_strike_boss
  before update of status
  on public.task_slots
  for each row execute function public.strike_boss_on_completion();

-- ---------------------------------------------------------------------------
-- 3. Child guard: lock applied slots
-- ---------------------------------------------------------------------------
-- Same function as 20260922000005, plus: once applied_to_boss is true, a
-- child can't change the slot's status (so no un-tick / re-tick).
create or replace function public.guard_child_task_slot_writes()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
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
    if old.status <> 'scheduled' or old.applied_to_boss then
      raise exception 'slot_child_forbidden: only scheduled slots can be removed'
        using errcode = 'insufficient_privilege';
    end if;
    return old;
  end if;

  if tg_op = 'INSERT' then
    if new.status <> 'scheduled' then
      raise exception 'slot_child_forbidden: new slots must start as scheduled'
        using errcode = 'insufficient_privilege';
    end if;
    if new.applied_to_boss then
      raise exception 'slot_child_forbidden: applied_to_boss is set by the game engine'
        using errcode = 'insufficient_privilege';
    end if;
    return new;
  end if;

  -- UPDATE
  if new.applied_to_boss is distinct from old.applied_to_boss then
    raise exception 'slot_child_forbidden: applied_to_boss is set by the game engine'
      using errcode = 'insufficient_privilege';
  end if;
  if old.applied_to_boss and new.status is distinct from old.status then
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
-- 4. Nightly reset without the damage step
-- ---------------------------------------------------------------------------
--   0. If no boss is active, activate the next one.
--   1. Misses: every still-scheduled slot dated before today → 'missed';
--      with an active boss, the minutes damage party_health (per child).
--   2. Safety net: an active boss already at 0 HP → defeated (normally the
--      completion trigger has done this instantly).
--   3. Escape: party_health at 0 → boss escaped.
--   Party health at 0 is restored to max; finish_boss() activates the next.
-- Idempotent within a day ('missed' is the marker).
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
    'activated', v_activated
  );
end;
$$;

-- Internal helpers: not callable through the API.
revoke all on function public.finish_boss(uuid, text, date) from public, anon, authenticated;
revoke all on function public.strike_boss_on_completion() from public, anon, authenticated;
revoke all on function public.guard_child_task_slot_writes() from public, anon, authenticated;
-- run_daily_reset keeps its service-role-only grant from 20260923000006
-- (create or replace preserves privileges).
