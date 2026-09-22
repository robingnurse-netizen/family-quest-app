-- Family Quest: weekly pool / task slot integrity (Flexible Backlog).
--
-- Enforced in the database so no client (UI bug, stale tab, direct API call)
-- can break these rules:
--   1. A pool's task_slots never sum to more than its total_minutes.
--   2. A slot's scheduled_date falls inside its pool's week (Mon–Sun).
--   3. Pools start on a Monday.
--   4. completed_at is maintained from status, not trusted from the client.
--
-- Errors are raised with stable message prefixes so the app can show a
-- friendly message:  pool_over_allocated | slot_outside_week | pool_below_allocated

-- ---------------------------------------------------------------------------
-- 3. Weeks start on Monday (ISO day-of-week 1).
-- ---------------------------------------------------------------------------
alter table public.weekly_pools
  add constraint weekly_pools_week_starts_monday
  check (extract(isodow from week_start_date) = 1);

-- ---------------------------------------------------------------------------
-- 1 + 2. Slot checks, on insert and on any update that could change the sum
-- or the day. SECURITY DEFINER so the pool row can be locked and every slot
-- in it summed regardless of the caller's RLS view.
-- ---------------------------------------------------------------------------
create or replace function public.check_task_slot_allocation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  pool       public.weekly_pools%rowtype;
  allocated  integer;
begin
  -- Lock the pool row: concurrent inserts into the same pool (two tabs, two
  -- devices) serialize here, so they can't both pass the check.
  select * into pool from public.weekly_pools where id = new.pool_id for update;
  if not found then
    raise exception 'pool_not_found: pool % does not exist', new.pool_id;
  end if;

  if new.scheduled_date < pool.week_start_date
     or new.scheduled_date > pool.week_start_date + 6 then
    raise exception 'slot_outside_week: % is not in the week of %',
      new.scheduled_date, pool.week_start_date
      using errcode = 'check_violation';
  end if;

  select coalesce(sum(duration_minutes), 0) into allocated
  from public.task_slots
  where pool_id = new.pool_id
    and id <> new.id;

  if allocated + new.duration_minutes > pool.total_minutes then
    raise exception 'pool_over_allocated: % + % minutes exceeds the pool''s % minutes',
      allocated, new.duration_minutes, pool.total_minutes
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

create trigger task_slots_check_allocation
  before insert or update of pool_id, duration_minutes, scheduled_date
  on public.task_slots
  for each row execute function public.check_task_slot_allocation();

-- ---------------------------------------------------------------------------
-- 1 + 2 (other side). A pool can't shrink below what's already scheduled, or
-- move to a week that strands its slots.
-- ---------------------------------------------------------------------------
create or replace function public.check_weekly_pool_allocation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  allocated integer;
begin
  select coalesce(sum(duration_minutes), 0) into allocated
  from public.task_slots
  where pool_id = new.id;

  if allocated > new.total_minutes then
    raise exception 'pool_below_allocated: % minutes are already scheduled', allocated
      using errcode = 'check_violation';
  end if;

  if new.week_start_date <> old.week_start_date and exists (
    select 1 from public.task_slots
    where pool_id = new.id
      and (scheduled_date < new.week_start_date
           or scheduled_date > new.week_start_date + 6)
  ) then
    raise exception 'slot_outside_week: remove this pool''s scheduled slots before changing its week'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

create trigger weekly_pools_check_allocation
  before update of total_minutes, week_start_date
  on public.weekly_pools
  for each row execute function public.check_weekly_pool_allocation();

-- ---------------------------------------------------------------------------
-- 4. completed_at follows status.
-- ---------------------------------------------------------------------------
create or replace function public.set_task_slot_completed_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status = 'completed' then
    if tg_op = 'INSERT' or old.status is distinct from 'completed' then
      new.completed_at := now();
    else
      new.completed_at := old.completed_at;
    end if;
  else
    new.completed_at := null;
  end if;
  return new;
end;
$$;

create trigger task_slots_set_completed_at
  before insert or update
  on public.task_slots
  for each row execute function public.set_task_slot_completed_at();

revoke all on function public.check_task_slot_allocation() from public;
revoke all on function public.check_weekly_pool_allocation() from public;
revoke all on function public.set_task_slot_completed_at() from public;
