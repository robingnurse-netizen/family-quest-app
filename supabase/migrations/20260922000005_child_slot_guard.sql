-- Family Quest: limit what a child can write on task_slots.
--
-- RLS lets a child write slots in their own pools (needed to schedule, move,
-- remove and tick off slots), but RLS can't restrict individual columns or
-- values. Without this, a child's account could call the API directly and
-- set status = 'missed' or flip applied_to_boss — both of which belong to
-- the daily-reset job (service role key).
--
-- For callers whose profile role is 'child':
--   * INSERT: status must be 'scheduled' and applied_to_boss false.
--   * UPDATE: applied_to_boss can't change; status may only move between
--     'scheduled' and 'completed' (never to or from 'missed').
--   * DELETE: only slots that are still 'scheduled' and not applied_to_boss
--     (so missed / completed / already-counted slots can't be erased).
--
-- Safe to re-run: the function is replaced and the trigger recreated.
--
-- Unaffected: parents, the service role (no auth.uid()), and direct SQL.
-- Error prefix for the app: slot_child_forbidden

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
  if new.status is distinct from old.status
     and not (old.status in ('scheduled', 'completed')
              and new.status in ('scheduled', 'completed')) then
    raise exception 'slot_child_forbidden: status can only toggle between scheduled and completed'
      using errcode = 'insufficient_privilege';
  end if;

  return new;
end;
$$;

drop trigger if exists task_slots_guard_child_writes on public.task_slots;
create trigger task_slots_guard_child_writes
  before insert or update or delete
  on public.task_slots
  for each row execute function public.guard_child_task_slot_writes();

revoke all on function public.guard_child_task_slot_writes() from public;
