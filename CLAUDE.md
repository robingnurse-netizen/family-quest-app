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
    up later. (Reward gold is now enforced — see Rewards Store.)
- RPG Phase B1 — Sprite Pipeline: COMPLETE.
  * scripts/slice-sprites.mjs (sharp) slices /assets into
    public/sprites/<key>/<animation>/frame-NN.png (178 frames, 10
    characters) and writes components/rpg/sprites/manifests/<key>.json.
    Boss keys = bosses.sprite_key; hero = "hero", dog companion = "rogue".
    Background removed by flood fill; crop coordinates, per-animation fps,
    alignment ("feet" default, "mass" for Rogue's run) and dropFrames live
    in the script's SHEETS config. Re-run per character after any change:
    node scripts/slice-sprites.mjs <key>
  * Sprites are fully decoupled behind the manifests: art can be swapped
    later (new sheets → re-slice, or hand-made frames + a manifest) without
    touching game logic. Components only know manifest keys + animation
    names (idle/move/attack/hurt/death/defeated, etc.).
  * SpriteAnimator.tsx plays a manifest animation (rAF, preloads frames,
    reduced-motion safe). One-shot animations play once and hold the last
    frame; replayDelayMs replays them (previews only).
  * Hero + Rogue idle on the player dashboard (components/rpg/hero/hero-party.tsx).
  * Known art limits: single-frame animations (Cable Spider all; Alarm
    Clock Swarm idle/move/hurt/death; Slime hurt/death; Goblin death) are
    static; Chronosphinx attack frames 3–4 share an overlapping beam;
    Shogun-Bot idle drops sheet frames 5 and 7 (sword flash).
  * Future art requirement (not built): when the sprite art is redone,
    boss idle should reflect current_hp — pristine above ~66%, worn at
    ~33–66%, heavily damaged below ~33% — instead of one idle loop at
    every HP. Hero and Rogue get the same treatment from party HP (see
    "FUTURE — Battle feedback redesign" under Phase B2).
- RPG Phase B2 — Boss Battle Rendering: COMPLETE. BossStatus (both
  dashboards) shows the active boss's sprite reacting to Realtime events:
  boss_log damage / miss_penalty → hurt once (epic bosses use the first 3
  frames of `defeated`); status defeated → death once + hold; escaped →
  move loop sliding off; then the next boss enters. State machine in
  lib/rpg/boss-stage.ts (pure reducer); the on-stage boss (sprite, name, HP)
  briefly lags the DB while a finished boss plays out. Animation mapping in
  components/rpg/sprites/boss-animations.ts. Data-driven only — no manual
  battle controls or floating damage numbers. On /player the boss panel
  (BossHud) pins to the BOTTOM of the viewport once <90% of it is on screen,
  so reactions stay visible while Reuben ticks quests. Not top: Chrome's
  hiding toolbar (ChromeOS tablet mode) slides over top-pinned content.
  The `compact` Tailwind variant (globals.css: width < 48rem, height < 50rem,
  or inside [data-pinned]) makes it one row with a half-scale stage. The parent
  dashboard's panel is unchanged.
  BossHud decides pinned/unpinned in a layout effect before the hydrated
  page paints, and slides in only on scroll-triggered pins (not on load).
  ACCEPTED LIMITATION — don't reopen unless asked: before hydration the
  server-rendered panel briefly sits in-flow (off-screen if scrolled past),
  then appears pinned without animation. Pure CSS (sticky) can't pin in
  both scroll directions, so this flash stays.
  * FUTURE — Battle feedback redesign (design note, NOT to be built yet):
    - The battle scene (hero, Rogue and boss together, built in Stage 2)
      sits fixed at the top of Reuben's dashboard in normal page flow,
      with no sticky/pinned behaviour.
    - Instead, ticking a task off plays a high-energy hit animation
      centred in whatever part of the page he's scrolled to: hero strikes,
      explosive impact, damage number, screen shake. Then the characters
      "return" to their places in the battle scene at the top.
    - Back in the scene, each character idles in a visibly damaged state
      by HP: the boss from boss HP, the hero and Rogue from party HP (ties
      in with the HP-based idle art note under Phase B1).
    - Once the overlay exists, remove the sticky boss panel (BossHud) and
      its compact variant; the overlay replaces the job they do.
    - Until then, Stage 2 KEEPS the current sticky compact behaviour so
      Reuben doesn't lose feedback when scrolled down.
- Rewards Store: COMPLETE, pushed as b2104a3. Tested live: reward creation, redeem with live
  gold deduction, approve → fulfil, deny with refund (both dashboards), and
  the gold-gated Redeem button with "how much more" messaging.
  * 20260923000009_rewards_store.sql: BEFORE INSERT trigger on
    reward_redemptions prices a request from the reward's current gold_cost
    (overwrites gold_spent / redeemed_at) and deducts it from
    player_stats.gold in one atomic `update … where gold >= cost` — concurrent
    requests serialize on that row, so they can't overspend. BEFORE UPDATE
    trigger: only status changes; pending → approved|fulfilled|denied,
    approved → fulfilled|denied; → denied refunds gold_spent in the same
    transaction; denied/fulfilled are final; resolved_by = auth.uid().
    These hold for every caller (it's the gold ledger). Parents may only
    UPDATE redemptions (no insert/delete). reward_id FK is NO ACTION, so a
    reward with requests can't be deleted — the UI hides it (active=false).
  * Parent: /parent/rewards (catalog: emoji icon palette in
    lib/rewards/icons.ts, hide/show, delete only if never requested) + the
    request queue (also live on /parent): Approve / Deny (refund) / Fulfilled.
  * Player: /player/store — spendable gold (live from player_stats), reward
    cards with Redeem (disabled when short), confirm step, "waiting for a
    grown-up" requests, recent results.
  * Realtime: lib/hooks/use-reward-store.ts (rewards, reward_redemptions,
    and the player's player_stats row). Friendly trigger errors in
    lib/rewards/errors.ts.
- Visual overhaul Stage 1 — Design foundation (player pages only): COMPLETE.
  Tactile 16-bit RPG look; Parent HQ keeps its own look.
  * Tokens in app/globals.css (@theme): purple is the world background
    only (.bg-world, dithered); surfaces are materials — stone (HUD),
    wood (boards/frames), parchment (cards/notes/shop), inset wells.
    Contrast checked for every text pairing (AA).
  * Primitives in components/ui/: Panel (+ panelClass), PixelButton
    (+ pixelButtonClass; 4px ledge, presses down, flat grey disabled),
    GameHeading, pixel icons in icons.tsx (coin, star, flame, shield,
    heart, skull — character grids, crispEdges).
  * Fonts load in app/(player)/layout.tsx only: Pixelify Sans (display)
    and Nunito (body), used as font-display / font-body. DIGIT RULE:
    Pixelify at weight 600 only (700 fills in 2/3/5), and numbers under
    ~24px use Nunito extra-bold — Pixelify's small digits are ambiguous.
    `@theme inline` font tokens aren't real CSS variables: plain CSS must
    use var(--font-pixelify) / var(--font-nunito).
  * Every sprite renders image-rendering: pixelated (SpriteAnimator).
  * Shared components keep Parent HQ unchanged via per-variant style keys
    (BossStatus styles, calendar theme.ts); SignOutButton and WeekNav take
    their full styling from the caller.
  * UI wording: weekly_pools are "weekly quests" on screen (code, table
    and routes still say pool).

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
/components/calendar, /kanban, /rewards, /rpg/{sprites,boss,hero,companion}
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
