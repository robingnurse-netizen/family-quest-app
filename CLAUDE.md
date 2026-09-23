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
- RPG Phase B2 — Boss Battle Rendering: COMPLETE (restyled for the player
  in visual overhaul Stage 2, below). Boss sprites react to battle events:
  damage → hurt once (epic bosses use the first 3 frames of `defeated`);
  miss → the boss's attack once (it hits the party; it used to flinch);
  defeated → death once + hold; escaped → move loop sliding off; then the
  next boss enters. State machine in lib/rpg/boss-stage.ts (pure reducer);
  the on-stage boss (sprite, name, HP) briefly lags the DB while a finished
  boss plays out. Animation mapping in components/rpg/sprites/
  boss-animations.ts. Data-driven only — no manual battle controls.
  Parent HQ: BossStatus (components/rpg/boss/boss-status.tsx, parent-only).
  Nothing on /player is sticky or pinned any more (see the FUTURE note).
  * Battle feedback redesign (design note; the hit overlay is now BUILT —
    see "Hit overlay" under Stage 2; HP-damaged idles are still future):
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
    - DONE: the sticky boss panel (BossHud), its compact variant and
      Stage 2's temporary pinned strip have all been REMOVED, with their
      pin logic. The scene sits fixed at the top in normal flow and never
      moves; the hit overlay gives Reuben feedback wherever he's scrolled.
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
- Visual overhaul Stage 2 — Battle scene (player dashboard): COMPLETE.
  * components/rpg/battle/: BattleScene replaces the hero box, stat tiles
    and boss panel on /player — one stone-framed arena (CSS night sky,
    pixel hills, ground) with hero + Rogue on the left facing the boss on
    the right, a pulsing aura, event captions as a parchment banner,
    segmented HudBars (damage trail; boss 10/15/20 chunks by tier, party
    10) and the Level/XP/Gold/Streak strip. Sizes come from --arena (container
    units), so 390px keeps both sides facing each other; boss height is
    capped by its own aspect ratio. Level/XP/Streak aren't wired to game
    logic yet — displayed as stored.
  * ONE EVENT SOURCE: lib/rpg/battle-events.ts (typed BattleEvent: damage,
    miss, defeated, escaped, activated + a tiny emitter). useBattle
    translates Realtime rows into events; BattleProvider owns the emitter,
    live boss/party and the stage machine (itself just a subscriber). Add
    listeners (hit overlay, sounds) with useBattleEvents inside the
    provider — /player wraps the whole dashboard in it. Dev-only
    window.__fqBattle { emit, setBoss, setParty } drives it without the DB
    (stripped from production builds).
  * Sprites: every animation carries its own `facing` (right/left/front),
    set per animation in scripts/slice-sprites.mjs FACING — judged by where
    the face/eyes point and which way attacks/projectiles travel; the
    slicer refuses an animation missing from FACING. AnchoredSprite plants
    feet on the ground line with percentage offsets (any CSS height) and
    mirrors side-facing poses: party faces right, bosses face left (a
    fleeing boss faces right, the way it runs); front poses never mirror.
  * Placement: components/rpg/battle/stage-layout.tsx holds the stage —
    ground line, heights, boss width cap, and FEET_X (fixed feet positions:
    hero, Rogue a dog-length behind him, boss). Characters stand there by
    their manifest anchors (FeetSpot + AnchoredSprite), never by image
    widths or gaps. The hit overlay must use the same module.
  * Hit overlay (components/rpg/battle/hit-overlay.tsx): COMPLETE. Fires only for damage events whose childId is the
    signed-in player; a fixed pointer-events:none layer centred in the
    viewport. Hero (attack) + Rogue (pouncing) dash in, boss (hurt), pixel
    ~150ms hit-stop freeze on impact (SpriteAnimator `frozen`), then
    starburst, slash, debris, damage number, layer shake (Web Animations,
    never the page), then fly up and fade (~2.5s). More hits during the hold
    or fly-back extend it (COMBO xN, total adds up). Final blow (a
    "defeated" event for the hit boss): K.O. → victory card + coin shower +
    his share from the "gold" event (boss_log gold_awarded) → next-foe
    silhouette (~5.3s). ALL durations live in OVERLAY_TIMING (hit-overlay.tsx).
    While it plays, BattleProvider.overlayActive mutes the scene's
    screen-reader caption, so each own hit is announced once.
    Emits "moment" events (impact, combo, ko, victory, coin) into the same
    stream for sounds. Reduced motion: fade-only card. Numbers in Nunito
    (Pixelify's 5 reads as S even at 60px). Dev console (next dev only):
    __fqBattle.hit(15) / combo(3, 10) / finalBlow() / otherHit(15) /
    listen(fn).
  * No pinned/sticky strip: removed along with its pin logic; the scene
    stays in normal flow (see the FUTURE note under Phase B2).
- Visual overhaul Stage 3 — Quest board (player): COMPLETE. Presentation only: drag-and-drop, slot rules and the
  damage engine are unchanged.
  * components/kanban/week-board.tsx: wooden frame around a CSS cork board;
    carved "Quest Board" sign + week range, stone week nav, "See whole
    month" → /player/quest-log?month=. Weekly quests are pinned parchment
    notes (±1.5° tilt from the id, pool colour as a corner ribbon, hourglass
    + time left); picked up, a note straightens and lifts.
  * Each day, top to bottom: plaque (weekday + date; today = red wax seal
    — 40px, embossed inner ring, 14px date ≤ ~55% of its width; every
    day's date sits in the same 40px box so plaques stay level — with a
    flickering lantern glow; past days dimmed) → FIXED notices (that
    day's calendar_events, padlock, read-only, only if any) → "+ Quests"
    divider → the drop zone and placed quests (tick box; ink stamps HIT! /
    MISSED; missed cards faded with a torn edge). All drop zones glow while
    dragging. Phone: days stack; a day with nothing on it collapses to one
    line and still takes (press-and-hold) drops.
  * Notices reuse useCalendarEvents (its month grid always covers the week)
    and lib/calendar/by-day.ts occurrencesByDay (recurrence expansion shared
    with MonthCalendar), so repeats and Realtime match the calendar.
  * The month calendar moved off the dashboard to /player/quest-log (player
    theme = an unrolled parchment scroll, .scroll-sheet). Parent calendar
    unchanged.
  * Quest colours (lib/backlog/colors.ts) are stored hex values; nowhere
    puts text on them any more (Parent HQ only uses them for a dot, the
    progress bars and the picker), so the palette itself is unchanged.
  * No automated tests exist in the repo (no recurrence tests, no PGlite);
    Stage 3 was checked in headless Chromium against the live data.
- Visual overhaul Stage 4 — Item shop (player): COMPLETE (coin flight and
  live gold after a real victory confirmed in the browser). Reward rules
  unchanged (same redeem action + DB triggers).
  * Dashboard: components/rewards/shop-banner.tsx — a merchant's stall
    (CSS striped awning, wooden front, carved "Item Shop" sign, gold "Browse
    wares"), live gold, and either "N rewards within reach!" or "X more
    gold to <cheapest reward he can't afford>" with a gold progress bar
    (lib/rewards/progress.ts).
  * /player/store (components/rewards/reward-store.tsx): coin purse with a
    pixel coin stack; rewards as items in inset slots on wooden shelves
    with parchment price tags on strings; affordable → gold Buy,
    otherwise dimmed + padlock + "Need N more" + bar; pending requests as
    wax-sealed parcels; approved/fulfilled/denied history as a ruled
    parchment ledger with ink stamps ("+N gold refunded" on denials). Buy
    confirmation is a parchment dialog; on success coins fly from the purse
    to the item and a "purchase" moment is emitted into the battle event
    stream (the store page is wrapped in BattleProvider for this).
  * Reward icons (lib/rewards/icons.ts): 10 pixel icons stored as "px:<key>"
    (gift, cash, controller, treat, ticket, toy, book, pizza, movie, star),
    offered first in the parent's picker (new rewards default to px:gift);
    legacy emoji still valid. Render any icon with RewardIcon
    (components/rewards/reward-icon.tsx): variant "slot" frames it in an
    inset pixel item slot (player), "plain" for Parent HQ.
  * Live stats: lib/hooks/use-player-stats.ts subscribes the dashboard's
    Level/XP/Gold/Streak strip to player_stats (Realtime), so gold updates
    after a victory without a reload; the shop's gold was already live
    (useRewardStore). WaxSeal is now shared (components/ui/wax-seal.tsx).
- Player polish pass (design review): COMPLETE (reviewed in the browser,
  including a real tick folding its card).
  * No planning on past days. UI: past day columns are disabled drop
    targets (no glow, no placeholder; empty past days collapse to a
    "No quests" line). DB: migration 20260924000010_child_slot_no_past_days
    replaces guard_child_task_slot_writes (same trigger name — ordering
    with task_slots_strike_boss matters) so a CHILD can't INSERT a slot
    before today, or UPDATE its date onto one, in the family's timezone
    (error slot_past_day → friendly text). Ticking past slots and moving
    them forward still work; parents / service role unaffected. Checked in
    PGlite with all migrations loaded (scratch script, not in the repo).
    APPLIED to Supabase (SQL editor).
  * Quest cards: a separate 44×44 pressable tick button (.tick-btn) for
    quests still to do; the card stays the drag handle. Completed+locked or
    missed quests fold into a slim strip (title, minutes, HIT!/MISSED
    stamp, small check/cross) — newly finished ones fold only after the
    hit overlay ends (+0.7s grace; BattleProvider.overlayActive via
    useOptionalBattleContext), grid-rows transition, instant with reduced
    motion.
  * Phone: in the current week the stacked list starts at today; past days
    fold into one "Earlier this week" row (tap to expand). Desktop keeps
    all seven columns.
  * Dashboard order: battle scene → quest board → slimmer shop stall.
    HUD: party and boss halves side by side (name + bar each), stats row
    full width; the Gold stat links to the shop with an "N within reach"
    badge. Sign out lives in a gear menu (components/layout/player-menu.tsx).
  * "See whole month" is a stone button (gold = money/rewards only).
    "+ Quests" divider only under FIXED items; the empty-day placeholder
    sits at the top of the drop zone.
  * Quest Log: today's wax seal (WaxSeal size "sm"; theme todaySeal) and
    Reuben's quests as chips under each day's events (HIT! when counted,
    missed faded) — components/calendar/quest-log.tsx +
    lib/backlog/quest-log.ts (refetched on month change).
  * Shop: price tags tied to the item slot by a string; Buy buttons
    auto-width and centred; parcels no longer repeat "Waiting for a
    grown-up".
  * Battle sky: twinkling stars and two slow parallax layers of stepped
    pixel-cloud silhouettes (inline SVG, crispEdges, 2×/3× scale; each
    strip slides exactly one tile, --tile, for a seamless loop). Static
    under reduced motion. The Gold stat's "N within reach" badge is a tab
    on its top-right corner, with space above the stats row.
- XP, Level & Streak: COMPLETE.
  Migration 20260925000011_xp_level_streak.sql — APPLIED to Supabase (SQL
  editor). The app selects player_stats.best_streak / streak_through, which
  only exist after it.
  * XP: 1 per minute of a completed quest, to the pool's child, in the
    strike trigger (same transaction as the damage); exactly once per slot
    via task_slots.xp_awarded, with or without an active boss. xp_awarded
    locks the slot like applied_to_boss (so a quest ticked while no boss is
    active can no longer be re-ticked later to hit one). Defeat bonus XP
    50 / 100 (mid, interpolated) / 200 split by damage share like gold.
    No backfill (completed slots were marked xp_awarded, nothing awarded).
  * Level curve lives ONLY in public.xp_for_level() (50·L·(L−1)); mirror in
    lib/rpg/levels.ts, checked by the tests. award_xp() recomputes level.
  * Streaks: evaluate_streaks(), run at the end of run_daily_reset — per
    child, day by day from streak_through+1 to yesterday (first run:
    yesterday only): all done +1 (best_streak kept), any missed → 0, rest
    day no change. Idempotent; catches up over missed nights.
  * FIXES A REGRESSION from …10 (which rebuilt the guard from …05 and lost
    …08's slot_locked rule — a child's API could un-tick a locked quest).
    Restored and extended to xp_awarded. No live slots were affected.
  * Lock order stays slot → boss → player_stats (XP after the boss step).
  * UI: XP cell shows total/next-level XP with a 5-segment bar of progress
    through the current level (lib/rpg/levels.ts levelProgress); streak
    cell glows + "Keep your N-day streak: X quests left today" when today
    has quests to do (the quest board reports the count via
    BattleProvider.questsLeftToday). Moments "level_up" (live level rise)
    and "streak_milestone" (3/7/14/30; celebrated once per run, remembered
    in localStorage) → components/rpg/battle/celebrations.tsx shows the
    cards after any hit sequence.
  * TESTS: `npm test` (node:test + PGlite, tests/). tests/helpers/db.mjs
    loads every migration behind a minimal Supabase shim (with Supabase's
    default grants, so asUser()/tryAsUser() run as `authenticated` and
    RLS applies; as()/tryAs() stay superuser and only set auth.uid()).
    Files: xp-level-streak, slot-guard, boss-engine, rewards-store
    (.test.mjs). This is the permanent suite — add new engine rules'
    tests here.

PARKED — future items, NOT to be built until asked:
- FUTURE — Evergreen play:
  * Right now the game ends once every boss is defeated ("All quiet — no
    boss to fight"). The app needs to keep going indefinitely.
  * Options to evaluate later: looping the roster in "Acts" with scaling
    HP/gold and recoloured variants; new bosses from a future art pass.
  * Seasonal events: e.g. seasonal accessories on existing bosses (Magma
    Behemoth in a Santa hat) placed via the manifest anchor points, or
    seasonal bosses tied to calendar dates.
- FUTURE — Test suite: STARTED (npm test; tests/, see "XP, Level &
  Streak"). Covered so far: slot guard, XP, levels, streaks, the boss
  engine + instant damage (roster, activation order, strike, defeat, gold
  split, escape, nightly reset, API access) and the rewards store (ledger
  triggers + RLS). Still to add before production use: pool integrity
  (allocation / week bounds). Not testable in PGlite: true concurrency
  (row-lock serialization of redemptions / strikes).

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
