I'm building "Family Quest" — a gamified family organizer PWA for my family
(Dad + Kirsty as admins, 10-year-old Reuben as the player).

Stack: Next.js (App Router) + Tailwind, dnd-kit + Framer Motion, Supabase
(Postgres + Realtime + Auth), deployed on Vercel, installable as a PWA.

First: save this whole message as CLAUDE.md in the project root so you have
persistent context in every future session.

Then, for THIS session, only do Phase 1 — Auth & Data Foundation. Do not
build calendar, kanban, or RPG UI yet.

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

For Phase 1: scaffold the Next.js project with this folder structure,
set up Tailwind, connect a Supabase client (I'll provide my project URL/
anon key when you ask), write the schema above as Supabase migrations
with RLS policies, and build a basic login/signup flow that creates a
profile row on signup and routes parents vs. Reuben to different
placeholder dashboards.

@AGENTS.md
