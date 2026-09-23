-- Family Quest: a child can't plan quests on days that have already gone.
--
-- Extends the child slot guard (20260922000005_child_slot_guard.sql): for
-- callers whose profile role is 'child', a slot can't be INSERTed on a date
-- before today, or UPDATEd to move it onto one. "Today" is the family's
-- local date (families.timezone), found via the slot's pool.
--
-- Everything else is unchanged:
--   * ticking a slot on a past day is still allowed (its date doesn't
--     change), and so is moving a past slot onto today or later;
--   * the original child rules (status / applied_to_boss / delete) stay;
--   * parents, the service role (nightly reset) and direct SQL are
--     unaffected (no child profile for auth.uid()).
--
-- The function is replaced in place and the trigger keeps its name:
-- task_slots_strike_boss must still sort after task_slots_guard_child_writes.
-- Safe to re-run.
--
-- Error prefix for the app: slot_past_day

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
    if old.status <> 'scheduled' or old.applied_to_boss then
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
  if new.status is distinct from old.status
     and not (old.status in ('scheduled', 'completed')
              and new.status in ('scheduled', 'completed')) then
    raise exception 'slot_child_forbidden: status can only toggle between scheduled and completed'
      using errcode = 'insufficient_privilege';
  end if;

  return new;
end;
$$;

-- Same trigger, same name (ordering with task_slots_strike_boss matters).
drop trigger if exists task_slots_guard_child_writes on public.task_slots;
create trigger task_slots_guard_child_writes
  before insert or update or delete
  on public.task_slots
  for each row execute function public.guard_child_task_slot_writes();

revoke all on function public.guard_child_task_slot_writes() from public;
