-- Family Quest: rewards store — spending gold on reward_redemptions.
--
-- Until now a redemption request was only guarded by RLS: nothing checked
-- or deducted the child's gold. From here the database owns the accounting:
--
--   1. Request (insert): the reward must be active and in the child's
--      family. gold_spent is set from the reward's *current* gold_cost and
--      deducted from player_stats.gold immediately, in one atomic
--      check-and-update — concurrent requests serialize on the player_stats
--      row, so a burst of requests can never spend more than the balance.
--   2. Resolution (update): pending → approved | fulfilled | denied, and
--      approved → fulfilled | denied. Moving to denied refunds gold_spent
--      in the same transaction; approved / fulfilled keep it spent. Denied
--      and fulfilled are final. Only status (and resolved_by, set here)
--      can change.
--   3. RLS: the child still only inserts pending requests for themselves.
--      Parents may now only update (resolve) — no parent inserts or deletes,
--      so a deleted pending request can't make gold vanish.
--   4. A reward with redemptions can't be hard-deleted (the app deactivates
--      it instead): the foreign key no longer cascades.
--
-- These rules hold for every caller, service role included: they're the
-- gold ledger, not a UI guard.
--
-- Error prefixes (friendly text in lib/rewards/errors.ts):
--   redemption_insufficient_gold | redemption_reward_unavailable |
--   redemption_bad_status | redemption_immutable
--
-- Lock order: redemption row → player_stats row. The boss engine locks
-- slot → boss → player_stats, so there's no cycle.

-- ---------------------------------------------------------------------------
-- 4. Keep redemptions when a reward is deleted: refuse instead. NO ACTION
-- (checked at end of statement) rather than RESTRICT, so deleting a whole
-- family — which cascades to both tables — still works.
-- ---------------------------------------------------------------------------
alter table public.reward_redemptions
  drop constraint reward_redemptions_reward_id_fkey,
  add constraint reward_redemptions_reward_id_fkey
    foreign key (reward_id) references public.rewards (id) on delete no action;

-- Set by the request trigger from the reward's price; clients needn't send it.
alter table public.reward_redemptions alter column gold_spent set default 0;

-- ---------------------------------------------------------------------------
-- 1. Request: price it and spend the gold.
-- ---------------------------------------------------------------------------
create or replace function public.spend_gold_on_redemption()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reward public.rewards%rowtype;
begin
  if new.status <> 'pending' or new.resolved_by is not null then
    raise exception 'redemption_bad_status: new requests start as pending'
      using errcode = 'check_violation';
  end if;

  select * into v_reward from public.rewards where id = new.reward_id;
  if not found or v_reward.family_id <> new.family_id or not v_reward.active then
    raise exception 'redemption_reward_unavailable: reward % can''t be requested', new.reward_id
      using errcode = 'check_violation';
  end if;

  if not exists (
    select 1 from public.profiles
    where id = new.child_id and family_id = new.family_id and role = 'child'
  ) then
    raise exception 'redemption_reward_unavailable: % is not a player in this family', new.child_id
      using errcode = 'check_violation';
  end if;

  -- The current price and time, whatever the client sent.
  new.gold_spent := v_reward.gold_cost;
  new.redeemed_at := now();

  -- Atomic check-and-deduct. A concurrent request for the same child waits
  -- on this row lock, then re-checks against the balance this one left.
  update public.player_stats
  set gold = gold - new.gold_spent
  where child_id = new.child_id
    and gold >= new.gold_spent;
  if not found then
    raise exception 'redemption_insufficient_gold: % gold needed', new.gold_spent
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

drop trigger if exists reward_redemptions_spend_gold on public.reward_redemptions;
create trigger reward_redemptions_spend_gold
  before insert on public.reward_redemptions
  for each row execute function public.spend_gold_on_redemption();

-- ---------------------------------------------------------------------------
-- 2. Resolution: status transitions, refund on denial.
-- ---------------------------------------------------------------------------
create or replace function public.resolve_redemption()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.family_id  is distinct from old.family_id
     or new.child_id    is distinct from old.child_id
     or new.reward_id   is distinct from old.reward_id
     or new.gold_spent  is distinct from old.gold_spent
     or new.redeemed_at is distinct from old.redeemed_at then
    raise exception 'redemption_immutable: only a request''s status can change'
      using errcode = 'check_violation';
  end if;

  if new.status = old.status then
    new.resolved_by := old.resolved_by;
    return new;
  end if;

  if not (
    (old.status = 'pending' and new.status in ('approved', 'fulfilled', 'denied'))
    or (old.status = 'approved' and new.status in ('fulfilled', 'denied'))
  ) then
    raise exception 'redemption_bad_status: % → % isn''t allowed', old.status, new.status
      using errcode = 'check_violation';
  end if;

  -- Who resolved it (null for service-role / direct SQL changes).
  new.resolved_by := coalesce(auth.uid(), new.resolved_by);

  if new.status = 'denied' then
    insert into public.player_stats (child_id, gold) values (new.child_id, new.gold_spent)
    on conflict (child_id) do update
      set gold = public.player_stats.gold + excluded.gold;
  end if;

  return new;
end;
$$;

drop trigger if exists reward_redemptions_resolve on public.reward_redemptions;
create trigger reward_redemptions_resolve
  before update on public.reward_redemptions
  for each row execute function public.resolve_redemption();

revoke all on function public.spend_gold_on_redemption() from public;
revoke all on function public.resolve_redemption() from public;

-- ---------------------------------------------------------------------------
-- 3. Parents resolve requests; they don't create or delete them.
-- (The child's insert policy from 20260922000002_rls.sql is unchanged: it
-- still compares gold_spent to gold_cost, which the trigger has just set.)
-- ---------------------------------------------------------------------------
drop policy "reward_redemptions: parents write" on public.reward_redemptions;
create policy "reward_redemptions: parents resolve"
  on public.reward_redemptions for update to authenticated
  using (family_id = public.current_family_id() and public.is_parent())
  with check (family_id = public.current_family_id() and public.is_parent());

-- ---------------------------------------------------------------------------
-- Realtime: make sure the store's tables broadcast (idempotent, as in
-- 20260923000007_realtime_rpg_tables.sql).
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array['rewards', 'reward_redemptions', 'player_stats'] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
      raise notice 'Added public.% to supabase_realtime', t;
    end if;
  end loop;
end;
$$;
