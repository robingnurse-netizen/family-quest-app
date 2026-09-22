-- Family Quest: core schema
-- Phase 1 — Auth & Data Foundation

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- families
-- ---------------------------------------------------------------------------
create table public.families (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  timezone    text not null default 'Europe/London',
  -- Short code a second parent / child uses to join this family at signup.
  invite_code text not null unique
              default upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8)),
  created_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- profiles (1:1 with auth.users)
-- ---------------------------------------------------------------------------
create table public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  family_id    uuid not null references public.families (id) on delete cascade,
  display_name text not null,
  role         text not null check (role in ('parent', 'child')),
  created_at   timestamptz not null default now()
);
create index profiles_family_id_idx on public.profiles (family_id);

-- ---------------------------------------------------------------------------
-- calendar_events
-- ---------------------------------------------------------------------------
create table public.calendar_events (
  id              uuid primary key default gen_random_uuid(),
  family_id       uuid not null references public.families (id) on delete cascade,
  title           text not null,
  description     text,
  start_time      timestamptz not null,
  end_time        timestamptz,
  all_day         boolean not null default false,
  location        text,
  recurrence_rule text, -- RFC 5545 RRULE string
  created_by      uuid references public.profiles (id) on delete set null,
  created_at      timestamptz not null default now(),
  constraint calendar_events_time_order check (end_time is null or end_time >= start_time)
);
create index calendar_events_family_start_idx on public.calendar_events (family_id, start_time);

-- ---------------------------------------------------------------------------
-- weekly_pools
-- ---------------------------------------------------------------------------
create table public.weekly_pools (
  id              uuid primary key default gen_random_uuid(),
  family_id       uuid not null references public.families (id) on delete cascade,
  child_id        uuid not null references public.profiles (id) on delete cascade,
  week_start_date date not null,
  title           text not null,
  category        text,
  total_minutes   integer not null check (total_minutes > 0),
  color           text,
  created_by      uuid references public.profiles (id) on delete set null,
  created_at      timestamptz not null default now()
);
create index weekly_pools_family_week_idx on public.weekly_pools (family_id, week_start_date);
create index weekly_pools_child_week_idx on public.weekly_pools (child_id, week_start_date);

-- ---------------------------------------------------------------------------
-- task_slots
-- ---------------------------------------------------------------------------
create table public.task_slots (
  id               uuid primary key default gen_random_uuid(),
  pool_id          uuid not null references public.weekly_pools (id) on delete cascade,
  scheduled_date   date not null,
  duration_minutes integer not null check (duration_minutes > 0),
  sort_order       integer not null default 0,
  status           text not null default 'scheduled'
                   check (status in ('scheduled', 'completed', 'missed')),
  applied_to_boss  boolean not null default false,
  completed_at     timestamptz,
  created_at       timestamptz not null default now()
);
create index task_slots_pool_idx on public.task_slots (pool_id);
create index task_slots_date_idx on public.task_slots (scheduled_date);

-- ---------------------------------------------------------------------------
-- bosses
-- ---------------------------------------------------------------------------
create table public.bosses (
  id              uuid primary key default gen_random_uuid(),
  family_id       uuid not null references public.families (id) on delete cascade,
  name            text not null,
  tier            text not null check (tier in ('low', 'mid', 'epic')),
  sprite_key      text not null,
  max_hp          integer not null check (max_hp > 0),
  current_hp      integer not null check (current_hp >= 0),
  week_start_date date not null,
  status          text not null default 'inactive'
                  check (status in ('inactive', 'active', 'defeated', 'escaped')),
  created_at      timestamptz not null default now(),
  constraint bosses_hp_bounds check (current_hp <= max_hp)
);
create index bosses_family_week_idx on public.bosses (family_id, week_start_date);
-- At most one active boss per family at a time.
create unique index bosses_one_active_per_family
  on public.bosses (family_id) where status = 'active';

-- ---------------------------------------------------------------------------
-- boss_log
-- ---------------------------------------------------------------------------
create table public.boss_log (
  id                  uuid primary key default gen_random_uuid(),
  boss_id             uuid not null references public.bosses (id) on delete cascade,
  event_type          text not null
                      check (event_type in ('damage', 'miss_penalty', 'defeated', 'escaped')),
  amount              integer not null default 0,
  source_task_slot_id uuid references public.task_slots (id) on delete set null,
  created_at          timestamptz not null default now()
);
create index boss_log_boss_idx on public.boss_log (boss_id, created_at);

-- ---------------------------------------------------------------------------
-- party_health (one row per family)
-- ---------------------------------------------------------------------------
create table public.party_health (
  id         uuid primary key default gen_random_uuid(),
  family_id  uuid not null unique references public.families (id) on delete cascade,
  current_hp integer not null default 100 check (current_hp >= 0),
  max_hp     integer not null default 100 check (max_hp > 0),
  updated_at timestamptz not null default now(),
  constraint party_health_hp_bounds check (current_hp <= max_hp)
);
create trigger party_health_updated_at
  before update on public.party_health
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- player_stats (one row per child)
-- ---------------------------------------------------------------------------
create table public.player_stats (
  id             uuid primary key default gen_random_uuid(),
  child_id       uuid not null unique references public.profiles (id) on delete cascade,
  gold           integer not null default 0 check (gold >= 0),
  xp             integer not null default 0 check (xp >= 0),
  level          integer not null default 1 check (level >= 1),
  current_streak integer not null default 0 check (current_streak >= 0),
  pending_damage integer not null default 0 check (pending_damage >= 0),
  updated_at     timestamptz not null default now()
);
create trigger player_stats_updated_at
  before update on public.player_stats
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- companions
-- ---------------------------------------------------------------------------
create table public.companions (
  id         uuid primary key default gen_random_uuid(),
  child_id   uuid not null references public.profiles (id) on delete cascade,
  name       text not null,
  sprite_key text not null,
  unlocked   boolean not null default false,
  level      integer not null default 1 check (level >= 1),
  created_at timestamptz not null default now()
);
create index companions_child_idx on public.companions (child_id);

-- ---------------------------------------------------------------------------
-- rewards
-- ---------------------------------------------------------------------------
create table public.rewards (
  id          uuid primary key default gen_random_uuid(),
  family_id   uuid not null references public.families (id) on delete cascade,
  title       text not null,
  description text,
  gold_cost   integer not null check (gold_cost >= 0),
  icon        text,
  active      boolean not null default true,
  created_by  uuid references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now()
);
create index rewards_family_idx on public.rewards (family_id);

-- ---------------------------------------------------------------------------
-- reward_redemptions
-- ---------------------------------------------------------------------------
create table public.reward_redemptions (
  id          uuid primary key default gen_random_uuid(),
  family_id   uuid not null references public.families (id) on delete cascade,
  child_id    uuid not null references public.profiles (id) on delete cascade,
  reward_id   uuid not null references public.rewards (id) on delete cascade,
  gold_spent  integer not null check (gold_spent >= 0),
  status      text not null default 'pending'
              check (status in ('pending', 'approved', 'fulfilled', 'denied')),
  redeemed_at timestamptz not null default now(),
  resolved_by uuid references public.profiles (id) on delete set null
);
create index reward_redemptions_family_idx on public.reward_redemptions (family_id, status);
