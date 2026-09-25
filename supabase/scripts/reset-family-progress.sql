-- ============================================================================
-- ONE-OFF: reset the family's game progress and boss roster (testing).
-- NOT a migration — paste into the Supabase SQL editor by hand.
--
-- ⚠️  THIS IS YOUR ONLY FAMILY. It holds BOTH children — "Test" and REUBEN —
--     so this wipes Reuben's real progress too (gold, XP, level, streaks,
--     quest history, reward requests). Bosses and party HP are family-wide:
--     they can't be reset for one child only.
--
-- Family: 19b7bb5a-92ea-4b44-9f9f-c0937c2b5d94 ("Hepburn/Nurse",
-- Europe/London). Found 2026-09-25 with a read-only service-role query of
-- the live project (REST: families?select=id,name,timezone and
-- profiles?select=id,family_id,display_name,role): it is the only row in
-- `families`; its profiles are Robin Nurse (parent), Test (child) and
-- Reuben (child); 8 bosses (7 defeated, 1 active) before this reset.
--
-- Needs migration 20260927000013_mid_tier_bosses.sql applied FIRST, or
-- step 7 reseeds the old 8-boss roster (no mid tier).
--
-- All-or-nothing: any error rolls the whole thing back.
-- ============================================================================

begin;

-- 0. Guard: stop if this isn't the family (wrong project, or the id
--    changed). Nothing below runs.
do $$
begin
  if not exists (
    select 1 from public.families
    where id = '19b7bb5a-92ea-4b44-9f9f-c0937c2b5d94' and name = 'Hepburn/Nurse'
  ) then
    raise exception 'reset aborted: family 19b7bb5a… (Hepburn/Nurse) not found';
  end if;
end $$;

-- 1. Recaps ("while you were away" rows). Deleted first; their boss
--    references would only null out anyway (on delete set null).
delete from public.reset_recaps
where family_id = '19b7bb5a-92ea-4b44-9f9f-c0937c2b5d94';

-- 2. The boss roster. boss_log (damage, defeats, escapes, gold awards,
--    activations) goes with it: boss_log.boss_id is ON DELETE CASCADE.
delete from public.bosses
where family_id = '19b7bb5a-92ea-4b44-9f9f-c0937c2b5d94';

-- 3. Quest history: every slot on the family's weekly quests (completed,
--    missed and still scheduled). The weekly quests themselves
--    (weekly_pools: title, minutes, colour) are KEPT, so you don't have to
--    re-create them — Reuben/Test just re-plan the week on the board.
--    (The child-slot guard trigger lets SQL-editor deletes through: it only
--    restricts child accounts.)
delete from public.task_slots s
using public.weekly_pools p
where p.id = s.pool_id
  and p.family_id = '19b7bb5a-92ea-4b44-9f9f-c0937c2b5d94';

-- 3-ALT (instead of 3): keep today's and future planned quests, delete only
-- the history (past days, anything completed or missed). Comment out 3 and
-- uncomment this if you'd rather not re-plan the current week.
-- delete from public.task_slots s
-- using public.weekly_pools p
-- where p.id = s.pool_id
--   and p.family_id = '19b7bb5a-92ea-4b44-9f9f-c0937c2b5d94'
--   and (s.status <> 'scheduled'
--        or s.scheduled_date < (now() at time zone 'Europe/London')::date);

-- 3-OPTIONAL (after 3): also delete the weekly quests themselves, for a
-- completely empty board. (task_slots would cascade with them anyway.)
-- delete from public.weekly_pools
-- where family_id = '19b7bb5a-92ea-4b44-9f9f-c0937c2b5d94';

-- 4. Reward requests (pending, approved, fulfilled, denied). They record
--    gold already spent, so they'd be stale against the gold reset below.
--    The reward catalogue (rewards) is KEPT. No delete trigger exists on
--    reward_redemptions (its triggers are insert/update), so nothing is
--    refunded — gold is reset to 0 in step 5 anyway.
delete from public.reward_redemptions
where family_id = '19b7bb5a-92ea-4b44-9f9f-c0937c2b5d94';

-- 4b. Party healing log (potions bought, perfect-day heals). Parent HQ's
--     "Party healing" list would otherwise show old entries.
delete from public.party_log
where family_id = '19b7bb5a-92ea-4b44-9f9f-c0937c2b5d94';

-- 5. Player stats back to their starting values (the column defaults), for
--    BOTH children. streak_through null = the next nightly reset evaluates
--    yesterday only (a first run), as for a new player.
update public.player_stats
set gold = 0,
    xp = 0,
    level = 1,
    current_streak = 0,
    best_streak = 0,
    streak_through = null,
    pending_damage = 0,
    updated_at = now()
where child_id in (
  select id from public.profiles
  where family_id = '19b7bb5a-92ea-4b44-9f9f-c0937c2b5d94' and role = 'child'
);
-- 5-ALT (instead of 5): reset only the "Test" child's stats and leave
-- Reuben's gold/XP/streaks alone (bosses, party HP and quest history above
-- are still family-wide).
-- update public.player_stats
-- set gold = 0, xp = 0, level = 1, current_streak = 0, best_streak = 0,
--     streak_through = null, pending_damage = 0, updated_at = now()
-- where child_id = 'f1b872bd-1c69-4bc0-bb23-2249b45b0c17';  -- "Test"

-- 6. Party HP back to full.
update public.party_health
set current_hp = max_hp,
    updated_at = now()
where family_id = '19b7bb5a-92ea-4b44-9f9f-c0937c2b5d94';

-- 7. Reseed the roster: all 12 bosses, low → mid → epic (queue 1–4 per
--    tier), all 'inactive' at full HP. It only seeds a family with no
--    bosses, which step 2 guarantees.
select public.seed_family_bosses('19b7bb5a-92ea-4b44-9f9f-c0937c2b5d94');

-- 8. Activate the first boss (Trash-Bag Slime: lowest tier, queue 1) for
--    today's week in the family's timezone; logs an 'activated' row.
select public.activate_next_boss(
  '19b7bb5a-92ea-4b44-9f9f-c0937c2b5d94',
  (now() at time zone 'Europe/London')::date
);

-- 9. Check before committing: expect 12 bosses (1 active: Trash-Bag Slime),
--    0 slots / redemptions / recaps / party log, stats at 0 / level 1,
--    party at max. (The SQL editor shows the last result set.)
select
  (select count(*) from public.bosses
     where family_id = '19b7bb5a-92ea-4b44-9f9f-c0937c2b5d94')                    as bosses,
  (select name from public.bosses
     where family_id = '19b7bb5a-92ea-4b44-9f9f-c0937c2b5d94' and status = 'active') as active_boss,
  (select count(*) from public.task_slots s join public.weekly_pools p on p.id = s.pool_id
     where p.family_id = '19b7bb5a-92ea-4b44-9f9f-c0937c2b5d94')                  as task_slots,
  (select count(*) from public.reward_redemptions
     where family_id = '19b7bb5a-92ea-4b44-9f9f-c0937c2b5d94')                    as redemptions,
  (select count(*) from public.reset_recaps
     where family_id = '19b7bb5a-92ea-4b44-9f9f-c0937c2b5d94')                    as recaps,
  (select count(*) from public.party_log
     where family_id = '19b7bb5a-92ea-4b44-9f9f-c0937c2b5d94')                    as party_log,
  (select string_agg(pr.display_name || ': ' || ps.gold || 'g ' || ps.xp || 'xp L' || ps.level
                     || ' streak ' || ps.current_streak, '; ')
     from public.player_stats ps join public.profiles pr on pr.id = ps.child_id
     where pr.family_id = '19b7bb5a-92ea-4b44-9f9f-c0937c2b5d94')                 as stats,
  (select current_hp || '/' || max_hp from public.party_health
     where family_id = '19b7bb5a-92ea-4b44-9f9f-c0937c2b5d94')                    as party_hp;

commit;
