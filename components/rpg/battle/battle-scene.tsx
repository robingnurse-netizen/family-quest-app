"use client";

import { useState } from "react";
import Link from "next/link";
import type { Boss } from "@/lib/supabase/types";
import { SPRITES } from "@/components/rpg/sprites/manifests";
import { AnchoredSprite, needsMirror } from "@/components/rpg/sprites/anchored-sprite";
import { BossSprite } from "@/components/rpg/boss/boss-sprite";
import { CoinIcon, FlameIcon, HeartIcon, ShieldIcon, SkullIcon, StarIcon } from "@/components/ui/icons";
import { useBattleContext, useBattleEvents } from "./battle-provider";
import { HudBar } from "./hud-bar";
import { usePlayerStats } from "@/lib/hooks/use-player-stats";
import { shopProgress } from "@/lib/rewards/progress";
import type { Reward } from "@/lib/supabase/types";
import { ARENA_STYLE, FEET_X, FeetSpot, HEIGHT, arenaHeight, bossHeight } from "./stage-layout";

// Reuben's battle scene: one framed arena with his hero and Rogue on the left
// facing the active boss on the right, the HUD bars under each side and his
// stats along the bottom. It sits in normal page flow and never moves.
// Characters stand by their feet anchors at fixed stage positions
// (./stage-layout — shared with the hit overlay); everything is sized from
// the arena height (--arena, in container units), so the same layout scales
// down to a phone with the two sides still facing each other.

/** HP bar chunks: more for tougher bosses. */
const BOSS_SEGMENTS: Record<Boss["tier"], number> = { low: 10, mid: 15, epic: 20 };
const PARTY_SEGMENTS = 10;

export type PlayerStats = { level: number; xp: number; gold: number; streak: number };

const tierLabel = (tier: Boss["tier"]) => (tier === "epic" ? "Epic boss" : tier === "mid" ? "Boss" : "Minion");

export function BattleScene({
  heroName,
  childId,
  stats: initialStats,
  rewards,
}: {
  heroName: string;
  childId: string;
  /** Server-rendered stats; kept live from player_stats (Realtime). */
  stats: PlayerStats;
  /** The shop's rewards, for the Gold stat's "N within reach" badge. */
  rewards: Reward[];
}) {
  const { party, stage, onBossAnimationEnd, onBossFinished } = useBattleContext();
  const stats = usePlayerStats(childId, initialStats);
  const shown = stage.shown;

  // Hero reactions, straight from the event stream: strike on damage, take
  // the hit (red flash) on a missed quest.
  const [heroPose, setHeroPose] = useState<{ pose: "idle" | "attack" | "hit"; key: number }>({ pose: "idle", key: 0 });
  useBattleEvents((event) => {
    if (event.type === "damage") setHeroPose((p) => ({ pose: "attack", key: p.key + 1 }));
    if (event.type === "miss") setHeroPose((p) => ({ pose: "hit", key: p.key + 1 }));
  });
  const backToIdle = () => setHeroPose((p) => ({ pose: "idle", key: p.key + 1 }));

  const hero = SPRITES.hero.animations;
  const heroAnim = heroPose.pose === "attack" ? hero.attack : hero.idle;

  return (
    <section
      aria-label="Boss battle"
      // Thick bevel; the container for the arena's cqw sizing.
      className="panel panel-stone border-4 p-2 shadow-[inset_3px_3px_0_var(--panel-hi),inset_-3px_-3px_0_var(--panel-shade)] [container-type:inline-size] sm:p-3"
    >
      <div className="relative overflow-hidden rounded-[2px] border-2 border-stone-edge" style={ARENA_STYLE}>
        <ArenaBackdrop />

        {/* The party: Rogue just behind the hero, both facing right. */}
        <div
          key={heroPose.key}
          className={`absolute inset-x-0 bottom-(--ground) top-0 z-10 ${heroPose.pose === "hit" ? "hero-hit" : ""}`}
          onAnimationEnd={heroPose.pose === "hit" ? backToIdle : undefined}
        >
          <FeetSpot x={FEET_X.rogue}>
            <AnchoredSprite
              animation={SPRITES.rogue.animations.idle}
              height={arenaHeight(HEIGHT.rogue)}
              mirror={needsMirror(SPRITES.rogue.animations.idle.facing, "right")}
              alt="Rogue the dog"
            />
          </FeetSpot>
          <FeetSpot x={FEET_X.hero}>
            <AnchoredSprite
              animation={heroAnim}
              // One scale for the hero (from idle) so poses don't resize.
              height={arenaHeight(HEIGHT.hero * (heroAnim.height / hero.idle.height))}
              mirror={needsMirror(heroAnim.facing, "right")}
              alt={heroName}
              onComplete={heroPose.pose === "attack" ? backToIdle : undefined}
            />
          </FeetSpot>
        </div>

        {/* The boss, facing left, with a pulsing aura behind it. */}
        <div className="absolute inset-x-0 bottom-(--ground) top-0 z-10">
          {shown ? (
            <FeetSpot key={shown.id} x={FEET_X.boss} className="boss-enter">
              <div
                aria-hidden
                className={`boss-aura absolute bottom-[-10%] left-0 aspect-square -translate-x-1/2 rounded-full ${
                  shown.tier === "epic" ? "boss-aura-epic" : ""
                }`}
                style={{ height: `calc(${bossHeight(shown)} * 1.45)` }}
              />
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
            </FeetSpot>
          ) : (
            <p className="absolute inset-y-0 right-0 flex w-1/2 items-center justify-center px-2 text-center font-display text-base font-semibold text-parchment text-shadow-pixel">
              All quiet — no boss to fight.
            </p>
          )}
        </div>

        <EventBanner caption={stage.caption} playKey={stage.playKey} />
      </div>

      {/* HUD: the party (left, under the hero) and the boss (right) as
          equals — a header and an HP bar each — then the stats full width. */}
      <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-2 sm:mt-3 sm:gap-x-4">
        <div className="min-w-0">
          <div className="mb-1.5 flex items-center justify-between gap-2">
            <h2 className="min-w-0 truncate font-display text-lg font-semibold text-parchment text-shadow-pixel sm:text-xl">
              {heroName}
            </h2>
            <span className="hidden shrink-0 whitespace-nowrap rounded-[3px] border-2 border-stone-edge bg-[#2b8a3e] px-1.5 py-0.5 font-display text-sm font-semibold uppercase text-white sm:inline">
              Party
            </span>
          </div>
          {party && (
            <HudBar
              label="Party HP"
              icon={<HeartIcon className="h-4 w-4 shrink-0" />}
              current={party.current_hp}
              max={party.max_hp}
              segments={PARTY_SEGMENTS}
              tone="party"
            />
          )}
        </div>
        <div className="min-w-0">
          {shown ? (
            <>
              <div className="mb-1.5 flex items-center justify-between gap-2">
                <h2 className="min-w-0 truncate font-display text-lg font-semibold text-gold text-shadow-pixel sm:text-xl">
                  {shown.name}
                </h2>
                <span className="hidden sm:inline">
                  <TierCrest tier={shown.tier} />
                </span>
              </div>
              <HudBar
                label="Boss HP"
                icon={<SkullIcon className="h-4 w-4 shrink-0" />}
                current={shown.current_hp}
                max={shown.max_hp}
                segments={BOSS_SEGMENTS[shown.tier]}
                tone="boss"
              />
            </>
          ) : (
            <p className="font-display text-base font-semibold text-gold text-shadow-pixel">
              Every boss conquered!
            </p>
          )}
        </div>
        <div className="col-span-2 mt-2">
          <StatsStrip stats={stats} withinReach={shopProgress(rewards, stats.gold).affordable} />
        </div>
      </div>
    </section>
  );
}

/** Night sky with twinkling stars and drifting clouds, far and near pixel
 *  hills, then the ground strip. CSS only. */
function ArenaBackdrop() {
  return (
    <div aria-hidden className="absolute inset-0">
      <div className="arena-sky absolute inset-0" />
      {/* Twinkling stars (two layers out of step) and slow clouds drifting
          at two speeds for parallax. Static under reduced motion. */}
      <div className="arena-stars arena-stars-a absolute inset-0" />
      <div className="arena-stars arena-stars-b absolute inset-0" />
      <div className="arena-clouds arena-clouds-far top-[6%]" />
      <div className="arena-clouds arena-clouds-near top-[24%]" />
      <div className="arena-hills-far absolute inset-x-0 bottom-(--ground) h-[38%]" />
      <div className="arena-hills-near absolute inset-x-0 bottom-(--ground) h-[24%]" />
      <div className="absolute inset-x-0 bottom-0 h-(--ground) border-t-[3px] border-[#69db7c] bg-[#2b8a3e] shadow-[inset_0_calc(var(--ground)*-0.45)_0_#5c3b1e]" />
    </div>
  );
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
          className="event-banner absolute inset-x-0 top-2 z-20 mx-auto w-fit max-w-[92%] rounded-[3px] border-2 border-parchment-edge bg-parchment px-3 py-1 text-center text-sm font-extrabold text-ink shadow-[2px_2px_0_rgb(0_0_0/0.45)] sm:text-base"
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
function StatsStrip({ stats, withinReach }: { stats: PlayerStats; withinReach: number }) {
  const items = [
    { label: "Level", value: stats.level, Icon: ShieldIcon, valueClass: "text-white" },
    { label: "XP", value: stats.xp, Icon: StarIcon, valueClass: "text-white" },
    { label: "Gold", value: stats.gold, Icon: CoinIcon, valueClass: "text-gold" },
    { label: "Streak", value: stats.streak, Icon: FlameIcon, valueClass: "text-white" },
  ];
  const cell =
    "flex min-w-0 flex-col items-center rounded-[3px] border-2 border-stone-edge bg-well px-1 py-1.5 shadow-[inset_2px_2px_0_rgb(0_0_0/0.5)]";
  return (
    <ul className="grid grid-cols-4 gap-1.5" aria-label="Your stats">
      {items.map(({ label, value, Icon, valueClass }) => {
        const content = (
          <>
            <span className="flex items-center gap-1">
              <Icon className="h-5 w-5 shrink-0" />
              <span className={`text-lg font-black leading-none tabular-nums ${valueClass}`}>{value}</span>
            </span>
            <span className="mt-1 font-display text-sm font-semibold uppercase leading-none text-stone-text">
              {label}
            </span>
          </>
        );
        return (
          <li key={label} className="min-w-0">
            {label === "Gold" ? (
              // Gold opens the shop; the badge says how much he can buy.
              <Link
                href="/player/store"
                aria-label={`${value} gold${withinReach ? `, ${withinReach} reward${withinReach === 1 ? "" : "s"} within reach` : ""}. Open the item shop`}
                className={`${cell} relative h-full border-[#8a5a00] transition-[filter] hover:brightness-125 focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-gold motion-reduce:transition-none`}
              >
                {content}
                {withinReach > 0 && (
                  // A small tab on the cell's top-right corner (the stats row
                  // has room above it, so it clears the HP bars).
                  <span className="absolute -top-2.5 right-1 whitespace-nowrap rounded-t-[3px] rounded-bl-[3px] border-2 border-[#8a5a00] bg-gold px-1 text-[10px] font-black leading-3 text-ink shadow-[1px_1px_0_rgb(0_0_0/0.4)]">
                    {withinReach} within reach
                  </span>
                )}
              </Link>
            ) : (
              <div className={`${cell} h-full`}>{content}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
