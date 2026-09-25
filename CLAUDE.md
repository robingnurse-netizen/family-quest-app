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
    public/sprites/<key>/<animation>/frame-NN.png (254 frames, 10
    characters) and writes components/rpg/sprites/manifests/<key>.json.
    Boss keys = bosses.sprite_key; hero = "hero", dog companion = "rogue".
    Background removed by flood fill; crop coordinates, per-animation fps,
    alignment ("feet" default; "mass" was for the old Rogue run, now
    unused) and dropFrames live
    in the script's SHEETS config. Re-run per character after any change:
    node scripts/slice-sprites.mjs <key>
  * Grid sheets (`grid: { cell }` in SHEETS — transparent, one frame per
    cell, no background removal): each animation is a `row` (+ optional
    0-based `frames` columns). The row's feet anchor is MEASURED from its
    first frame (feet x from the main body's bottom, ground = its lowest
    pixel) — cells are padded and feet sit on different lines per row;
    other frames keep their drawn offsets (lunges, hops, falls), except no
    frame may sink below the ground line (lifted onto it; logged). Canvas =
    the frames' union, no padding (so hero idle height = his body height).
    Written as lossless PNGs (palette PNGs would change the colours).
  * GROUNDING (scripts/slice-sprites.mjs, both sheet kinds): every frame's
    lowest opaque pixel is put exactly on its ground line (the anchor y,
    drawn on the top of the grass), frame by frame — dropped if the sheet
    drew it floating, lifted if it sank — except frames an animation lists
    as `airborne` (written into the manifest): hero ko [5] (mid-fall),
    hero victory [3–5] (hop), rogue pounce [3–7], rogue bark_front [1–5],
    alarm_clock_swarm (a hovering ring: idle / attack / hurt / move all,
    death [0–6] — its heap lands; every row shares one `ground` line, the
    idle bob's lowest point), chronosphinx (hovers the same way: idle /
    attack / hurt / move all, death [0–6]; ground = its slash arc's lowest
    point), abyssal_kraken (the same: all but death [7–8]),
    laundry_goblin attack [5–7] / hurt [3–7] (hops), cable_spider
    attack [3–7] (pounce). Biggest fixes: Magma Behemoth's defeat (18–26px) and
    attack (9px) frames, Kraken attack/defeat, the slime's idle; many 1px
    jitters. tests/grounding.test.mjs checks every frame of every
    character. Measured in the browser at 390px / 820px × 1x / 2x: each
    character's lowest pixel lands exactly on the grass top (0.00px).
    ART LIMITS the rule can't fix (only redrawing can): in three-quarter
    view Rogue's far (hind) paws end ~5 art px above his near paw, and the
    lying hero rests on his hand and bat tip with his torso ~3–4 art px
    higher. Re-slicing is deterministic (verified: unchanged config →
    byte-identical frames).
  * SPRITE LOADING (each frame downloaded ONCE; never alt text):
    - Frame URLs in the manifests carry a content hash:
      /sprites/<key>/<anim>/frame-NN.png?v=<10 hex of SHA-256>, written by
      scripts/sprite-manifests.mjs (was sprite-shadows.mjs; the slicer runs
      it). next.config.ts serves /sprites/:path* with
      "public, max-age=31536000, immutable" (Next's public/ default is
      max-age=0 — frames were re-downloaded whenever the browser dropped
      them: 150 requests for 104 frames in a minute, frames 2–3×).
      tests/sprite-urls.test.mjs checks every hash is current: after ANY
      frame edit, run node scripts/sprite-manifests.mjs.
    - components/rpg/sprites/frame-cache.ts: one Image per URL for the
      page's life (loaded + decoded, kept referenced); a failed frame is
      retried with backoff (1s, 2s … 30s) on its next request.
    - SpriteAnimator only swaps to frames the cache has ready; a frame that
      isn't (slow/failed) is skipped and the last good frame stays up. The
      <img> falls back to its last loaded frame on error, or hides until
      one loads; img.sprite-pixelated has transparent, zero-size alt text
      (covers a server-rendered first frame failing before hydration).
      Checked with forced connection resets on hero idle frames 01/06:
      no alt text or broken image in 0 of ~450 samples, frames recovered.
    - bossAnimations() is memoized per sprite key (a new object per render
      restarted SpriteAnimator on every overlay re-render).
    - proxy.ts already skips sprites/ (and .png etc.), so no auth round
      trip on frames.
    - The Linux dev container (ChromeOS) can run low on memory (seen:
      ~300MB available of 6.4GB, no swap — the host reclaims RAM), which
      is when the dev server dropped frame requests (ERR_CONNECTION_RESET).
      /tmp is RAM (tmpfs): keep scratch files there small.
  * NO GROUND SHADOWS (removed 2026-09-25): characters stand on the ground
    line with no drawn shadow. There used to be a per-frame soft ellipse
    under every character (AnchoredSprite's .sprite-shadow, sized from a
    `shadow` map scripts/sprite-manifests.mjs wrote into every manifest)
    and one under the hit overlay's group (.overlay-ground). With the
    PixelLab sprites grounded frame by frame they looked worse than none,
    so all of it is gone: no `shadow` in the manifests (sprite-manifests.mjs
    now only versions URLs and deletes any stale `shadow` key), no shadow
    props on AnchoredSprite, no shadow keyframes in strikeMotion(), no
    SpriteAnimator onFrame. Don't add them back without asking.
  * Sprites are fully decoupled behind the manifests: art can be swapped
    later (new sheets → re-slice, or hand-made frames + a manifest) without
    touching game logic. Components only know manifest keys + animation
    names (idle/move/attack/hurt/death/defeated, etc.).
  * SpriteAnimator.tsx plays a manifest animation (rAF, preloads frames,
    reduced-motion safe). One-shot animations play once and hold the last
    frame; replayDelayMs replays them (previews only).
  * ROGUE ART = assets/rogue-pixellab.png (PixelLab, 864×768, 96px cells,
    9×8; keep it as the source; the old Gemini Rogue sheet and frames are
    deleted). Row 0 rotations (unused); 1 bark (South-East, his victory
    cheer); 2 bark_front (South, 6 frames, NOT USED YET — kept); 3 hurt
    (peak 5, 6–8 recover); 4 idle_front (South, NOT USED YET — kept);
    5 idle (South-East, 9-frame loop: breathing + a slow tail wag, the
    tail up in frames 4–5; replaced the old squashed 8-frame idle);
    6 pounce (contact 6, paws furthest forward; frames 3–6 airborne);
    7 ko (ends flat on his belly; frames 6–8 lifted 1px onto the ground).
    In-game rows face right (3/4 view).
    fps: idle 6 (= the hero's idle), bark 10, hurt 12, pounce 12, ko 10
    (= the hero's K.O., so they fall together; bark = the victory pose's
    length).
    * Size: ROGUE_BODY (0.2822 × arena = the old placeholder's body height,
      76px at a 270px arena) is his STANDING BODY: the manifest's
      bodyHeight (52 art px — the slicer records each grid row's first-frame
      height, because the tail wag makes the idle canvas taller than him).
      rogueHeight(anim), one scale for every pose (~1.47 CSS px per art px
      at 270px), NOT snapped to device pixels (snapping would change his
      size up to ~15% on a phone). No height jump between idle and actions:
      the idle's frame 0 is pixel for pixel every action row's frame 0 on
      the same feet (tested).
    * Polish later: his bark's teeth could use a pixel touch-up.
    * He follows the hero's pose machine (roguePoseFor in
      lib/rpg/hero-stage.ts: attack → idle, victory → bark, the rest the
      same) via RogueSprite (components/rpg/battle/arena-parts.tsx), in the
      scene and the recap: hurt peaks (ROGUE_HURT_PEAK_FRAME 5) on the same
      blow (contactAnimation, BOSS_ATTACK_IMPACT_MS), falls / lies / gets
      up (K.O. reversed) with the hero, barks once then breathes. The red
      flash + shove already covered the whole party.
    * Knocked out, he lies on the SAME ground line as the hero (no offset;
      the old lowered "in front" spot is gone), drawn over the hero (z) so
      his paws stay visible. Proper front/back depth waits for a ground
      with depth (the day/night background note).
    * Hit overlay: his pounce is timed like the hero's swing
      (contactAnimation(pounce, ROGUE_POUNCE_CONTACT 6, lead) — the 280ms
      dash, or 0 for combo hits); after a final blow he barks (then
      breathes) beside the hero's victory pose, from the same start.
    * Dev hooks show him too: hit / combo / finalBlow (pounce, bark), hurt,
      knockOut, standUp, victory, recap. No bark sound (none exists yet).
  * HERO ART = assets/hero-pixellab.png (PixelLab, 1008×896, 112px cells,
    9×8; keep it as the source). Row 0 static rotations (unused); 1 chop
    (contact 6); 2 thrust (contact 6; columns 1–2 dropped); 3 K.O. (falls
    on his face; frames 6–8 lifted 2–3px onto the ground); 4 slash
    (contact 7; columns 1–2 dropped); 5 hurt (peak 5, 6–8 recover);
    6 victory (hold last frame; columns 6–7 lifted 1px); 7 idle (8-frame
    loop with a blink). Column 0 of every action row is his idle pose.
    Faces right (3/4 view) throughout. Manifest animations: idle, chop,
    thrust, slash, hurt, ko, victory (fps 6 / 16 / 16 / 16 / 12 / 10 / 10).
    The old Gemini hero sheet (Gemini_Generated_Image_4emgkn…png) and its
    frames are deleted (git history keeps them).
  * Known art limits: Lying down,
    the hero's legs overlap Rogue on the same ground line; Rogue is drawn
    in front so his paws show (see ROGUE ART) — real depth needs a ground
    with depth.
  * Future art requirement (not built): when the sprite art is redone,
    boss idle should reflect current_hp — pristine above ~66%, worn at
    ~33–66%, heavily damaged below ~33% — instead of one idle loop at
    every HP. Hero and Rogue get the same treatment from party HP (see
    "FUTURE — Battle feedback redesign" under Phase B2).
- RPG Phase B2 — Boss Battle Rendering: COMPLETE (restyled for the player
  in visual overhaul Stage 2, below). Boss sprites react to battle events:
  damage → hurt once;
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
    and boss panel on /player — one stone-framed arena (now the day/night
    meadow backdrop — see "Day/night cycle") with hero + Rogue on the left facing the boss on
    the right, a pulsing aura, event captions as a parchment banner,
    segmented HudBars (damage trail; boss 10/15/20 chunks by tier, party
    10) and the Level/XP/Gold/Streak strip. Sizes come from --arena (container
    units), so 390px keeps both sides facing each other; boss height is
    capped by its own aspect ratio. Level/XP/Streak aren't wired to game
    logic yet — displayed as stored.
  * ONE EVENT SOURCE: lib/rpg/battle-events.ts (typed BattleEvent: damage,
    miss, defeated, escaped, activated, party + a tiny emitter). "party"
    (hp, max) comes from party_health Realtime rows (and dev setParty) —
    an event, because the nightly reset's 0 and refill arrive back to back
    and React would batch the state away. useBattle
    translates Realtime rows into events; BattleProvider owns the emitter,
    live boss/party and the stage machine (itself just a subscriber). Add
    listeners (hit overlay, sounds) with useBattleEvents inside the
    provider — /player wraps the whole dashboard in it. Dev-only
    window.__fqBattle { emit, setBoss, setParty, jumpToBoss, bosses } drives it without the DB
    (jumpToBoss("cable_spider" | 4 | null): a roster boss by sprite_key or
    1-based activation position, full HP, this tab only — no writes;
    bosses() prints the roster with positions)
    (stripped from production builds). Previewing each boss animation,
    including the escape (emit "escaped" with the row jumpToBoss put on
    stage): docs/pixellab-style.md, "Checking a boss in the browser".
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
  * Hero size: HERO_BODY (0.5485 × arena = the old art's body height) is
    his standing BODY, not a frame; heroHeight(anim) = --hero-px × canvas
    px, one scale for every pose. Any box drawing him needs ARENA_VARS (or
    ARENA_STYLE) + ARENA_CLASS ("battle-arena", app/globals.css), which
    derives --hero-px. Integer scaling: useDevicePixelStep() sets
    --device-px on :root on 2×+ screens and CSS round() snaps --hero-px to
    whole device pixels (e.g. 2.5 CSS px = 5 device px at a 270px arena:
    155px body vs the old 148). 1× screens keep the exact height (nearest
    whole pixel could be ~20% off). Checked in headless Chromium.
  * Hit overlay (components/rpg/battle/hit-overlay.tsx): COMPLETE. Fires only for damage events whose childId is the
    signed-in player; a fixed pointer-events:none layer centred in the
    viewport. Hero (attack) + Rogue (pounce) dash in, boss (hurt), pixel
    ~150ms hit-stop freeze on impact (SpriteAnimator `frozen`), then
    starburst, slash, debris, damage number, layer shake (Web Animations,
    never the page), then fly up and fade (~2.5s). More hits during the hold
    or fly-back extend it (COMBO xN, total adds up). Final blow (a
    "defeated" event for the hit boss): K.O. → victory card + coin shower +
    his share from the "gold" event (boss_log gold_awarded) → next-foe
    silhouette (~5.3s). ALL durations live in OVERLAY_TIMING (hit-overlay.tsx).
    While it plays, BattleProvider.overlayActive mutes the scene's
    screen-reader caption, so each own hit is announced once.
    After the K.O. slam (OVERLAY_TIMING.heroVictory, 380ms) the hero plays
    his victory pose under the K.O. text and holds its last frame through
    the victory card (fanfare + gold) — one keyed tree across both phases.
    Emits "moment" events (impact, combo, ko, victory, coin) into the same
    stream for sounds. Reduced motion: fade-only card. Numbers in Nunito
    (Pixelify's 5 reads as S even at 60px). Dev console (next dev only):
    __fqBattle.hit(15) / combo(3, 10) / finalBlow() / otherHit(15) /
    listen(fn). (hit(10) / hit(30) / hit(60) show the three hit tiers.)
  * Fight choreography: COMPLETE. lib/rpg/strike.ts (pure; tested in
    tests/strike.test.mjs):
    - Hit tiers by the hit's minutes (= damage amount, 1 min = 1 dmg, the
      same duration_minutes as damage/XP): light ≤15, medium 16–44, heavy
      45+ (his real quests are mostly 15 / 30 / 60 min — one per tier).
      HIT_TIERS sets hit-stop (100/150/200ms), shake, burst scale, debris
      count/spread and a faint white flash (none / 0.12 / 0.28). Only the
      freeze varies: every later beat (K.O., hold, fly) and so every sound
      is still timed from OVERLAY_TIMING.hitStop — tiers never slow the
      show or shift sounds.
    - Attack variants: STRIKE_VARIANTS are the hero's three real attacks,
      each its own manifest animation with a `contact` frame index: chop
      (6, a hop = "leap"), thrust (4 = sheet 6, "lunge"), slash (5 = sheet
      7, no motion). contactAnimation() lines the contact frame up with the
      impact (after the 280ms dash: 4 wind-up frames at 16fps; at once for
      combo hits), dropping wind-up frames that don't fit. Body motion
      (Web Animations on `translate`) only on a first hit. Picked with
      createNoRepeatPicker (lib/random.ts, shared with the attack sound
      pool) — never the same attack twice running (overlay and scene each
      keep their own picker).
  * Hero poses in the scene: lib/rpg/hero-stage.ts (pure reducer; tested in
    tests/hero-stage.test.mjs) — idle / attack / hurt / ko / down / rise /
    victory, fed by battle events; reactions queue behind the one playing.
    - Hurt (miss): contactAnimation(hurt, HURT_PEAK_FRAME 5,
      BOSS_ATTACK_IMPACT_MS 210) — the flinch peaks at the boss's blow (the
      peak of .boss-fx-attack's lunge: 600ms, 35%). The party's red flash
      (.hero-hit) now also shoves them back (left, 3.5% of the arena), its
      peak delayed to --impact. Restarted by re-adding the class, NOT by
      re-keying the party (that would restart a K.O. mid-fall).
    - K.O.: party hp → 0 (a "party" event) plays ko (queued after a flinch
      that's still playing), then "down" holds the last frame. When the
      party refills he stays down DOWN_HOLD_MS (1.5s), then "rise" plays
      ko in reverse. Nothing else moves him while down. Loading at hp 0
      starts him down.
    - Victory: a "defeated" event plays victory (after his attack if one
      is playing) and holds the last frame until the next boss takes the
      stage (stage.shown changes → "swap").
    - Dev console (next dev only): __fqBattle.hurt(10) (a real miss: boss
      lunge, sound, flash, flinch, party −10; 0 knocks him out) /
      knockOut() / standUp() (party to 0 / full, as the nightly reset
      sends them; he rises after the 1.5s hold) / victory(holdMs = 3000)
      (the scene pose alone; finalBlow() plays the overlay's).
    - The party-damage sound plays on the blow too (BOSS_ATTACK_IMPACT_MS
      after the miss; BattleSounds delays it, minGapMs checked at play).
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
    Files: xp-level-streak, slot-guard, boss-engine, rewards-store,
    sound, random, strike, hero-stage, rogue, grounding, sprite-urls, frame-cache, recap-healing, recap, evening, sun-times, meadow-key (.test.mjs). tests/helpers/load-ts.mjs imports
    app TypeScript and follows its "./" and "@/" imports (keep tested
    modules free of React / browser imports). This is the permanent suite — add new engine rules'
    tests here.
- Sound effects (Howler): COMPLETE.
  * Files in public/sounds/ (attack/ is a pool of 8, mixed wav/mp3).
    lib/sound/sound-rules.ts (no imports; tested): SOUNDS — name → files,
    volume (tune by ear there; files aren't loudness-matched), minGapMs
    (the same sound again within it is dropped: 90–120ms for ticks/hits,
    1.5s party damage, 4s boss defeated) — plus the mute store
    (localStorage "fq:sound-muted"). The attack pool's no-repeat pick is
    createNoRepeatPicker in lib/random.ts.
  * lib/sound/sound-manager.ts is the ONLY Howler user: playSound(name),
    setSoundMuted / useSoundMuted, armSounds(). Howler + files load on the
    first pointer/key press (also the autoplay unlock), not while muted; a
    sound whose file isn't ready within 800ms is dropped, not played late.
  * components/rpg/battle/battle-sounds.tsx (BattleSounds, mounted inside
    BattleProvider on /player and /player/store) is the one event → sound
    map. Own hits sound on the overlay's beats: attack on "impact" (every
    combo hit), fanfare on "ko"; others' damage and defeats the overlay
    doesn't show sound on the event. miss → party damage, delayed
    BOSS_ATTACK_IMPACT_MS (210ms) to land on the boss's blow; "purchase" →
    item bought; "celebration" (emitted by Celebrations when a level-up /
    streak card appears, so the sound matches the card, not the XP row) →
    level-up / streak; quest board "quest_complete" (tick) and
    "quest_dropped" (pool → day, slot → other day or tray) moments.
  * Mute: SoundToggle (components/ui/sound-toggle.tsx) in the battle
    arena's top-left corner; the event banner is narrowed to clear it.
    No toggle on /player/store (the setting carries over).
  * proxy.ts matcher skips sounds/ and .wav/.mp3 (as for sprites).
- Recap, evening warning & healing: COMPLETE. Migration
  20260926000012_recap_evening_healing.sql APPLIED to Supabase (SQL
  editor). Verified in the browser: recap previews (including the
  Continue card), evening mode, the heal effect, a real Small Potion
  purchase (gold −30, party +20 HP) and Parent HQ's "Party healing" log.
  * Tunables, one place each: miss_penalty_per_minute() (1) and
    perfect_day_heal_hp() (10) SQL functions; the potions table (small:
    20 HP / 30 gold, large: 50 HP / 70 gold — edit the rows);
    EVENING_WARNING_FROM ("18:00") in lib/rpg/evening.ts; RECAP_TIMING in
    lib/rpg/recap.ts.
  * "While you were away" recap: run_daily_reset writes a reset_recaps row
    per child per run that affected him (his misses / perfect days, or any
    party damage / knock-out): missed quests + minutes, party damage, the
    boss, perfect days + HP healed, streak before/after, knocked_out,
    escaped + next boss, HP before/after. Snapshot, because streak changes,
    HP before and who came next aren't recorded elsewhere. Rest days and
    re-runs write nothing. /player loads his unseen rows (lib/rpg/queries
    loadRecap) and summarizeRecaps() combines every night since he last
    acknowledged into ONE story ("Yesterday" for one night that's exactly
    yesterday, else "Since you were last here"), with lines cued to beats.
    components/rpg/battle/recap.tsx (RecapHost) stages it before anything:
    BattleProvider recapPending → recapActive holds Celebrations back.
    Blow: boss attack + lunge, hero hurt (frame 5 on the blow), party
    flash, "party_hit" moment → party-damage sound, ONE damage number, HP
    bar; knock-out: fall, boss slides off, next boss enters, refill + he
    gets up; perfect-day heal: green +N. No boss: text only. Perfect day
    only: brief. The animated part plays by itself (≤ ~7s) and always ends
    on the SUMMARY CARD (every line + the closing line), which stays up
    until he taps Continue — no auto-close, so the explanation can't be
    missed. A tap (anywhere) / Escape / the Skip button during the
    animation jumps to the summary card (recapFinalState: final HP, every
    line, the next boss after a knock-out, else the striking boss); on the
    summary only Continue closes it. Reduced motion: the summary card at
    once. (Level-up / streak cards keep their auto-close.)
    SEEN is in the database: acknowledge_recaps(p_through) (server action
    acknowledgeRecaps) runs as soon as it starts (skip counts; other
    devices won't replay) and marks only auth.uid()'s unseen rows up to
    the newest shown (a reset landing meanwhile isn't swallowed). No write
    policies on reset_recaps; the child reads his own, parents the family.
  * Evening warning: from 18:00 family time (isEvening, re-checked every
    minute), while HE has open quests today and a boss is active, the boss
    charges up (.boss-charging glow + .boss-aura-charging, gentle; static
    under reduced motion) and the stats row's nudge becomes "<Boss> is
    powering up! N quests left before midnight, or the party takes D
    damage[ and gets knocked out][ — and your N-day streak ends]." — it
    replaces the streak nudge (never both). D comes from tonight_stakes()
    (lib/hooks/use-evening-warning.ts): every open quest up to today in
    family time × miss_penalty_per_minute(), 0 with no boss — the reset's
    own rule and constant, so it's what the reset would deal.
  * Potions (/player/store, PotionShelf above the real-life rewards, which
    are now headed "Real-life rewards"): buy_potion(p_potion_id) — child
    only, auth.uid()'s gold, priced from the table, heal capped at max,
    refused at full HP (potion_party_full) or short (potion_insufficient_
    gold); locks party_health → player_stats; logged in party_log (gold
    spent, potion). Bought and drunk in one tap, no inventory, no parent.
    Server action buyPotion checks the price he saw first (like rewards).
    Feedback: the shelf's party HP bar + green +N, "potion" moment →
    item-purchased sound; the battle scene shows a green +N for every
    party_log heal over Realtime ("heal" events). Parent HQ /parent/rewards:
    "Party healing" log (potions: who, which, gold; perfect-day heals).
    Potion icons are PLACEHOLDER pixel art (PotionIcon in
    components/ui/icons.tsx) — replace in the PixelLab art pass.
  * Perfect-day heal: evaluate_streaks() also returns each perfect day
    (every scheduled quest done — the streak's +1 condition) plus the
    streak before; run_daily_reset heals perfect_day_heal_hp() per day, in
    order, after penalties and the knock-out refill, capped at max (party
    row already locked; lock order unchanged). Idempotent and catches up
    over missed nights via streak_through, like streaks. Logged per day in
    party_log (only when it healed something).
  * Dev console (next dev only): __fqBattle.recap("blow" | "ko" | "nights"
    | "text" | "perfect") — the same RecapHost → Recap component and
    RECAP_TIMING as the real recap, fed fake rows through the same
    summarizeRecaps(); differences: never acknowledged (no database
    writes), fixed Slime → Alarm Clock Swarm bosses, it holds celebration
    cards back only once it starts (the real one from the first render,
    via recapPending), and a new call replaces one already playing / evening(true | false | null, stakes?) (force evening;
    pass `stakes` — e.g. {} or { damage: 60, party_hp: 30 } — to preview
    without the database) / heal(20) (heal event + party HP, no gold).

TOOLING — PixelLab MCP (pixel-art generation, for the future sprite redo):
- Connected as the `pixellab` MCP server (~94 tools: characters, objects,
  image create/edit/inpaint, animate_image / animate_character, tilesets,
  maps, UI panels, fonts, cleanup like reduce_colors / correct_pixelart,
  jobs, get_balance). Generation is async: create → wait_for_jobs → get_*.
- Balance: NEVER record it here — always check it live with get_balance.
  Many tools cost 20–40 generations per call (create_image_pro,
  edit_image, inpaint_image, create_character_state, pro modes), so a
  single call can use up a small balance. Cheap options:
  create_image_pixflux / pixen, edit_image_pixen, image_to_pixelart
  (1 each); v3 animations ~1–4 per direction; unzoom / correct_pixelart /
  reduce_colors 0.1; pixelart_workbench, create_talking_gif, get_lip_sync
  free. Check get_balance and confirm cost with the user before any paid
  generation.
- Boss art redo: docs/pixellab-style.md is the style reference — exact
  settings, sizes per tier (canvas 64 / 76 / 88 for ~59 / 72 / 84 px tall
  low / mid / epic, pixel parity with the hero), south-west = facing left,
  description and animation wording. Pilot: Trash-Bag Slime — DONE:
  assets/trash-bag-slime-pixellab.png (84px grid, rows idle / attack /
  hurt / death / move, all facing left; 9 frames each), sliced by the
  grid entry in scripts/slice-sprites.mjs; idle 51×59 = pixel parity.
  PixelLab character a380da4d-4c2a-402f-bf6b-f1063c735e15.
  Alarm Clock Swarm — DONE: assets/alarm-clock-swarm-pixellab.png (96px
  grid, same rows; assembled + speck-cleaned from the PixelLab frames),
  attack contact 4, death guided by a hand-drawn end frame; grid entries
  take an optional `ground` (cell row) for hovering bosses. Details in the
  style guide's swarm record.
  Roster pass (six bosses, style guide "Remaining-roster pass"): sheets
  built by scripts/pixellab-helpers/build-boss-sheet.cjs <key> (config
  per boss, speck cleanup), previews by preview-gif.cjs <key> →
  scripts/pixellab-helpers/previews/ (git-ignored).
  Laundry Goblin — DONE: assets/laundry-goblin-pixellab.png (88px grid),
  attack contact 5 (16 fps), 5 generations, no re-rolls.
  Cable Spider — DONE: assets/cable-spider-pixellab.png (88px grid),
  attack-v2 (pounce) contact 4; death-v3 animates into a hand-drawn end
  frame (spider-heap.cjs) so it collapses onto the floor; 8 generations.
  Magma Behemoth — DONE: assets/magma-behemoth-pixellab.png (116px
  grid), contact 4, death-v2, 12 generations (1 death re-roll). Epic
  bosses now have their own hurt / death rows (no `defeated` strip).
  Chronosphinx — DONE: assets/chronosphinx-pixellab.png (124px grid),
  hovers (ground 106: frame 0 8px up, only the death lands), contact 5,
  10 generations, no re-rolls.
  Abyssal Kraken — DONE: assets/abyssal-kraken-pixellab.png (112px
  grid), hovers (ground 100, only the death lands), contact 6,
  10 generations, no re-rolls; its loose floating tentacle piece is
  removed by kraken-fixes.cjs.
  Shogun-Bot — DONE: assets/shogun-bot-pixellab.png (124px grid),
  contact 5, hurt-v2, 12 generations (1 hurt re-roll). All ten roster
  bosses in the database are now PixelLab art; the Gemini boss sheets in
  assets/ are no longer sliced (kept as source history).
  Mid-tier pass (style guide "Mid-tier pass", 52 generations): Swamp-Bag
  Ooze (104px cells; attack contact 8 at 16 fps; death holds frame 7),
  Tupperware Troll (104px; contact 5), Mud-Track Minotaur (96px; contact
  5; animated from a PUDDLE-FREE start frame, minotaur-start.cjs — the
  rotation's mud puddle read as a ground shadow; death animates into a
  hand-drawn heap, minotaur-heap.cjs) — DONE, all grounded, no airborne
  frames. build-boss-sheet.cjs gained `work`, a row's `frames` and
  `align`. Scatter-Brick Serpent: still unanimated (its death needs the
  hand-guided end-frame treatment). Mid bosses are seeded for new
  families only (migration …13).
- Boss attack timing: a boss's attack with a `contact` frame (manifest
  field, set in the slicer config, e.g. attack: { contact: 5 }) is
  trimmed by bossAttackAnimation() (lib/rpg/strike.ts, via
  bossAnimations) so that frame is on screen at BOSS_ATTACK_IMPACT_MS
  (210ms: the CSS lunge's peak, the party's flinch and damage sound).
  Bosses without one play their attack as drawn. The slime's attack
  runs at 16 fps so frames 2–8 play (contact 5 at 187–250ms).
- New art must still go through the manifest pipeline (see Phase B1):
  frames under public/sprites/<key>/<animation>/ + a manifest, FACING set
  per animation — game code never changes for an art swap.

PARKED — future items, NOT to be built until asked:
- FUTURE — Evergreen play:
  * Right now the game ends once every boss is defeated ("All quiet — no
    boss to fight"). The app needs to keep going indefinitely.
  * Options to evaluate later: looping the roster in "Acts" with scaling
    HP/gold and recoloured variants; new bosses from a future art pass.
  * Seasonal events: e.g. seasonal accessories on existing bosses (Magma
    Behemoth in a Santa hat) placed via the manifest anchor points, or
    seasonal bosses tied to calendar dates.
- FUTURE — Day/night cycle for the battle background: dawn / day / dusk /
  night variants crossfading, generated with PixelLab environment
  generation. Undecided: follow the family's timezone (families.timezone)
  or the device's clock. REQUIREMENT: the new backgrounds need a ground
  with depth — a floor band seen slightly from above, matching the
  characters' three-quarter view — not today's thin side-on ground line
  (drawn ground shadows were tried as a stopgap and removed).
  * BUILT: the arena backdrop (components/rpg/battle/arena-backdrop.tsx,
    re-exported as ArenaBackdrop from arena-parts — battle scene + recap).
    Layers: four skies stacked (night = .arena-sky, .sky-dawn / -day /
    -dusk in globals.css; stackedOpacities() makes each show by its
    weight), stars (faded), the two cloud layers (their art's three tones
    are CSS masks coloured by --cloud-<layer>-<tone>), the meadow
    (public/backgrounds/meadow-day.png: its #a3cddb sky already
    transparent in the file — scripts/key-meadow-sky.mjs cuts it out of
    assets/bg-meadow-day-final.png once; it used to be a canvas pass in the
    browser on every load, which left sky-only arenas until it finished;
    preloaded from the page head),
    tinted by a brightness/saturate filter, and the lit windows
    (meadow-night-windows.png). Art covers the arena anchored bottom-centre
    (phone arenas lose the sides, wide ones ~10 art rows of sky); its feet
    line (14px up) lands within ~3px of --ground. lib/rpg/sky.ts (pure,
    tests/sky.test.mjs): skyWeights() crossfades night→dawn (dawn window
    start → sunrise), dawn→day (→ window end), day→dusk, dusk→night the
    same way; SKY_LOOKS holds every period's colours / filter / stars /
    windows (tune there). Time-based values are CSS variables from
    useArenaSky(timeZone), spread onto the arena box
    (suppressHydrationWarning), re-checked every minute; 2s CSS
    transitions. Both the scene and the recap get families.timezone
    (RecapHost's timeZone prop). The hero and Rogue are dimmed too, less
    than the background (SKY_LOOKS.characters: night 0.75 / 0.8), via
    .arena-party img.sprite-pixelated — the hit overlay and the boss aren't. Dev console: __fqBattle.sky("night" | "dawn" | "day" |
    "dusk" | ISO time | null) and __fqBattle.skyCycle(seconds = 60) (a
    whole day, then back to the clock). public/backgrounds/: meadow-day.png
    is made by node scripts/key-meadow-sky.mjs (re-run after editing
    assets/bg-meadow-day-final.png; tests/meadow-key.test.mjs checks it),
    meadow-night-windows.png is a copy of
    assets/bg-meadow-night-windows.png (made by
    scripts/make-night-windows.py) — re-copy after editing the art.
  * lib/sun-times.ts (NOAA equations, no dependency):
    sunTimes(date, timeZone) → that family day's sunrise / sunset for
    SUN_LOCATION (hardcoded Aberdeen 57.15, -2.09; a family setting later);
    skyPeriod(now, timeZone) → "dawn" | "day" | "dusk" | "night" with
    DAWN_WINDOW / DUSK_WINDOW (45 min either side; tune there). Check:
    node scripts/sun-times-check.mjs [ISO time] [timezone]. Background art
    so far: assets/bg-meadow-day.png (344×192 source) and
    assets/bg-meadow-day-final.png (320×128 battle crop; sky is exactly
    #a3cddb, safe to colour-key).
- FUTURE — Test suite: STARTED (npm test; tests/, see "XP, Level &
  Streak"). Covered so far: slot guard, XP, levels, streaks, the boss
  engine + instant damage (roster, activation order, strike, defeat, gold
  split, escape, nightly reset, API access) and the rewards store (ledger
  triggers + RLS), recaps (scope, show-once, acknowledgement security),
  evening stakes, potions and perfect-day heals. Still to add before
  production use: pool integrity
  (allocation / week bounds). Not testable in PGlite: true concurrency
  (row-lock serialization of redemptions / strikes / potion buys).

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

- potions: id (text: small/large), name, heal_hp, gold_cost, sort_order,
  active (global catalogue; read-only via the API)
- party_log: id, family_id, child_id, event_type ('potion'|'perfect_day'),
  amount (HP healed), hp_after, potion_id, gold_spent, day, created_at
- reset_recaps: id, family_id, child_id, created_at, day_from, day_to,
  missed_quests, missed_minutes, party_damage, boss_id, perfect_days,
  healed, streak_before, streak_after, knocked_out, escaped_boss_id,
  next_boss_id, hp_before, hp_after, max_hp, seen_at

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
