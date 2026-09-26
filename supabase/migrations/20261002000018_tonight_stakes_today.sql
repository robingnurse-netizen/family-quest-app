-- Family Quest: tonight_stakes() counts TODAY's quests only.
--
--   * my_open_quests: the caller's slots scheduled for today (family time)
--     and still 'scheduled' — was scheduled_date <= today. The "<=" came
--     from …12's miss penalty (the reset would deal damage for every open
--     slot up to today); the Night Raid (…16) is earned per perfect day,
--     judged on that day's own slots, so overdue slots aren't tonight's
--     offer. Same count as the app's nudges (lib/backlog/quests-left.ts).
--   * open_quests / open_minutes are gone: family-wide totals left over
--     from the miss penalty, read by nothing.
--
-- Redefines tonight_stakes() from …16 with only those changes; create or
-- replace keeps its grant to authenticated. Hand-applied in the SQL editor:
-- one transaction; the check at the end raises (rolling back) if anything
-- is off.

begin;

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

  select count(*)
    into v_mine
    from public.task_slots s
    join public.weekly_pools p on p.id = s.pool_id
   where p.family_id = v_family and p.child_id = v_uid and s.status = 'scheduled' and s.scheduled_date = v_today;

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
    'raid_damage', case when v_has
      then greatest(0, least((v_boss.max_hp * c_raid_pct + 99) / 100, v_boss.current_hp - 1))
      else 0 end,
    'rescue_open', v_rescue);
end;
$$;

-- ---------------------------------------------------------------------------
-- Checks before committing
-- ---------------------------------------------------------------------------
do $$
begin
  if position('scheduled_date = v_today' in pg_get_functiondef('public.tonight_stakes()'::regprocedure)) = 0 then
    raise exception 'tonight stakes check: tonight_stakes still counts overdue slots';
  end if;
  if not has_function_privilege('authenticated', 'public.tonight_stakes()', 'execute') then
    raise exception 'tonight stakes check: signed-in users can no longer call tonight_stakes';
  end if;
  if has_function_privilege('anon', 'public.tonight_stakes()', 'execute') then
    raise exception 'tonight stakes check: tonight_stakes is callable signed out';
  end if;
end $$;

commit;
