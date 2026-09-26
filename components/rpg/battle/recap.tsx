"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { AnchoredSprite, needsMirror } from "@/components/rpg/sprites/anchored-sprite";
import { bossAnimations } from "@/components/rpg/sprites/boss-animations";
import type { RescueEvent } from "@/lib/supabase/types";
import { PixelButton } from "@/components/ui/pixel-button";
import { roguePoseFor } from "@/lib/rpg/hero-stage";
import {
  recapFinalState,
  recapSchedule,
  summarizeRecaps,
  type RecapBoss,
  type RecapRow,
  type RecapSummary,
} from "@/lib/rpg/recap";
import { registerDevTools, useBattleContext } from "./battle-provider";
import { ArenaBackdrop, HERO_POSES, RogueSprite } from "./arena-parts";
import { useArenaSky } from "./arena-backdrop";
import {
  ARENA_CLASS,
  ARENA_STYLE,
  FEET_X,
  FeetSpot,
  bossHeight,
  heroHeight,
  useDevicePixelStep,
} from "./stage-layout";

// "While you were away": on his first /player visit after a nightly reset
// with good news for him, a short replay before anything else — Rogue's
// Night Raid landing on the boss (it flinches, ONE damage number, a sound;
// the hero cheers, Rogue barks), with a few kid-friendly lines; or, with no
// raid, a text card (a streak on hold / won back). Nights with nothing to
// say ("quiet": misses only) show nothing and are acknowledged silently.
// The animated part plays by itself (a tap skips it); it always ends on the
// summary card — every line plus the closing line — which stays up until he
// taps Continue, so the explanation can't be missed.
//
// "Seen" lives in the database (reset_recaps.seen_at via
// acknowledge_recaps): acknowledged as soon as it starts, so a skip counts
// and another device won't show it again. The story comes from
// lib/rpg/recap.ts (summary, lines and timeline).

export function RecapHost({
  initial,
  acknowledge,
  timeZone,
}: {
  /** The recap to play on load (unseen rows, summarized server-side), or null. */
  initial: RecapSummary | null;
  /** Marks his recaps up to `through` seen (server action). */
  acknowledge: (through: string) => Promise<void>;
  /** The family's timezone: the arena's day/night sky, as in the battle scene. */
  timeZone: string;
}) {
  const { setRecapActive } = useBattleContext();
  const [playing, setPlaying] = useState<{ summary: RecapSummary; preview: boolean; key: number } | null>(
    initial && initial.kind !== "quiet" ? { summary: initial, preview: false, key: 0 } : null,
  );

  // Seen as soon as it starts (a skip counts; other devices won't replay it).
  // A quiet recap (nothing to say) is acknowledged without showing.
  const acknowledged = useRef(false);
  useEffect(() => {
    const summary = playing && !playing.preview ? playing.summary : initial?.kind === "quiet" ? initial : null;
    if (!summary || acknowledged.current) return;
    acknowledged.current = true;
    void acknowledge(summary.through).catch(() => {
      // Offline: it plays again next visit, which is fine.
    });
  }, [playing, initial, acknowledge]);

  useEffect(() => {
    setRecapActive(playing !== null);
  }, [playing, setRecapActive]);

  // Development only: preview with fake data (no database writes).
  useEffect(() => {
    if (process.env.NODE_ENV !== "development") return;
    return registerDevTools({
      recap: (kind: keyof typeof DEV_RECAPS = "raid") => {
        const summary = devRecap(kind);
        if (summary?.kind === "quiet") return "A quiet night: nothing to show (acknowledged silently).";
        if (summary) setPlaying((p) => ({ summary, preview: true, key: (p?.key ?? 0) + 1 }));
      },
    });
  }, []);

  const close = useCallback(() => setPlaying(null), []);
  if (!playing) return null;
  return <Recap key={playing.key} summary={playing.summary} onClose={close} timeZone={timeZone} />;
}

type Pose = "idle" | "victory";

function Recap({
  summary: s,
  onClose,
  timeZone,
}: {
  summary: RecapSummary;
  onClose: () => void;
  timeZone: string;
}) {
  const { emit } = useBattleContext();
  const sky = useArenaSky(timeZone);
  const reduced = usePrefersReducedMotion();
  useDevicePixelStep();

  const [hero, setHero] = useState<{ pose: Pose; key: number }>({ pose: "idle", key: 0 });
  const [bossHurt, setBossHurt] = useState<number | null>(null);
  const [raided, setRaided] = useState(false);
  const [lines, setLines] = useState(0);
  const [closing, setClosing] = useState(false);
  // Tapped during the animated part: jump to the summary card.
  const [skipped, setSkipped] = useState(false);
  const [leaving, setLeaving] = useState(false);

  // The summary card: reached by the timeline ("closing"), a skip, or at
  // once under reduced motion. Only Continue leaves it.
  const atSummary = reduced || skipped || closing;
  const skip = useCallback(() => setSkipped(true), []);
  const leave = useCallback(() => setLeaving(true), []);

  // The animated part (reduced motion: the summary at once; skipped: the
  // cleanup has cancelled the rest of the timeline).
  useEffect(() => {
    if (skipped) return;
    if (reduced) {
      // Everything shows at once (see `shown` below); just the sound.
      if (s.kind === "raid") emit({ type: "moment", name: "night_raid" });
      return;
    }
    const timers = recapSchedule(s).map((beat) =>
      setTimeout(() => {
        switch (beat.kind) {
          case "raid":
            emit({ type: "moment", name: "night_raid" });
            setBossHurt((k) => (k ?? 0) + 1);
            setRaided(true);
            break;
          case "cheer":
            setHero((h) => ({ pose: "victory", key: h.key + 1 }));
            break;
          case "line":
            setLines(beat.index + 1);
            break;
          case "closing":
            setClosing(true);
            break;
        }
      }, beat.at),
    );
    return () => timers.forEach(clearTimeout);
  }, [s, reduced, skipped, emit]);

  // Fade out, then gone.
  useEffect(() => {
    if (!leaving) return;
    const t = setTimeout(onClose, 260);
    return () => clearTimeout(t);
  }, [leaving, onClose]);

  // Keyboard: Escape skips the animation like a tap (the Skip / Continue
  // button has focus; Enter or Space on Continue closes).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !atSummary && skip();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [atSummary, skip]);

  // Skipped or reduced motion: the summary card's final state straight away.
  const jumped = reduced || skipped;
  const final = recapFinalState(s);
  const shown = {
    lines: jumped ? final.lines : lines,
    closing: atSummary,
    hero: skipped ? ({ pose: "idle", key: -1 } as const) : hero,
  };

  // PLACEHOLDER COPY (the title).
  const title = s.kind === "raid" ? "Night Raid!" : "While you were away…";
  const showArena = s.kind === "raid" && !reduced && final.boss !== null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="recap-title"
      // A tap during the animation skips to the summary; on the summary
      // card, only Continue closes it.
      onClick={atSummary ? undefined : skip}
      className={`fixed inset-0 z-50 flex items-center ${atSummary ? "" : "cursor-pointer"} justify-center p-3 ${leaving ? "overlay-out" : ""}`}
    >
      <div aria-hidden className="overlay-dim absolute inset-0" />
      <div className="reduced-card panel panel-stone relative w-full max-w-xl p-3 sm:p-4 [container-type:inline-size]">
        <h2 id="recap-title" className="mb-2 text-center font-display text-2xl font-semibold text-gold text-shadow-pixel sm:text-3xl">
          {title}
        </h2>

        {showArena && final.boss && (
          <div
            className={`relative overflow-hidden rounded-[2px] border-2 border-stone-edge ${ARENA_CLASS}`}
            style={{ ...ARENA_STYLE, ...sky }}
            suppressHydrationWarning
          >
            <ArenaBackdrop />
            <div className="arena-party absolute inset-x-0 bottom-(--ground) top-0 z-10">
              {/* Rogue barks as the hero cheers. */}
              <RogueSprite pose={roguePoseFor(shown.hero.pose)} playKey={shown.hero.key} />
              <FeetSpot x={FEET_X.hero}>
                <AnchoredSprite
                  key={shown.hero.key}
                  animation={HERO_POSES[shown.hero.pose]}
                  height={heroHeight(HERO_POSES[shown.hero.pose])}
                  mirror={needsMirror(HERO_POSES[shown.hero.pose].facing, "right")}
                  alt=""
                />
              </FeetSpot>
            </div>
            <div className="absolute inset-x-0 bottom-(--ground) top-0 z-10">
              <RecapBossSprite boss={final.boss} hurtKey={skipped ? null : bossHurt} />
              {raided && !skipped && (
                <FeetSpot x={FEET_X.boss}>
                  <p className="damage-pop absolute bottom-[calc(var(--arena)*0.62)] left-0 w-max -translate-x-1/2 font-body text-5xl font-black leading-none text-[#ff8787] [text-shadow:3px_3px_0_#12141f,-1px_-1px_0_#12141f]">
                    -{s.raidDamage}
                  </p>
                </FeetSpot>
              )}
            </div>
          </div>
        )}

        <div aria-live="polite" className="mt-3 min-h-16 space-y-1 text-center">
          {s.lines.slice(0, shown.lines).map((line) => (
            <p key={line} className="reduced-card font-extrabold text-parchment">
              {line}
            </p>
          ))}
          {shown.closing && (
            <p className="reduced-card pt-1 font-display text-xl font-semibold text-gold text-shadow-pixel">{s.closing}</p>
          )}
        </div>

        <div className="mt-3 flex justify-center">
          <PixelButton
            variant="stone"
            size="sm"
            autoFocus
            onClick={(e) => {
              e.stopPropagation();
              if (atSummary) leave();
              else skip();
            }}
          >
            {atSummary ? "Continue" : "Skip"}
          </PixelButton>
        </div>
      </div>
    </div>
  );
}

/** The raided boss in the recap: idle, flinching once as the raid lands. */
function RecapBossSprite({ boss, hurtKey }: { boss: RecapBoss; hurtKey: number | null }) {
  const [doneKey, setDoneKey] = useState<number | null>(null);
  const anims = bossAnimations(boss.sprite_key);
  if (!anims) return null;
  const hurt = hurtKey !== null && doneKey !== hurtKey;
  const anim = hurt ? anims.hurt : anims.idle;
  return (
    <FeetSpot x={FEET_X.boss}>
      <AnchoredSprite
        key={hurt ? `hurt-${hurtKey}` : "idle"}
        animation={anim}
        height={`calc(${bossHeight(boss)} * ${anim.height / anims.idle.height})`}
        mirror={needsMirror(anim.facing, "left")}
        alt=""
        className={hurt ? "boss-fx-hurt" : ""}
        onComplete={hurt ? () => setDoneKey(hurtKey) : undefined}
      />
    </FeetSpot>
  );
}

function usePrefersReducedMotion() {
  return useSyncExternalStore(
    (onChange) => {
      const query = window.matchMedia("(prefers-reduced-motion: reduce)");
      query.addEventListener("change", onChange);
      return () => query.removeEventListener("change", onChange);
    },
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    () => false,
  );
}

// --- Development only: fake recaps for __fqBattle.recap(kind) ---------------------

const DEV_BOSSES: Record<string, RecapBoss> = {
  slime: { id: "dev-slime", name: "Trash-Bag Slime", sprite_key: "trash_bag_slime", tier: "low" },
  swarm: { id: "dev-swarm", name: "Alarm Clock Swarm", sprite_key: "alarm_clock_swarm", tier: "low" },
};
const devRow = (over: Partial<RecapRow>): RecapRow => ({
  created_at: new Date().toISOString(),
  day_from: "2000-01-01",
  day_to: "2000-01-01",
  boss_id: "dev-slime",
  perfect_days: 0,
  streak_before: 0,
  streak_after: 0,
  rescue_events: [],
  raid_damage: 0,
  raids: 0,
  ...over,
});
const DEV_RECAPS = {
  raid: [devRow({ perfect_days: 1, raid_damage: 3, raids: 1, streak_before: 2, streak_after: 3 })],
  nights: [
    devRow({ day_from: "1999-12-30", day_to: "1999-12-30", perfect_days: 1, raid_damage: 3, raids: 1 }),
    devRow({ perfect_days: 1, raid_damage: 3, raids: 1, boss_id: "dev-swarm" }),
  ],
  // A perfect day with nothing to raid (the boss already at 1 HP).
  text: [devRow({ perfect_days: 1 })],
  // Misses only: nothing to say.
  quiet: [devRow({})],
  // Streak recovery (…14): the night it goes on hold, then won back or halved.
  cracked: [
    devRow({ streak_before: 6, streak_after: 6, rescue_events: [devRescue("cracked", { offered_count: 5 })] }),
  ],
  rescued: [
    devRow({ streak_before: 6, streak_after: 6, rescue_events: [devRescue("rescued", { job_title: "Tidy the shoe rack" })] }),
  ],
  halved: [devRow({ streak_before: 7, streak_after: 4, rescue_events: [devRescue("halved", { streak_at_crack: 7, streak_after: 4 })] })],
};
function devRescue(event: RescueEvent["event"], over: Partial<RescueEvent> = {}): RescueEvent {
  return {
    event, rescue_id: "dev-rescue", missed_day: "1999-12-31", due_on: "2000-01-02",
    streak_at_crack: 6, streak_after: 6, fallback: false, ...over,
  };
}
function devRecap(kind: keyof typeof DEV_RECAPS) {
  const rows = DEV_RECAPS[kind];
  if (!rows) return null;
  const bosses = { "dev-slime": DEV_BOSSES.slime, "dev-swarm": DEV_BOSSES.swarm };
  return summarizeRecaps(rows, bosses, "2000-01-01");
}
