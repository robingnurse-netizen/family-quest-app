"use client";

import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import Link from "next/link";
import type { Boss } from "@/lib/supabase/types";
import { SPRITES } from "@/components/rpg/sprites/manifests";
import { AnchoredSprite, needsMirror } from "@/components/rpg/sprites/anchored-sprite";
import { BossSprite } from "@/components/rpg/boss/boss-sprite";
import { CoinIcon, FlameIcon, ShieldIcon, SkullIcon, StarIcon } from "@/components/ui/icons";
import { registerDevTools, useBattleContext, useBattleEvents } from "./battle-provider";
import { SoundToggle } from "@/components/ui/sound-toggle";
import { HudBar } from "./hud-bar";
import { RaidBanner } from "./raid-banner";
import { usePlayerStats, type LiveStats } from "@/lib/hooks/use-player-stats";
import { levelProgress } from "@/lib/rpg/levels";
import { useEveningWarning } from "@/lib/hooks/use-evening-warning";
import { useQuestsLeftToday } from "@/lib/hooks/use-quests-left-today";
import type { TonightStakes } from "@/lib/supabase/types";
import { shopProgress } from "@/lib/rewards/progress";
import type { Reward } from "@/lib/supabase/types";
import { createNoRepeatPicker } from "@/lib/random";
import { HIT_TIERS, STRIKE_VARIANTS, hitTier } from "@/lib/rpg/strike";
import { BOSS_ATTACK_IMPACT_MS, DOWN_HOLD_MS, heroReducer, initialHero, roguePoseFor } from "@/lib/rpg/hero-stage";
import { ArenaBackdrop, HERO_POSES, RogueSprite } from "./arena-parts";
import { previewSky, previewSkyCycle, useArenaSky } from "./arena-backdrop";
import {
  ARENA_CLASS,
  ARENA_STYLE,
  FEET_X,
  FeetSpot,
  bossHeight,
  heroHeight,
  useDevicePixelStep,
} from "./stage-layout";

// Reuben's battle scene: one framed arena with his hero and Rogue on the left
// facing the active boss on the right, the HUD bars under each side and his
// stats along the bottom. It sits in normal page flow and never moves.
// Characters stand by their feet anchors at fixed stage positions
// (./stage-layout — shared with the hit overlay); everything is sized from
// the arena height (--arena, in container units), so the same layout scales
// down to a phone with the two sides still facing each other.

/** HP bar chunks: more for tougher bosses. */
const BOSS_SEGMENTS: Record<Boss["tier"], number> = { low: 10, mid: 15, epic: 20 };

export type PlayerStats = LiveStats;

/**
 * Arena screen shake (the framed arena only — never the page or the HUD):
 * every hit shakes it by its tier's distance (HIT_TIERS[tier].shake: the
 * same light / medium / heavy scale as the hit overlay's shake, from the
 * hit's minutes), briefly; the final blow rumbles longer than any hit.
 */
const ARENA_SHAKE = {
  /** A hit's shake (ms): the hit overlay's own layer shake. */
  hitMs: 320,
  /** The final blow's rumble (ms), at the heavy tier's distance, decaying. */
  rumbleMs: 1400,
} as const;

/** Streak lengths worth a celebration. */
const STREAK_MILESTONES = [3, 7, 14, 30];

const tierLabel = (tier: Boss["tier"]) => (tier === "epic" ? "Epic boss" : tier === "mid" ? "Boss" : "Minion");

export function BattleScene({
  heroName,
  familyId,
  childId,
  today,
  questsLeftToday: initialQuestsLeftToday,
  stats: initialStats,
  rewards,
  timeZone,
  rescueOpen = false,
}: {
  heroName: string;
  familyId: string;
  childId: string;
  /** Today in the family's timezone (server-rendered; the hook follows the clock). */
  today: string;
  /** Server-rendered count of his quests left today (null: unknown); kept live. */
  questsLeftToday: number | null;
  /** Server-rendered stats; kept live from player_stats (Realtime). */
  stats: PlayerStats;
  /** The shop's rewards, for the Gold stat's "N within reach" badge. */
  rewards: Reward[];
  /** The family's timezone: the evening warning starts at 18:00 there. */
  timeZone: string;
  /**
   * His streak is cracked with a rescue open (streak recovery): it's frozen,
   * so today's quests can't keep or lose it — the streak nudge steps aside
   * (the rescue card under the scene is the thing to do).
   */
  rescueOpen?: boolean;
}) {
  const { boss, stage, onBossAnimationEnd, onBossFinished, emit } = useBattleContext();
  const stats = usePlayerStats(childId, initialStats);
  // His quests left today: the one count behind both nudges (the streak
  // nudge and the evening Night Raid banner), whatever week the board shows.
  const liveQuestsLeft = useQuestsLeftToday({
    familyId,
    childId,
    timeZone,
    initialToday: today,
    initial: initialQuestsLeftToday,
  });

  // Evening nudge (lib/rpg/evening.ts): from 18:00 family time, while he
  // still has quests today and a boss can be raided, the boss charges up and
  // a line offers tonight's Night Raid.
  const [eveningDev, setEveningDev] = useState<{
    force: boolean | null;
    stakes: TonightStakes | null;
    quests: number | null;
  }>({
    force: null,
    stakes: null,
    quests: null,
  });
  const questsLeftToday = eveningDev.quests ?? liveQuestsLeft;
  const evening = useEveningWarning({
    timeZone,
    bossId: boss?.id ?? null,
    questsLeftToday,
    streak: stats.streak,
    force: eveningDev.force,
    devStakes: eveningDev.stakes,
  });
  const charging = evening.line !== null;

  // Development only: evening mode on demand (see CLAUDE.md).
  useEffect(() => {
    if (process.env.NODE_ENV !== "development") return;
    return registerDevTools({
      /** The arena sky: "night" | "dawn" | "day" | "dusk", a time (Date / ISO string), or null (the clock). */
      sky: previewSky,
      /** Play today's sky from midnight to midnight in `seconds`, then follow the clock. */
      skyCycle: (seconds = 60) => previewSkyCycle(seconds, timeZone),
      /**
       * Force evening on / off (null: follow the clock). Pass `stakes` to
       * preview without the database (and 2 quests left, unless `quests`).
       */
      evening: (on: boolean | null = true, stakes?: Partial<TonightStakes>, quests?: number) =>
        setEveningDev({
          force: on,
          quests: quests ?? (stakes ? 2 : null),
          stakes: stakes
            ? {
                today: "", timezone: timeZone, boss_active: true, boss_name: boss?.name ?? "The boss",
                boss_hp: boss?.current_hp ?? 60, boss_max_hp: boss?.max_hp ?? 60,
                my_open_quests: 2,
                raid_damage: Math.max(1, Math.ceil(((boss?.max_hp ?? 60) * 5) / 100)),
                rescue_open: false,
                ...stakes,
              }
            : null,
        }),
    });
  }, [timeZone, boss?.name, boss?.current_hp, boss?.max_hp]);

  // LEVEL UP: announced when the live level rises (not on first load). The
  // celebration overlay queues it until any hit sequence has finished.
  const shownLevel = useRef(stats.level);
  useEffect(() => {
    if (stats.level > shownLevel.current) emit({ type: "moment", name: "level_up", level: stats.level });
    shownLevel.current = stats.level;
  }, [stats.level, emit]);

  // Streak milestones: the nightly reset sets the streak (usually while
  // he's asleep), so celebrate on the next visit — once per milestone run,
  // remembered in this browser (keyed by the evaluated day).
  useEffect(() => {
    if (!STREAK_MILESTONES.includes(stats.streak) || !stats.streakThrough) return;
    const key = `fq:streak-milestone:${childId}`;
    const mark = `${stats.streak}@${stats.streakThrough}`;
    try {
      if (window.localStorage.getItem(key) === mark) return;
      window.localStorage.setItem(key, mark);
    } catch {
      // Storage unavailable (private mode): celebrate anyway.
    }
    emit({ type: "moment", name: "streak_milestone", days: stats.streak });
  }, [stats.streak, stats.streakThrough, childId, emit]);
  const shown = stage.shown;

  // The hero, from the event stream (lib/rpg/hero-stage.ts): an attack on
  // damage and a victory pose when a boss falls. (His flinch and knock-out
  // are dormant since …16: nothing sends a "miss" or "party" event.)
  const { hero, partyRef } = useHero(shown?.id ?? null);
  const arenaRef = useArenaShake(shown?.id ?? null);
  useDevicePixelStep();
  // The day/night sky (and the party's night tint), in the family's timezone.
  const sky = useArenaSky(timeZone);

  return (
    <section
      aria-label="Boss battle"
      // Thick bevel; the container for the arena's cqw sizing.
      className="panel panel-stone border-4 p-2 shadow-[inset_3px_3px_0_var(--panel-hi),inset_-3px_-3px_0_var(--panel-shade)] [container-type:inline-size] sm:p-3"
    >
      <div
        ref={arenaRef}
        className={`relative overflow-hidden rounded-[2px] border-2 border-stone-edge ${ARENA_CLASS}`}
        style={{ ...ARENA_STYLE, ...sky }}
        suppressHydrationWarning
      >
        <ArenaBackdrop />

        {/* The party: Rogue just behind the hero, both facing right. (The
            red flash + shove on a boss's blow is dormant since …16.) */}
        <div
          ref={partyRef}
          className="arena-party absolute inset-x-0 bottom-(--ground) top-0 z-10"
          style={{ "--impact": `${BOSS_ATTACK_IMPACT_MS}ms` } as React.CSSProperties}
          onAnimationEnd={(e) => {
            if (e.target === e.currentTarget) e.currentTarget.classList.remove("hero-hit");
          }}
        >
          {/* Rogue reacts with the hero: same pose machine, same key. */}
          <RogueSprite pose={roguePoseFor(hero.state.pose)} playKey={hero.state.key} />
          <FeetSpot x={FEET_X.hero}>
            <AnchoredSprite
              key={hero.state.key}
              animation={hero.animation}
              // One scale for every pose (lib: heroHeight), so he never resizes.
              height={heroHeight(hero.animation)}
              mirror={needsMirror(hero.animation.facing, "right")}
              alt={heroName}
              onComplete={hero.onComplete}
            />
          </FeetSpot>
        </div>

        {/* The boss, facing left, with a pulsing aura behind it — glowing
            and pulsing a little faster while it charges up (evening). */}
        <div className="absolute inset-x-0 bottom-(--ground) top-0 z-10">
          {shown ? (
            <FeetSpot key={shown.id} x={FEET_X.boss} className="boss-enter">
              <div
                aria-hidden
                className={`boss-aura absolute bottom-[-10%] left-0 aspect-square -translate-x-1/2 rounded-full ${
                  shown.tier === "epic" ? "boss-aura-epic" : ""
                } ${charging ? "boss-aura-charging" : ""}`}
                style={{ height: `calc(${bossHeight(shown)} * 1.45)` }}
              />
              {/* Zero-width like the feet spot, so the sprite stands where it would. */}
              <div className={`absolute inset-0 ${charging ? "boss-charging" : ""}`}>
                <BossSprite
                  spriteKey={shown.sprite_key}
                  name={shown.name}
                  mode={stage.mode}
                  playKey={stage.playKey}
                  height={bossHeight(shown)}
                  face="left"
                  onReactionDone={onBossAnimationEnd}
                  onFinishDone={onBossFinished}
                />
              </div>
            </FeetSpot>
          ) : (
            <p className="absolute inset-y-0 right-0 flex w-1/2 items-center justify-center px-2 text-center font-display text-base font-semibold text-parchment text-shadow-pixel">
              All quiet — no boss to fight.
            </p>
          )}
        </div>

        <EventBanner caption={stage.caption} playKey={stage.playKey} />
        {/* Sound effects on/off, in the empty sky above the hero. */}
        <SoundToggle className="absolute left-2 top-2 z-30" />
      </div>

      {/* HUD: one header row — the party (left, under the hero; a name only,
          party HP is gone since …16) and the boss (right) — then the boss HP
          bar full width, then the stats. (Quick fix: the long-term redesign
          of this space is deferred.) */}
      <div className="mt-2 sm:mt-3">
        <div className="mb-1.5 flex items-center justify-between gap-3 sm:gap-4">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <h2 className="min-w-0 truncate font-display text-lg font-semibold text-parchment text-shadow-pixel sm:text-xl">
              {heroName}
            </h2>
            <span className="hidden shrink-0 whitespace-nowrap rounded-[3px] border-2 border-stone-edge bg-[#2b8a3e] px-1.5 py-0.5 font-display text-sm font-semibold uppercase text-white sm:inline">
              Party
            </span>
          </div>
          {shown ? (
            <div className="flex min-w-0 flex-1 items-center justify-end gap-2">
              <h2 className="min-w-0 truncate font-display text-lg font-semibold text-gold text-shadow-pixel sm:text-xl">
                {shown.name}
              </h2>
              <span className="hidden shrink-0 sm:inline">
                <TierCrest tier={shown.tier} />
              </span>
            </div>
          ) : (
            <p className="min-w-0 flex-1 text-right font-display text-base font-semibold text-gold text-shadow-pixel">
              Every boss conquered!
            </p>
          )}
        </div>
        {shown && (
          <HudBar
            label="Boss HP"
            icon={<SkullIcon className="h-4 w-4 shrink-0" />}
            current={shown.current_hp}
            max={shown.max_hp}
            segments={BOSS_SEGMENTS[shown.tier]}
            tone="boss"
          />
        )}
        {/* (The old grid's 8px row gap + 8px margin.) */}
        <div className="mt-4">
          <StatsStrip
            stats={stats}
            withinReach={shopProgress(rewards, stats.gold).affordable}
            questsLeftToday={questsLeftToday}
            eveningLine={evening.line}
            rescueOpen={rescueOpen}
          />
        </div>
      </div>
    </section>
  );
}

const heroAnims = SPRITES.hero.animations;

/**
 * The scene's hero: the pose machine fed from the battle events, the
 * animation for its pose, and the party's red flash (partyRef goes on the
 * party's box). Also registers the development console hooks for his
 * reactions.
 */
function useHero(shownBossId: string | null) {
  const [state, dispatch] = useReducer(heroReducer, null, initialHero);
  // His attacks: random, never the same one twice running.
  const [pickVariant] = useState(() => createNoRepeatPicker(STRIKE_VARIANTS.length));
  // The party's red flash + shove (.hero-hit), restarted by re-adding the
  // class — re-keying the party would restart his pose too (a K.O. mid-fall).
  const partyRef = useRef<HTMLDivElement>(null);
  const flashParty = useCallback(() => {
    const el = partyRef.current;
    if (!el) return;
    el.classList.remove("hero-hit");
    void el.offsetWidth; // restart the CSS animation
    el.classList.add("hero-hit");
  }, []);

  useBattleEvents((event) => {
    dispatch({ type: "event", event, variant: event.type === "damage" ? pickVariant() : undefined });
    if (event.type === "miss") flashParty(); // dormant: only the dev hurt() preview
  });

  // The victory pose holds until the next boss takes the stage.
  const lastShown = useRef(shownBossId);
  useEffect(() => {
    if (shownBossId === lastShown.current) return;
    lastShown.current = shownBossId;
    dispatch({ type: "swap" });
  }, [shownBossId]);

  // Knocked out and the party's refilled: lie there a moment, then get up.
  // (Dormant since …16: nothing knocks him out.)
  const riseDue = state.pose === "down" && state.pendingRise;
  useEffect(() => {
    if (!riseDue) return;
    const t = setTimeout(() => dispatch({ type: "rise" }), DOWN_HOLD_MS);
    return () => clearTimeout(t);
  }, [riseDue]);

  // Development only: his reactions on demand (see CLAUDE.md), through the
  // same events the database sends.
  const { boss, emit } = useBattleContext();
  const latest = useRef({ boss });
  useEffect(() => {
    latest.current = { boss };
  }, [boss]);
  useEffect(() => {
    if (process.env.NODE_ENV !== "development") return;
    let victoryTimer: ReturnType<typeof setTimeout> | undefined;
    const cleanup = registerDevTools({
      // Preview of the DORMANT boss attack (kept for later seasons): the
      // boss lunges, he flinches, the red flash. Nothing else changes.
      hurt: (amount = 10) => {
        const b = latest.current.boss;
        if (b) emit({ type: "miss", bossId: b.id, amount, childId: null, slotId: null, at: new Date().toISOString() });
      },
      // Rogue's Night Raid landing on the boss, as the nightly reset's
      // boss_log row sends it (no database write: the HP bar doesn't move).
      raid: (amount = 3) => {
        const b = latest.current.boss;
        if (b) emit({ type: "raid", bossId: b.id, amount, childId: null, at: new Date().toISOString() });
      },
      // His victory pose alone (finalBlow() plays the whole overlay), held
      // `holdMs` — the next boss would end it in the real game.
      victory: (holdMs = 3000) => {
        dispatch({ type: "play", pose: "victory" });
        clearTimeout(victoryTimer);
        victoryTimer = setTimeout(() => dispatch({ type: "swap" }), holdMs);
      },
    });
    return () => {
      clearTimeout(victoryTimer);
      cleanup();
    };
  }, [emit]);

  const variant = STRIKE_VARIANTS[state.variant];
  const animation = state.pose === "attack" ? heroAnims[variant.animation] : HERO_POSES[state.pose];
  const oneShot = state.pose === "attack" || state.pose === "hurt" || state.pose === "ko" || state.pose === "rise";

  return {
    hero: { state, animation, onComplete: oneShot ? () => dispatch({ type: "end" }) : undefined },
    partyRef,
  };
}

/**
 * Shakes the arena box on hits (by tier) and rumbles it on the final blow
 * (a "defeated" event for the boss on stage). Web Animations on `translate`,
 * so it never fights a class's `transform`. Skipped under reduced motion,
 * like the hit overlay's shake (checked when it would play, as the sprite
 * animator does). A hit landing during the rumble doesn't cut it short:
 * Realtime can deliver the defeat and its final damage in either order.
 */
function useArenaShake(shownBossId: string | null) {
  const ref = useRef<HTMLDivElement>(null);
  const shownId = useRef(shownBossId);
  useEffect(() => {
    shownId.current = shownBossId;
  }, [shownBossId]);
  const running = useRef<{ anim: Animation; rumble: boolean } | null>(null);

  useBattleEvents((event) => {
    const el = ref.current;
    if (!el || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const rumble = event.type === "defeated" && event.boss.id === shownId.current;
    const hitAmount = event.type === "damage" ? event.amount : null;
    if (!rumble && hitAmount === null) return;
    const current = running.current;
    if (current && current.rumble && current.anim.playState === "running" && !rumble) return;
    current?.anim.cancel();

    let keyframes: Keyframe[];
    let duration: number;
    if (rumble) {
      // A long, decaying rumble from the heavy tier's distance.
      const k = HIT_TIERS.heavy.shake;
      const steps = 18;
      keyframes = Array.from({ length: steps + 1 }, (_, i) => {
        const a = i === steps ? 0 : k * (1 - i / steps);
        const dir = i % 2 ? 1 : -1;
        return { translate: `${Math.round(dir * a)}px ${Math.round((i % 3 === 0 ? -dir : dir) * a * 0.4)}px` };
      });
      duration = ARENA_SHAKE.rumbleMs;
    } else {
      // The hit overlay's shake, at this hit's tier.
      const k = HIT_TIERS[hitTier(hitAmount ?? 0)].shake;
      keyframes = [
        { translate: "0 0" },
        { translate: `${-k}px ${k / 2}px` },
        { translate: `${k}px ${-k / 2}px` },
        { translate: `${-k / 2}px ${k / 3}px` },
        { translate: `${k / 3}px 0` },
        { translate: "0 0" },
      ];
      duration = ARENA_SHAKE.hitMs;
    }
    running.current = { anim: el.animate(keyframes, { duration, easing: "ease-out" }), rumble };
  });
  useEffect(() => () => running.current?.anim.cancel(), []);
  return ref;
}

/** Event captions as a parchment banner across the top of the arena. */
function EventBanner({ caption, playKey }: { caption: string | null; playKey: number }) {
  const { overlayActive } = useBattleContext();
  // Screen readers: announce each new caption once — but not while the hit
  // overlay is playing (it announces Reuben's own hits itself), and not
  // late when it finishes.
  const [spoken, setSpoken] = useState({ playKey, text: caption ?? "" });
  if (playKey !== spoken.playKey) {
    setSpoken({ playKey, text: overlayActive ? spoken.text : (caption ?? "") });
  }
  return (
    <>
      {caption && (
        <p
          key={`${playKey}-${caption}`}
          aria-hidden
          className="event-banner absolute inset-x-0 top-2 z-20 mx-auto w-fit max-w-[calc(100%-6.5rem)] rounded-[3px] border-2 border-parchment-edge bg-parchment px-3 py-1 text-center text-sm font-extrabold text-ink shadow-[2px_2px_0_rgb(0_0_0/0.45)] sm:text-base"
        >
          {caption}
        </p>
      )}
      <p aria-live="polite" className="sr-only">
        {spoken.text}
      </p>
    </>
  );
}

function TierCrest({ tier, small = false }: { tier: Boss["tier"]; small?: boolean }) {
  return (
    <span
      className={`shrink-0 whitespace-nowrap rounded-[3px] border-2 font-display font-semibold uppercase ${
        small ? "px-1 text-sm leading-tight" : "px-1.5 py-0.5 text-sm"
      } ${
        tier === "epic"
          ? "border-[#8a5a00] bg-danger text-gold shadow-[inset_0_2px_0_rgb(255_255_255/0.25)]"
          : "border-stone-edge bg-stone-hi text-white"
      }`}
    >
      {tierLabel(tier)}
    </span>
  );
}

/**
 * Level / XP / Gold / Streak as an equipment strip under the hero. Values
 * come live from player_stats as-is (level, XP and streak aren't wired to
 * game logic yet). Numbers use the body font (Stage 1's digit rule).
 */
function StatsStrip({
  stats,
  withinReach,
  questsLeftToday,
  eveningLine,
  rescueOpen,
}: {
  stats: PlayerStats;
  withinReach: number;
  questsLeftToday: number | null;
  /** The evening nudge (it includes the streak, so it replaces the streak nudge). */
  eveningLine: string | null;
  /** A frozen streak: no streak nudge. */
  rescueOpen: boolean;
}) {
  const cell =
    "flex min-w-0 flex-col items-center rounded-[3px] border-2 border-stone-edge bg-well px-1 py-1.5 shadow-[inset_2px_2px_0_rgb(0_0_0/0.5)]";
  const label = "mt-1 font-display text-sm font-semibold uppercase leading-none text-stone-text";
  const value = "text-lg font-black leading-none tabular-nums";
  const xp = levelProgress(stats.xp);
  const nudge = stats.streak > 0 && !rescueOpen && questsLeftToday !== null && questsLeftToday > 0;
  // PLACEHOLDER COPY (the streak nudge): what a perfect day wins, not what a miss costs.
  const nudgeLine =
    eveningLine ??
    (nudge
      ? `${questsLeftToday} quest${questsLeftToday === 1 ? "" : "s"} left today — a perfect day makes your streak ${stats.streak + 1}!`
      : null);

  return (
    <div>
      <ul className="grid grid-cols-4 gap-1.5" aria-label="Your stats">
        <li className="min-w-0">
          <div className={`${cell} h-full`}>
            <span className="flex items-center gap-1">
              <ShieldIcon className="h-5 w-5 shrink-0" />
              <span className={`${value} text-white`}>{stats.level}</span>
            </span>
            <span className={label}>Level</span>
          </div>
        </li>
        <li className="min-w-0">
          {/* XP toward the next level: "340 / 600" and a small segmented bar. */}
          <div
            className={`${cell} h-full`}
            role="group"
            aria-label={`${stats.xp} XP; ${xp.to - stats.xp} more to reach level ${xp.level + 1}`}
          >
            <span className="flex items-center gap-1">
              <StarIcon className="h-5 w-5 shrink-0" />
              <span className="font-black leading-none tabular-nums text-white">
                <span className="text-base sm:text-lg">{stats.xp}</span>
                <span className="text-xs text-stone-text sm:text-sm">/{xp.to}</span>
              </span>
            </span>
            <span aria-hidden className="mt-1 flex h-2 w-full max-w-24 gap-px rounded-[2px] border border-stone-edge bg-black/40 p-px">
              {Array.from({ length: 5 }, (_, i) => (
                <span key={i} className="relative flex-1 overflow-hidden rounded-[1px] bg-white/[0.07]">
                  <span
                    className="absolute inset-y-0 left-0 bg-gold"
                    style={{ width: `${Math.max(0, Math.min(1, xp.fraction * 5 - i)) * 100}%` }}
                  />
                </span>
              ))}
            </span>
            <span className={label}>XP</span>
          </div>
        </li>
        <li className="min-w-0">
          {/* Gold opens the shop; the tab says how much he can buy. */}
          <Link
            href="/player/store"
            aria-label={`${stats.gold} gold${withinReach ? `, ${withinReach} reward${withinReach === 1 ? "" : "s"} within reach` : ""}. Open the item shop`}
            className={`${cell} relative h-full border-[#8a5a00] transition-[filter] hover:brightness-125 focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-gold motion-reduce:transition-none`}
          >
            <span className="flex items-center gap-1">
              <CoinIcon className="h-5 w-5 shrink-0" />
              <span className={`${value} text-gold`}>{stats.gold}</span>
            </span>
            <span className={label}>Gold</span>
            {withinReach > 0 && (
              // A small tab on the cell's top-right corner (the stats row
              // has room above it, so it clears the HP bars).
              <span className="absolute -top-2.5 right-1 whitespace-nowrap rounded-t-[3px] rounded-bl-[3px] border-2 border-[#8a5a00] bg-gold px-1 text-[10px] font-black leading-3 text-ink shadow-[1px_1px_0_rgb(0_0_0/0.4)]">
                {withinReach} within reach
              </span>
            )}
          </Link>
        </li>
        <li className="min-w-0">
          <div
            className={`${cell} h-full ${nudge ? "streak-nudge border-gold-deep" : ""}`}
            aria-label={`${stats.streak}-day streak (best ${stats.bestStreak})`}
            role="group"
          >
            <span className="flex items-center gap-1">
              <FlameIcon className="h-5 w-5 shrink-0" />
              <span className={`${value} text-white`}>{stats.streak}</span>
            </span>
            <span className={label}>Streak</span>
          </div>
        </li>
      </ul>
      {/* One nudge under the row: the evening nudge (tonight's Night Raid,
          streak included) as a ribbon banner or, before evening, the streak
          nudge. */}
      {eveningLine ? (
        <RaidBanner text={eveningLine} />
      ) : (
        nudgeLine && (
          <p className="mt-1.5 flex items-center justify-end gap-1.5 text-right text-sm font-bold text-gold text-shadow-pixel">
            <FlameIcon className="h-4 w-4 shrink-0" />
            {nudgeLine}
          </p>
        )
      )}
    </div>
  );
}
