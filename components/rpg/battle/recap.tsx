"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { AnchoredSprite, needsMirror } from "@/components/rpg/sprites/anchored-sprite";
import { bossAnimations } from "@/components/rpg/sprites/boss-animations";
import { HeartIcon } from "@/components/ui/icons";
import { PixelButton } from "@/components/ui/pixel-button";
import { BOSS_ATTACK_IMPACT_MS } from "@/lib/rpg/hero-stage";
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
import { HudBar } from "./hud-bar";
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
// that affected him, a short replay before anything else — the boss's blow
// (lunge, flinch, the party-damage sound, ONE damage number), a knock-out
// (the boss leaving, the next arriving, him getting back up) and
// perfect-day heals, with a few kid-friendly lines. The animated part
// plays by itself (a tap skips it); it always ends on the summary card —
// every line plus the closing line — which stays up until he taps
// Continue, so the explanation can't be missed.
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
    initial ? { summary: initial, preview: false, key: 0 } : null,
  );

  // Seen as soon as it starts (a skip counts; other devices won't replay it).
  const acknowledged = useRef(false);
  useEffect(() => {
    if (!playing || playing.preview || acknowledged.current) return;
    acknowledged.current = true;
    void acknowledge(playing.summary.through).catch(() => {
      // Offline: it plays again next visit, which is fine.
    });
  }, [playing, acknowledge]);

  useEffect(() => {
    setRecapActive(playing !== null);
  }, [playing, setRecapActive]);

  // Development only: preview with fake data (no database writes).
  useEffect(() => {
    if (process.env.NODE_ENV !== "development") return;
    return registerDevTools({
      recap: (kind: keyof typeof DEV_RECAPS = "blow") => {
        const summary = devRecap(kind);
        if (summary) setPlaying((p) => ({ summary, preview: true, key: (p?.key ?? 0) + 1 }));
      },
    });
  }, []);

  const close = useCallback(() => setPlaying(null), []);
  if (!playing) return null;
  return <Recap key={playing.key} summary={playing.summary} onClose={close} timeZone={timeZone} />;
}

type Pose = "idle" | "hurt" | "ko" | "down" | "rise";
type BossOnStage = { boss: RecapBoss; mode: "idle" | "attack" | "escape" | "enter" } | null;

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
  const [boss, setBoss] = useState<BossOnStage>(() =>
    s.kind === "blow" && s.attacker ? { boss: s.attacker, mode: "idle" } : null,
  );
  const [hp, setHp] = useState(s.hpBefore);
  const [hit, setHit] = useState(false);
  const [blown, setBlown] = useState(false);
  const [healed, setHealed] = useState(false);
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
      if (s.damage > 0) emit({ type: "moment", name: "party_hit" });
      return;
    }
    const pose = (p: Pose) => setHero((h) => ({ pose: p, key: h.key + 1 }));
    const timers = recapSchedule(s).map((beat) =>
      setTimeout(() => {
        switch (beat.kind) {
          case "attack":
            setBoss((b) => b && { ...b, mode: "attack" });
            pose("hurt");
            setHit(true);
            break;
          case "blow":
            emit({ type: "moment", name: "party_hit" });
            setBlown(true);
            setHp(Math.max(0, s.hpBefore - s.damage));
            break;
          case "boss_idle":
            setBoss((b) => (b && b.mode === "attack" ? { ...b, mode: "idle" } : b));
            break;
          case "ko":
            pose("ko");
            break;
          case "down":
            setHero((h) => ({ ...h, pose: "down" }));
            break;
          case "escape":
            setBoss((b) => (s.escaped ? { boss: s.escaped, mode: "escape" } : b));
            break;
          case "enter":
            setBoss(s.next ? { boss: s.next, mode: "enter" } : null);
            break;
          case "refill":
            setHp(s.maxHp);
            break;
          case "rise":
            pose("rise");
            break;
          case "stand":
            pose("idle");
            break;
          case "heal":
            setHealed(true);
            setHp(s.hpAfter);
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
    hp: jumped ? final.hp : hp,
    lines: jumped ? final.lines : lines,
    closing: atSummary,
    hero: skipped ? ({ pose: "idle", key: -1 } as const) : hero,
    boss: skipped ? (final.boss ? { boss: final.boss, mode: "idle" as const } : null) : boss,
  };

  const title = s.kind === "perfect" ? "While you were away…" : s.nights > 1 ? "Since you were last here…" : "While you were away…";
  const showArena = s.kind === "blow" && !reduced;

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

        {showArena && (
          <div
            className={`relative overflow-hidden rounded-[2px] border-2 border-stone-edge ${ARENA_CLASS}`}
            style={{ ...ARENA_STYLE, ...sky }}
            suppressHydrationWarning
          >
            <ArenaBackdrop />
            <div
              className={`arena-party absolute inset-x-0 bottom-(--ground) top-0 z-10 ${hit ? "hero-hit" : ""}`}
              style={{ "--impact": `${BOSS_ATTACK_IMPACT_MS}ms` } as React.CSSProperties}
            >
              {/* Rogue flinches, falls and gets up with the hero. */}
              <RogueSprite pose={shown.hero.pose} playKey={shown.hero.key} />
              <FeetSpot x={FEET_X.hero}>
                <AnchoredSprite
                  key={shown.hero.key}
                  animation={HERO_POSES[shown.hero.pose]}
                  height={heroHeight(HERO_POSES[shown.hero.pose])}
                  mirror={needsMirror(HERO_POSES[shown.hero.pose].facing, "right")}
                  alt=""
                />
                {blown && !skipped && (
                  <p className="damage-pop absolute bottom-[calc(var(--arena)*0.62)] left-0 w-max -translate-x-1/2 font-body text-5xl font-black leading-none text-[#ff8787] [text-shadow:3px_3px_0_#12141f,-1px_-1px_0_#12141f]">
                    -{s.damage}
                  </p>
                )}
                {healed && !skipped && s.healed > 0 && (
                  <p className="heal-pop absolute bottom-[calc(var(--arena)*0.72)] left-0 w-max -translate-x-1/2 font-body text-4xl font-black leading-none">
                    +{s.healed}
                  </p>
                )}
              </FeetSpot>
            </div>
            <div className="absolute inset-x-0 bottom-(--ground) top-0 z-10">
              {shown.boss && (
                <RecapBossSprite
                  key={`${shown.boss.boss.id}-${shown.boss.mode === "enter" ? "enter" : "stay"}`}
                  stage={shown.boss}
                />
              )}
            </div>
          </div>
        )}

        <div className="mt-3">
          <HudBar
            label="Party HP"
            icon={<HeartIcon className="h-4 w-4 shrink-0" />}
            current={shown.hp}
            max={s.maxHp}
            segments={10}
            tone="party"
          />
          {!showArena && healed && !skipped && s.healed > 0 && (
            <p className="heal-pop mt-1 text-center font-body text-3xl font-black">+{s.healed}</p>
          )}
        </div>

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

/** The boss in the recap: idle, attacking (lunging), sliding off, or arriving. */
function RecapBossSprite({ stage }: { stage: NonNullable<BossOnStage> }) {
  const anims = bossAnimations(stage.boss.sprite_key);
  if (!anims) return null;
  const anim = stage.mode === "attack" ? anims.attack : stage.mode === "escape" ? anims.escape : anims.idle;
  // Facing the party (left); escaping, it faces the way it runs (right).
  const want = stage.mode === "escape" ? "right" : "left";
  const fx =
    stage.mode === "attack" ? "boss-fx-attack" : stage.mode === "escape" ? "boss-fx-escaped" : "";
  return (
    <FeetSpot x={FEET_X.boss} className={stage.mode === "enter" ? "boss-enter" : ""}>
      <AnchoredSprite
        key={stage.mode}
        animation={anim}
        height={`calc(${bossHeight(stage.boss)} * ${anim.height / anims.idle.height})`}
        mirror={needsMirror(anim.facing, want)}
        alt=""
        className={fx}
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
  missed_quests: 0,
  missed_minutes: 0,
  party_damage: 0,
  boss_id: "dev-slime",
  perfect_days: 0,
  healed: 0,
  streak_before: 0,
  streak_after: 0,
  knocked_out: false,
  escaped_boss_id: null,
  next_boss_id: null,
  hp_before: 100,
  hp_after: 100,
  max_hp: 100,
  ...over,
});
const DEV_RECAPS = {
  blow: [devRow({ missed_quests: 2, missed_minutes: 45, party_damage: 45, hp_after: 55, streak_before: 3 })],
  ko: [
    devRow({
      missed_quests: 3, missed_minutes: 60, party_damage: 60, hp_before: 40, knocked_out: true,
      escaped_boss_id: "dev-slime", next_boss_id: "dev-swarm",
    }),
  ],
  nights: [
    devRow({ day_from: "1999-12-30", day_to: "1999-12-30", missed_quests: 1, missed_minutes: 15, party_damage: 15, hp_after: 85 }),
    devRow({ missed_quests: 1, missed_minutes: 30, party_damage: 30, hp_before: 85, hp_after: 55 }),
    devRow({ perfect_days: 1, healed: 10, hp_before: 55, hp_after: 65 }),
  ],
  text: [devRow({ missed_quests: 1, missed_minutes: 20, boss_id: null })],
  perfect: [devRow({ perfect_days: 1, healed: 10, hp_before: 80, hp_after: 90 })],
};
function devRecap(kind: keyof typeof DEV_RECAPS) {
  const rows = DEV_RECAPS[kind];
  if (!rows) return null;
  const bosses = { "dev-slime": DEV_BOSSES.slime, "dev-swarm": DEV_BOSSES.swarm };
  return summarizeRecaps(rows, bosses, "2000-01-01");
}
