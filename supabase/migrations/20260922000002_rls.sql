-- Family Quest: Row Level Security
--
-- Rules:
--   * Everyone only sees rows belonging to their own family.
--   * Parents write calendar_events, weekly_pools, bosses, rewards
--     (and the admin-ish tables: families, party_health, player_stats,
--     companions, boss_log, redemption resolution, task_slots).
--   * The child can only write task_slots in their own pools and
--     insert their own reward_redemptions.
--   * Game-engine writes (damage, gold, streaks) happen server-side with the
--     service role key (e.g. /api/cron/daily-reset), which bypasses RLS.

-- ---------------------------------------------------------------------------
-- Helper functions (SECURITY DEFINER so they can read profiles without
-- recursing through profiles' own RLS policies).
-- ---------------------------------------------------------------------------
create or replace function public.current_family_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select family_id from public.profiles where id = auth.uid()
$$;

create or replace function public.is_parent()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles where id = auth.uid() and role = 'parent'
  )
$$;

revoke all on function public.current_family_id() from public;
revoke all on function public.is_parent() from public;
grant execute on function public.current_family_id() to authenticated;
grant execute on function public.is_parent() to authenticated;

-- ---------------------------------------------------------------------------
-- Enable RLS everywhere
-- ---------------------------------------------------------------------------
alter table public.families           enable row level security;
alter table public.profiles           enable row level security;
alter table public.calendar_events    enable row level security;
alter table public.weekly_pools       enable row level security;
alter table public.task_slots         enable row level security;
alter table public.bosses             enable row level security;
alter table public.boss_log           enable row level security;
alter table public.party_health       enable row level security;
alter table public.player_stats       enable row level security;
alter table public.companions         enable row level security;
alter table public.rewards            enable row level security;
alter table public.reward_redemptions enable row level security;

-- ---------------------------------------------------------------------------
-- families
-- (Rows are created by the signup trigger, never directly by clients.)
-- ---------------------------------------------------------------------------
create policy "families: members read"
  on public.families for select to authenticated
  using (id = public.current_family_id());

create policy "families: parents update"
  on public.families for update to authenticated
  using (id = public.current_family_id() and public.is_parent())
  with check (id = public.current_family_id());

-- ---------------------------------------------------------------------------
-- profiles
-- (Rows are created by the signup trigger. Users may only rename themselves;
-- role/family_id changes are blocked by the column grant below.)
-- ---------------------------------------------------------------------------
create policy "profiles: family read"
  on public.profiles for select to authenticated
  using (family_id = public.current_family_id());

create policy "profiles: self update"
  on public.profiles for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

revoke insert, update, delete on public.profiles from authenticated, anon;
grant update (display_name) on public.profiles to authenticated;

-- ---------------------------------------------------------------------------
-- Parent-managed, family-scoped tables:
--   calendar_events, weekly_pools, bosses, rewards
-- ---------------------------------------------------------------------------
create policy "calendar_events: family read"
  on public.calendar_events for select to authenticated
  using (family_id = public.current_family_id());
create policy "calendar_events: parents write"
  on public.calendar_events for all to authenticated
  using (family_id = public.current_family_id() and public.is_parent())
  with check (family_id = public.current_family_id() and public.is_parent());

create policy "weekly_pools: family read"
  on public.weekly_pools for select to authenticated
  using (family_id = public.current_family_id());
create policy "weekly_pools: parents write"
  on public.weekly_pools for all to authenticated
  using (family_id = public.current_family_id() and public.is_parent())
  with check (family_id = public.current_family_id() and public.is_parent());

create policy "bosses: family read"
  on public.bosses for select to authenticated
  using (family_id = public.current_family_id());
create policy "bosses: parents write"
  on public.bosses for all to authenticated
  using (family_id = public.current_family_id() and public.is_parent())
  with check (family_id = public.current_family_id() and public.is_parent());

create policy "rewards: family read"
  on public.rewards for select to authenticated
  using (family_id = public.current_family_id());
create policy "rewards: parents write"
  on public.rewards for all to authenticated
  using (family_id = public.current_family_id() and public.is_parent())
  with check (family_id = public.current_family_id() and public.is_parent());

-- ---------------------------------------------------------------------------
-- task_slots (scoped through weekly_pools)
-- Parents: any slot in their family. Child: slots in pools assigned to them.
-- ---------------------------------------------------------------------------
create policy "task_slots: family read"
  on public.task_slots for select to authenticated
  using (exists (
    select 1 from public.weekly_pools p
    where p.id = pool_id and p.family_id = public.current_family_id()
  ));

create policy "task_slots: parents write"
  on public.task_slots for all to authenticated
  using (public.is_parent() and exists (
    select 1 from public.weekly_pools p
    where p.id = pool_id and p.family_id = public.current_family_id()
  ))
  with check (public.is_parent() and exists (
    select 1 from public.weekly_pools p
    where p.id = pool_id and p.family_id = public.current_family_id()
  ));

create policy "task_slots: child writes own pools"
  on public.task_slots for all to authenticated
  using (exists (
    select 1 from public.weekly_pools p
    where p.id = pool_id and p.child_id = auth.uid()
  ))
  with check (exists (
    select 1 from public.weekly_pools p
    where p.id = pool_id and p.child_id = auth.uid()
  ));

-- ---------------------------------------------------------------------------
-- boss_log (scoped through bosses). Read-only for clients except parents.
-- ---------------------------------------------------------------------------
create policy "boss_log: family read"
  on public.boss_log for select to authenticated
  using (exists (
    select 1 from public.bosses b
    where b.id = boss_id and b.family_id = public.current_family_id()
  ));

create policy "boss_log: parents write"
  on public.boss_log for all to authenticated
  using (public.is_parent() and exists (
    select 1 from public.bosses b
    where b.id = boss_id and b.family_id = public.current_family_id()
  ))
  with check (public.is_parent() and exists (
    select 1 from public.bosses b
    where b.id = boss_id and b.family_id = public.current_family_id()
  ));

-- ---------------------------------------------------------------------------
-- party_health
-- ---------------------------------------------------------------------------
create policy "party_health: family read"
  on public.party_health for select to authenticated
  using (family_id = public.current_family_id());
create policy "party_health: parents write"
  on public.party_health for all to authenticated
  using (family_id = public.current_family_id() and public.is_parent())
  with check (family_id = public.current_family_id() and public.is_parent());

-- ---------------------------------------------------------------------------
-- player_stats / companions (scoped through the child's profile)
-- ---------------------------------------------------------------------------
create policy "player_stats: family read"
  on public.player_stats for select to authenticated
  using (exists (
    select 1 from public.profiles c
    where c.id = child_id and c.family_id = public.current_family_id()
  ));
create policy "player_stats: parents write"
  on public.player_stats for all to authenticated
  using (public.is_parent() and exists (
    select 1 from public.profiles c
    where c.id = child_id and c.family_id = public.current_family_id()
  ))
  with check (public.is_parent() and exists (
    select 1 from public.profiles c
    where c.id = child_id and c.family_id = public.current_family_id()
  ));

create policy "companions: family read"
  on public.companions for select to authenticated
  using (exists (
    select 1 from public.profiles c
    where c.id = child_id and c.family_id = public.current_family_id()
  ));
create policy "companions: parents write"
  on public.companions for all to authenticated
  using (public.is_parent() and exists (
    select 1 from public.profiles c
    where c.id = child_id and c.family_id = public.current_family_id()
  ))
  with check (public.is_parent() and exists (
    select 1 from public.profiles c
    where c.id = child_id and c.family_id = public.current_family_id()
  ));

-- ---------------------------------------------------------------------------
-- reward_redemptions
-- Child: may insert a 'pending' redemption for themselves, for an active
-- reward in their family, spending exactly its cost. Parents: full control.
-- ---------------------------------------------------------------------------
create policy "reward_redemptions: family read"
  on public.reward_redemptions for select to authenticated
  using (family_id = public.current_family_id());

create policy "reward_redemptions: child requests"
  on public.reward_redemptions for insert to authenticated
  with check (
    child_id = auth.uid()
    and family_id = public.current_family_id()
    and status = 'pending'
    and resolved_by is null
    and exists (
      select 1 from public.rewards r
      where r.id = reward_id
        and r.family_id = public.current_family_id()
        and r.active
        and r.gold_cost = gold_spent
    )
  );

create policy "reward_redemptions: parents write"
  on public.reward_redemptions for all to authenticated
  using (family_id = public.current_family_id() and public.is_parent())
  with check (family_id = public.current_family_id() and public.is_parent());

-- ---------------------------------------------------------------------------
-- Realtime: broadcast changes for the live-updating tables.
-- ---------------------------------------------------------------------------
alter publication supabase_realtime add table
  public.calendar_events,
  public.weekly_pools,
  public.task_slots,
  public.bosses,
  public.boss_log,
  public.party_health,
  public.player_stats,
  public.rewards,
  public.reward_redemptions;
