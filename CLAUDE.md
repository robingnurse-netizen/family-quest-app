I'm building "Family Quest" — a gamified family organizer PWA for my family
(Dad + Kirsty as admins, 10-year-old Reuben as the player).

Stack: Next.js (App Router) + Tailwind, dnd-kit + Framer Motion, Supabase
(Postgres + Realtime + Auth), deployed on Vercel, installable as a PWA.

First: save this whole message as CLAUDE.md in the project root so you have
persistent context in every future session.

PROJECT STATUS:
- Phase 1 — Auth & Data Foundation: COMPLETE, pushed as 947bcd8 on main
  (scaffold, Tailwind, Supabase clients, schema + RLS migrations,
  signup/login with profile creation, parent/player placeholder dashboards).
- Phase 2 — Fixed Calendar: COMPLETE (month view, parent add/edit/delete,
  read-only player view, Realtime on calendar_events, weekly recurrence
  stored as RRULE FREQ=WEEKLY;BYDAY=..;UNTIL=.. — edits/deletes act on the
  whole series; per-occurrence editing is a later improvement).
- Flexible Backlog (weekly pools + task slots): COMPLETE. Parent pool
  management at /parent/pools (live summary on /parent); player drag-and-drop
  week board on /player (dnd-kit). DB triggers in migration
  20260922000004_pool_integrity.sql cap slots at the pool's total_minutes,
  keep slots inside the pool's Mon–Sun week, and set completed_at from status.
- Child slot guard (migration 20260922000005): COMPLETE, pushed as 30c6839
  and 00f667e. A child can only insert 'scheduled' slots, toggle status
  between 'scheduled' and 'completed', and delete slots that are still
  'scheduled' and not applied_to_boss; never set 'missed' or touch
  applied_to_boss. Parents, the service role and direct SQL are unaffected.
  Game-engine writes MUST use the service role key, never a user session.
- RPG Phase A — Boss Data & Daily Reset Engine: COMPLETE.
  * 20260923000006_boss_engine.sql: per-family boss roster seeded on family
    creation (4 low → 4 epic, activated in that order; Trash-Bag Slime
    first), boss_log.child_id for damage attribution, run_daily_reset() /
    run_daily_reset_all() Postgres functions (service role only). A child
    reads only their own player_stats / companions.
  * 20260923000007_realtime_rpg_tables.sql: idempotently ensures bosses,
    boss_log, party_health, player_stats are in supabase_realtime.
  * 20260923000008_instant_damage.sql: INSTANT DAMAGE REPLACED the original
    "pending damage applied at midnight" design. Completing a slot damages
    the active boss immediately (1 min = 1 damage) via trigger
    task_slots_strike_boss (SECURITY DEFINER — the one controlled bypass of
    the child guard), logs it, sets applied_to_boss and locks the slot (no
    un-tick / re-tick). Shared end-of-boss logic is finish_boss(): defeat →
    gold split by damage share (low 25 / mid 50 / epic 100) → next boss;
    escape → next boss. The nightly job (/api/cron/daily-reset, 00:05 UTC)
    now only marks past open slots 'missed', damages party_health, handles
    escape at party 0 (and any boss left at 0 HP), and refills the party.
    player_stats.pending_damage is unused.
  * BEFORE triggers fire in name order: task_slots_strike_boss must sort
    after task_slots_guard_child_writes — don't rename it. Lock order is
    slot row → boss row in both the trigger and the nightly job.
  * Parent dashboard has a "Run daily reset now" testing aid (own family
    only, same engine as the cron); remove/hide once the schedule's trusted.
  * Known open points: completions on future-dated slots strike immediately;
    completed-but-unapplied slots (no active boss at the time) aren't swept
    up later; reward requests don't yet check/deduct gold.
- Later: RPG Phase B (sprites, battle UI, rewards store).

DATABASE SCHEMA (Supabase/Postgres):
- families: id, name, timezone, created_at
- profiles: id (=auth.users.id), family_id→families, display_name,
  role ('parent'|'child'), created_at
- calendar_events: id, family_id, title, description, start_time, end_time,
  all_day, location, recurrence_rule, created_by→profiles
- weekly_pools: id, family_id, child_id→profiles, week_start_date, title,
  category, total_minutes, color, created_by
- task_slots: id, pool_id→weekly_pools, scheduled_date, duration_minutes,
  sort_order, status ('scheduled'|'completed'|'missed'), applied_to_boss bool,
  completed_at
- bosses: id, family_id, name, tier ('low'|'mid'|'epic'), sprite_key,
  max_hp, current_hp, week_start_date, status
  ('inactive'|'active'|'defeated'|'escaped')
- boss_log: id, boss_id, event_type ('damage'|'miss_penalty'|'defeated'|
  'escaped'), amount, source_task_slot_id→task_slots (nullable), created_at
- party_health: id, family_id (unique), current_hp, max_hp, updated_at
- player_stats: id, child_id→profiles (unique), gold, xp, level,
  current_streak, pending_damage, updated_at
- companions: id, child_id→profiles, name, sprite_key, unlocked, level
- rewards: id, family_id, title, description, gold_cost, icon, active,
  created_by
- reward_redemptions: id, family_id, child_id, reward_id, gold_spent,
  status ('pending'|'approved'|'fulfilled'|'denied'), redeemed_at,
  resolved_by

RLS: every table scopes on family_id matching the caller's profile.
Parents can write to bosses/calendar_events/weekly_pools/rewards.
Reuben can only write task_slots (his own pools) and reward_redemptions.

FOLDER STRUCTURE:
/app/(auth), /app/(parent), /app/(player), /app/api/cron/daily-reset
/components/calendar, /kanban, /rpg/{sprites,boss,hero,companion}
/lib/supabase, /lib/game-logic, /lib/hooks
/public/sprites — I have sprite sheets in /assets: hero, companion (dog),
4 low-level bosses (one sheet), and 4 epic bosses (Magma Behemoth,
Chronosphinx, Abyssal Kraken, Shogun-Bot). Don't process these yet —
just leave them in /assets for Phase 3.

Original Phase 1 brief (done): scaffold the Next.js project with this folder structure,
set up Tailwind, connect a Supabase client (I'll provide my project URL/
anon key when you ask), write the schema above as Supabase migrations
with RLS policies, and build a basic login/signup flow that creates a
profile row on signup and routes parents vs. Reuben to different
placeholder dashboards.

@AGENTS.md
