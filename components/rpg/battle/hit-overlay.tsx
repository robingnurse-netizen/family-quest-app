"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { Boss } from "@/lib/supabase/types";
import type { OverlayMoment } from "@/lib/rpg/battle-events";
import { createNoRepeatPicker, uuidV4 } from "@/lib/random";
import {
  HIT_TIERS,
  ROGUE_POUNCE_CONTACT,
  STRIKE_VARIANTS,
  contactAnimation,
  hitTier,
  strikeMotion,
  type HitTier,
} from "@/lib/rpg/strike";
import { SPRITES } from "@/components/rpg/sprites/manifests";
import { AnchoredSprite, needsMirror } from "@/components/rpg/sprites/anchored-sprite";
import { bossAnimations } from "@/components/rpg/sprites/boss-animations";
import type { SpriteAnimation } from "@/components/rpg/sprites/types";
import { preloadFrames } from "@/components/rpg/sprites/frame-cache";
import { CoinIcon } from "@/components/ui/icons";
import { registerDevTools, useBattleContext, useBattleEvents } from "./battle-provider";
import {
  ARENA_CLASS,
  ARENA_STYLE,
  ARENA_VARS,
  FEET_X,
  FeetSpot,
  STRIKE_X,
  arenaHeight,
  bossHeight,
  heroHeight,
  impactPoint,
  rogueHeight,
  useDevicePixelStep,
} from "./stage-layout";

// The centre-screen hit overlay: when Reuben's own quest strikes the boss, a
// short, loud replay of the hit plays in the middle of whatever he's looking
// at — hero and Rogue dash in, impact, damage number — then they fly back up
// to the battle scene. More hits while it's playing extend it into a combo;
// a final blow plays K.O. → victory (his gold) → the next foe.
//
// It only listens to the battle event stream (useBattleEvents) and emits its
// beats back into it as "moment" events (impact, combo, ko, victory, coin) for
// sound effects. Positions come from ./stage-layout, same as the scene.
//
// Each hit varies (lib/rpg/strike.ts): the hero's swing is one of his three
// attacks (chop, thrust, slash — never the same twice running), and the
// impact's weight — hit-stop, shake, burst, debris, flash — scales in tiers
// with the quest's minutes. Neither moves the show's beats. After a final
// blow's K.O. he plays his victory pose and holds it through the victory
// card (the fanfare and his gold).

/**
 * Every duration in the show, in ms — tune here. A normal hit runs
 * dash + hitStop + hold + fly ≈ 2.5s; a final blow runs
 * dash + hitStop + koDelay + ko + victory + teaser + out ≈ 5.3s. Reduced
 * motion uses the same phases (no dash), as fading cards.
 */
export const OVERLAY_TIMING = {
  /** First hit only: the party dashes in from the left. */
  dash: 280,
  /** Hit-stop: everything freezes on the frame of impact. The medium tier's
   *  pause; each hit's own freeze comes from its tier (HIT_TIERS), but the
   *  beats after impact (and their sounds) are timed from this one. */
  hitStop: 150,
  /** Damage number on screen after the hit-stop, before flying back. More
   *  hits during hold + fly merge into the combo. */
  hold: 1300,
  /** Shrinking and flying back up to the battle scene, fading out. */
  fly: 800,
  /** Final blow: after the hit-stop, before the K.O. slam. */
  koDelay: 650,
  ko: 700,
  /** Victory card + coin shower (the gold moment). */
  victory: 2300,
  /** The hero's victory pose starts once the K.O. slam has landed
   *  (.ko-slam, 380ms) and holds its last frame until the teaser. */
  heroVictory: 380,
  teaser: 950,
  /** Final fade of the whole layer. */
  out: 300,
  /** A defeat / gold / next boss seen this recently still belongs to the hit. */
  recent: 3000,
} as const;
const T = OVERLAY_TIMING;

type Phase = "hit" | "fly" | "ko" | "victory" | "teaser" | "out";

type Show = {
  boss: Boss;
  hits: number;
  total: number;
  /** Bumped on every hit: replays the impact. */
  impactKey: number;
  /** The current hit has landed (the impact effects are showing). */
  struck: boolean;
  /** Hit-stop: sprites hold their frame of impact. */
  frozen: boolean;
  /** The current hit's swing (index into STRIKE_VARIANTS) and weight. */
  variant: number;
  tier: HitTier;
  phase: Phase;
  defeated: boolean;
  /** Reuben's share of the gold, once it arrives. */
  gold: number | null;
  /** The boss that took over (undefined: not known yet; null: none left). */
  next: Boss | null | undefined;
};

type Recent = { bossId: string; at: number };

/** Gold per tier when one child dealt all the damage (dev final blow). */
const SOLO_GOLD: Record<Boss["tier"], number> = { low: 25, mid: 50, epic: 100 };

export function HitOverlay({ childId }: { childId: string }) {
  const { boss: active, stage, emit, setOverlayActive } = useBattleContext();
  const reduced = usePrefersReducedMotion();
  const [show, setShow] = useState<Show | null>(null);
  const layerRef = useRef<HTMLDivElement>(null);
  useDevicePixelStep();
  // The hero's swing: random, never the same one twice running.
  const [pickVariant] = useState(() => createNoRepeatPicker(STRIKE_VARIANTS.length));

  // Latest bosses for the event listener (which is stable).
  const bosses = useRef({ shown: stage.shown, active });
  useEffect(() => {
    bosses.current = { shown: stage.shown, active };
  }, [stage.shown, active]);

  // Realtime can deliver the defeat / gold / next boss before the damage row
  // (they're different tables), so remember the latest of each briefly.
  const recent = useRef<{ defeated?: Recent; gold?: Recent & { amount: number }; next?: Recent & { boss: Boss } }>({});
  const isRecent = (r: Recent | undefined, bossId: string) =>
    r !== undefined && r.bossId === bossId && Date.now() - r.at < T.recent;

  useBattleEvents((event) => {
    const now = Date.now();
    switch (event.type) {
      case "damage": {
        if (event.childId !== childId) return; // someone else's hit: scene only
        const { shown, active: act } = bosses.current;
        const boss = [shown, act].find((b) => b?.id === event.bossId) ?? shown ?? act;
        if (!boss) return;
        const strike = { variant: pickVariant(), tier: hitTier(event.amount) };
        // Same batch as the scene's caption update, so it's muted in time.
        setOverlayActive(true);
        setShow((s) => {
          if (!s) {
            const r = recent.current;
            return {
              boss,
              hits: 1,
              total: event.amount,
              impactKey: 1,
              struck: false,
              frozen: false,
              ...strike,
              phase: "hit",
              defeated: isRecent(r.defeated, boss.id),
              gold: r.gold && isRecent(r.gold, boss.id) ? r.gold.amount : null,
              next: r.next && isRecent(r.next, boss.id) ? r.next.boss : undefined,
            };
          }
          if (s.phase !== "hit" && s.phase !== "fly") return s; // K.O. already showing
          return {
            ...s,
            ...strike,
            hits: s.hits + 1,
            total: s.total + event.amount,
            impactKey: s.impactKey + 1,
            phase: "hit",
          };
        });
        return;
      }
      case "defeated":
        recent.current.defeated = { bossId: event.boss.id, at: now };
        setShow((s) => (s && s.boss.id === event.boss.id ? { ...s, defeated: true } : s));
        return;
      case "gold":
        if (event.childId !== childId) return;
        recent.current.gold = { bossId: event.bossId, at: now, amount: event.amount };
        setShow((s) => (s && s.boss.id === event.bossId ? { ...s, gold: event.amount } : s));
        return;
      case "activated": {
        const finished = recent.current.defeated?.bossId ?? "";
        recent.current.next = { bossId: finished, at: now, boss: event.boss };
        setShow((s) => (s && s.boss.id !== event.boss.id ? { ...s, next: event.boss } : s));
        return;
      }
    }
  });

  const moment = useCallback(
    (name: OverlayMoment, s: Pick<Show, "hits" | "total">) =>
      emit({ type: "moment", name, combo: s.hits, damage: s.total }),
    [emit],
  );

  const shake = useCallback(
    (strength: number) => {
      if (reduced) return;
      const k = strength;
      layerRef.current?.animate(
        [
          { transform: "translate(0, 0)" },
          { transform: `translate(${-k}px, ${k / 2}px)` },
          { transform: `translate(${k}px, ${-k / 2}px)` },
          { transform: `translate(${-k / 2}px, ${k / 3}px)` },
          { transform: `translate(${k / 3}px, 0)` },
          { transform: "translate(0, 0)" },
        ],
        { duration: 320, easing: "ease-out" },
      );
    },
    [reduced],
  );

  // The show's timeline: each phase schedules the next.
  const phase = show?.phase;
  const impactKey = show?.impactKey ?? 0;
  const hits = show?.hits ?? 0;
  const total = show?.total ?? 0;
  const tier = show?.tier ?? "medium";
  useEffect(() => {
    if (!phase) return;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const at = (ms: number, fn: () => void) => timers.push(setTimeout(fn, ms));
    const counts = { hits, total };
    const end = () => {
      setShow(null);
      setOverlayActive(false);
    };
    switch (phase) {
      case "hit": {
        // Only the first hit dashes in; combo hits land straight away.
        const delay = impactKey === 1 && !reduced ? T.dash : 0;
        // The freeze is the tier's; the beats after it keep T.hitStop.
        const freeze = reduced ? 0 : HIT_TIERS[tier].hitStopMs;
        const hitStop = reduced ? 0 : T.hitStop;
        at(delay, () => {
          // Contact: freeze on the frame of impact (sound goes here too).
          setShow((s) => s && { ...s, struck: true, frozen: true });
          moment("impact", counts);
          if (counts.hits > 1) moment("combo", counts);
        });
        at(delay + freeze, () => {
          // Unfreeze: the burst, number and shake play out.
          setShow((s) => s && { ...s, frozen: false });
          shake(HIT_TIERS[tier].shake + (counts.hits > 1 ? 3 : 0));
        });
        at(delay + hitStop + T.koDelay, () => setShow((s) => (s?.defeated ? { ...s, phase: "ko" } : s)));
        at(delay + hitStop + T.hold, () => setShow((s) => s && { ...s, phase: s.defeated ? "ko" : "fly" }));
        break;
      }
      case "fly":
        at(T.fly, end);
        break;
      case "ko":
        moment("ko", counts);
        shake(16);
        at(T.ko, () => setShow((s) => s && { ...s, phase: "victory" }));
        break;
      case "victory":
        moment("victory", counts);
        moment("coin", counts);
        at(T.victory, () => setShow((s) => s && { ...s, phase: "teaser" }));
        break;
      case "teaser":
        at(T.teaser, () => setShow((s) => s && { ...s, phase: "out" }));
        break;
      case "out":
        at(T.out, end);
        break;
    }
    return () => timers.forEach(clearTimeout);
  }, [phase, impactKey, hits, total, tier, reduced, moment, shake, setOverlayActive]);

  // Preload what the overlay draws, so the first hit doesn't stutter.
  useEffect(() => {
    const hero = SPRITES.hero.animations;
    const rogue = SPRITES.rogue.animations;
    preload([...STRIKE_VARIANTS.map((v) => hero[v.animation]), hero.victory, rogue.pounce, rogue.bark]);
  }, []);
  const shownKey = stage.shown?.sprite_key;
  useEffect(() => {
    const anims = shownKey ? bossAnimations(shownKey) : null;
    if (anims) preload([anims.idle, anims.hurt]);
  }, [shownKey]);
  const nextKey = show?.next?.sprite_key;
  useEffect(() => {
    const anims = nextKey ? bossAnimations(nextKey) : null;
    if (anims) preload([anims.idle]);
  }, [nextKey]);

  // Development only: trigger the overlay from the console (see CLAUDE.md).
  const bossesForDev = useRef({ shown: stage.shown, active });
  useEffect(() => {
    bossesForDev.current = { shown: stage.shown, active };
  }, [stage.shown, active]);
  useEffect(() => {
    if (process.env.NODE_ENV !== "development") return;
    const tools = () => (window as unknown as { __fqBattle: { setBoss: (b: Boss | null) => void } }).__fqBattle;
    const current = () => bossesForDev.current.active ?? bossesForDev.current.shown;
    const strike = (amount: number, by: string | null = childId) => {
      const boss = current();
      if (!boss) return;
      emit({ type: "damage", bossId: boss.id, amount, childId: by, slotId: null, at: new Date().toISOString() });
      tools().setBoss({ ...boss, current_hp: Math.max(0, boss.current_hp - amount) });
    };
    return registerDevTools({
      hit: (amount = 15) => strike(amount),
      combo: (count = 3, amount = 10) => {
        for (let i = 0; i < count; i++) setTimeout(() => strike(amount), i * 400);
      },
      otherHit: (amount = 15) => strike(amount, "someone-else"),
      finalBlow: () => {
        const boss = current();
        if (!boss) return;
        strike(boss.current_hp);
        const next = devNextBoss(boss);
        setTimeout(() => {
          emit({ type: "gold", bossId: boss.id, childId, amount: SOLO_GOLD[boss.tier] });
          emit({ type: "defeated", boss: { ...boss, current_hp: 0, status: "defeated" } });
          tools().setBoss(next);
          emit({ type: "activated", boss: next });
        }, 50);
      },
    });
  }, [emit, childId]);

  const announcement = !show
    ? ""
    : show.phase === "teaser" || show.phase === "out"
      ? show.next
        ? `A new foe approaches: ${show.next.name}!`
        : "Every boss conquered!"
      : show.phase === "ko" || show.phase === "victory"
      ? `K.O.! ${show.boss.name} is defeated!${show.gold !== null ? ` You earned ${show.gold} gold.` : ""}`
      : show.hits > 1
        ? `Combo x${show.hits}! ${show.total} damage.`
        : `Hit! ${show.total} damage.`;

  return (
    <>
      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>
      {show && (
        <div
          aria-hidden
          className={`pointer-events-none fixed inset-0 z-50 flex items-center justify-center overflow-hidden ${
            show.phase === "out" ? "overlay-out" : ""
          }`}
          style={{ animationDuration: `${T.out}ms` }}
        >
          <div
            className={`overlay-vignette absolute inset-0 ${show.phase === "fly" ? "overlay-vignette-out" : ""}`}
            style={show.phase === "fly" ? { animationDuration: `${T.fly}ms` } : undefined}
          />
          {/* A brief white flash on contact, for medium and heavy hits. */}
          {!reduced && show.struck && show.phase === "hit" && HIT_TIERS[show.tier].flash > 0 && (
            <div
              key={`flash-${show.impactKey}`}
              className="impact-flash absolute inset-0 bg-white"
              style={{ "--flash": HIT_TIERS[show.tier].flash } as React.CSSProperties}
            />
          )}
          <div ref={layerRef} className="relative w-[min(calc(100vw-1rem),768px)] [container-type:inline-size]">
            {reduced ? <ReducedCard show={show} /> : <Theatre show={show} />}
          </div>
          {!reduced && show.phase === "victory" && <CoinShower />}
        </div>
      )}
    </>
  );
}

/** The full-motion show for the current phase. */
function Theatre({ show }: { show: Show }) {
  if (show.phase === "hit" || show.phase === "fly") return <Strike show={show} />;
  if (show.phase === "ko" || show.phase === "victory")
    return (
      // One tree for both phases (keyed children), so the hero's victory
      // pose carries on from the K.O. into the victory card, holding its
      // last frame.
      <div className={`flex flex-col items-center ${ARENA_CLASS}`} style={ARENA_VARS}>
        {show.phase === "ko" ? (
          <p key="ko" className="ko-slam text-center font-display text-7xl font-semibold text-gold sm:text-8xl">
            K.O.!
          </p>
        ) : (
          <VictoryCard key="card" show={show} />
        )}
        <HeroVictory key="hero" />
      </div>
    );
  return <Teaser next={show.next} />;
}

/** The hero cheering under the K.O. / victory card, Rogue barking behind him:
 *  both start after the slam. */
function HeroVictory() {
  const victory = SPRITES.hero.animations.victory;
  const rogue = SPRITES.rogue.animations;
  const [started, setStarted] = useState(false);
  // One bark, then back to breathing.
  const [barked, setBarked] = useState(false);
  const rogueAnim = barked ? rogue.idle : rogue.bark;
  useEffect(() => {
    const t = setTimeout(() => setStarted(true), T.heroVictory);
    return () => clearTimeout(t);
  }, []);
  return (
    <div className="relative mt-2 h-[calc(var(--arena)*0.66)] w-full">
      <div className="overlay-ground absolute inset-x-[30%] bottom-[-3%] h-[6%] rounded-[50%]" />
      <FeetSpot x="calc(50% - var(--arena) * 0.3)">
        <AnchoredSprite
          key={barked ? "idle" : "bark"}
          animation={rogueAnim}
          height={rogueHeight(rogueAnim)}
          mirror={needsMirror(rogueAnim.facing, "right")}
          paused={!started}
          onComplete={barked ? undefined : () => setBarked(true)}
          alt=""
        />
      </FeetSpot>
      <FeetSpot x="50%">
        {/* Paused shows frame 1 (standing) until the slam lands. */}
        <AnchoredSprite animation={victory} height={heroHeight(victory)} paused={!started} alt="" />
      </FeetSpot>
    </div>
  );
}

/** Hero and Rogue dash in and strike; the boss flinches; impact effects. */
function Strike({ show }: { show: Show }) {
  const { boss, struck, frozen, impactKey, phase, tier } = show;
  const weight = HIT_TIERS[tier];
  const anims = bossAnimations(boss.sprite_key);
  const bossAnim = anims ? (struck ? anims.hurt : anims.idle) : null;
  const impact = impactPoint(boss);
  return (
    <div className={`relative ${ARENA_CLASS}`} style={ARENA_STYLE}>
      <div
        className={`absolute inset-x-0 bottom-(--ground) top-0 ${phase === "fly" ? "overlay-fly" : ""}`}
        style={phase === "fly" ? { animationDuration: `${T.fly}ms` } : undefined}
      >
        <div className="overlay-dash absolute inset-0">
          <FeetSpot x={STRIKE_X.rogue}>
            <RoguePounce
              key={`rogue-${impactKey}`}
              // Same lead as the hero: his paws land with the swing.
              leadMs={impactKey === 1 ? T.dash : 0}
              frozen={frozen}
            />
          </FeetSpot>
          <FeetSpot x={STRIKE_X.hero}>
            <HeroStrike
              key={`hero-${impactKey}`}
              variant={show.variant}
              // Same lead as the timeline: the dash for a first hit, none for a combo hit.
              leadMs={impactKey === 1 ? T.dash : 0}
              hitStopMs={weight.hitStopMs}
              frozen={frozen}
            />
          </FeetSpot>
        </div>

        <FeetSpot x={FEET_X.boss} className="overlay-boss-in">
          {anims && bossAnim && (
            <AnchoredSprite
              key={`boss-${impactKey}-${struck}`}
              animation={bossAnim}
              height={`calc(${bossHeight(boss)} * ${bossAnim.height / anims.idle.height})`}
              mirror={needsMirror(bossAnim.facing, "left")}
              frozen={frozen}
              alt=""
            />
          )}
        </FeetSpot>

        {struck && (
          <div
            key={impactKey}
            className="absolute z-20 h-0 w-0"
            // The burst etc. hold their first frame through the hit-stop.
            style={{ left: impact.x, bottom: arenaHeight(impact.y), "--hitstop": `${weight.hitStopMs}ms` } as React.CSSProperties}
          >
            <Impact tier={tier} />
            <div className="absolute bottom-[calc(var(--arena)*0.22)] left-0 w-max -translate-x-1/2 text-center">
              {show.hits > 1 && (
                <p className="combo-pop font-display text-2xl font-semibold uppercase text-parchment text-shadow-pixel sm:text-3xl">
                  Combo x{show.hits}
                </p>
              )}
              {/* Numbers in the body font: Pixelify's 5 reads as an S, even this big. */}
              <p className="damage-pop font-body text-6xl font-black leading-none text-gold [text-shadow:3px_3px_0_#12141f,-1px_-1px_0_#12141f] sm:text-7xl">
                -{show.total}
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * The hero's swing for one hit: one of his attacks, timed so its contact
 * frame is on screen at impact, plus its body motion (a lunge or a leap) on
 * the first hit. Stands on his manifest anchor like any sprite.
 */
function HeroStrike({
  variant,
  leadMs,
  hitStopMs,
  frozen,
}: {
  variant: number;
  leadMs: number;
  hitStopMs: number;
  frozen: boolean;
}) {
  const v = STRIKE_VARIANTS[variant];
  const attack = SPRITES.hero.animations[v.animation];
  const animation = useMemo(() => contactAnimation(attack, v.contact, leadMs), [attack, v.contact, leadMs]);
  const ref = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  // Mount only (the component is keyed per hit): the motion lands on contact.
  useLayoutEffect(() => {
    const el = ref.current;
    const motion = el && strikeMotion(v.motion, leadMs, hitStopMs, el.offsetHeight);
    if (!el || !motion) return;
    const timing = { duration: motion.duration, fill: "none" } as const;
    const run = bodyRef.current?.animate(motion.keyframes, timing);
    return () => run?.cancel();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    // Same box as the feet spot, so the sprite stands exactly where it would.
    <div ref={ref} className="absolute inset-0">
      <AnchoredSprite
        animation={animation}
        height={heroHeight(animation)}
        mirror={needsMirror(animation.facing, "right")}
        frozen={frozen}
        bodyRef={bodyRef}
        alt=""
      />
    </div>
  );
}

/** Rogue's pounce for one hit, timed so his paws (contact frame) land at impact. */
function RoguePounce({ leadMs, frozen }: { leadMs: number; frozen: boolean }) {
  const pounce = SPRITES.rogue.animations.pounce;
  const animation = useMemo(() => contactAnimation(pounce, ROGUE_POUNCE_CONTACT, leadMs), [pounce, leadMs]);
  return (
    <AnchoredSprite
      animation={animation}
      height={rogueHeight(animation)}
      mirror={needsMirror(animation.facing, "right")}
      frozen={frozen}
      alt=""
    />
  );
}

/** Starburst, slash streak and debris, centred on the impact point, sized by the hit's tier. */
function Impact({ tier }: { tier: HitTier }) {
  const { burstScale, debris, debrisSpread } = HIT_TIERS[tier];
  return (
    <>
      <div
        className="absolute left-0 top-0 h-[calc(var(--arena)*0.55)] w-[calc(var(--arena)*0.55)] -translate-x-1/2 -translate-y-1/2"
        style={{ scale: burstScale }}
      >
        <PixelBurst className="impact-burst h-full w-full" />
      </div>
      <div className="impact-slash absolute left-[calc(var(--arena)*-0.45)] top-[-4px] h-2 w-[calc(var(--arena)*0.9)] rounded-[2px]" />
      {DEBRIS.slice(0, debris).map(([dx, dy, rot, size, color], i) => (
        <span
          key={i}
          className="impact-debris absolute"
          style={
            {
              left: -size / 2,
              top: -size / 2,
              width: size,
              height: size,
              background: color,
              "--dx": `${dx * debrisSpread}cqw`,
              "--dy": `${dy * debrisSpread}cqw`,
              "--rot": `${rot}deg`,
            } as React.CSSProperties
          }
        />
      ))}
    </>
  );
}

/** Debris chunks: [dx, dy (cqw), spin (deg), size (px), colour]. */
const DEBRIS: [number, number, number, number, string][] = [
  [9, -12, 200, 8, "#f1e2c0"],
  [14, -4, -160, 6, "#fcc419"],
  [11, 7, 120, 7, "#f59f00"],
  [-4, -14, -220, 6, "#fff"],
  [16, -9, 260, 5, "#e03131"],
  [5, 10, -140, 6, "#f1e2c0"],
];

/** A pixel starburst on a 24×24 grid (crisp edges, no image download). */
function PixelBurst({ className }: { className?: string }) {
  const rays: [number, number, number, number, string][] = [
    [11, 0, 2, 24, "#fff3bf"],
    [0, 11, 24, 2, "#fff3bf"],
    [9, 3, 6, 18, "#fcc419"],
    [3, 9, 18, 6, "#fcc419"],
    [10, 10, 4, 4, "#fff"],
  ];
  const diag: [number, number][] = [
    [3, 3], [5, 5], [19, 3], [17, 5], [3, 19], [5, 17], [19, 19], [17, 17],
  ];
  return (
    <svg viewBox="0 0 24 24" shapeRendering="crispEdges" className={className}>
      {diag.map(([x, y]) => (
        <rect key={`${x},${y}`} x={x} y={y} width={2} height={2} fill="#f59f00" />
      ))}
      {rays.map(([x, y, w, h, fill]) => (
        <rect key={`${x},${y},${w}`} x={x} y={y} width={w} height={h} fill={fill} />
      ))}
    </svg>
  );
}

function VictoryCard({ show }: { show: Show }) {
  return (
    <div className="victory-pop panel panel-stone mx-auto w-fit max-w-[92%] px-6 py-5 text-center">
      <p className="font-display text-4xl font-semibold text-gold text-shadow-pixel sm:text-5xl">Victory!</p>
      <p className="mt-1 font-bold text-parchment">{show.boss.name} is defeated!</p>
      {show.gold !== null && (
        <p className="mt-3 flex items-center justify-center gap-2 text-4xl font-black text-gold text-shadow-pixel">
          <CoinIcon className="h-10 w-10" />+{show.gold}
          <span className="font-display text-2xl font-semibold">gold</span>
        </p>
      )}
    </div>
  );
}

function Teaser({ next }: { next: Boss | null | undefined }) {
  const anims = next ? bossAnimations(next.sprite_key) : null;
  return (
    <div className="victory-pop panel panel-stone mx-auto w-fit max-w-[92%] px-6 py-4 text-center">
      {next ? (
        <>
          {anims && (
            <div className="relative mx-auto h-28 w-40">
              <AnchoredSprite
                animation={anims.idle}
                height={`min(104px, ${(150 / (anims.idle.width / anims.idle.height)).toFixed(1)}px)`}
                mirror={needsMirror(anims.idle.facing, "left")}
                alt=""
                className="teaser-silhouette"
              />
            </div>
          )}
          <p className="mt-2 font-display text-xl font-semibold text-parchment text-shadow-pixel">
            A new foe approaches…
          </p>
        </>
      ) : (
        <p className="font-display text-xl font-semibold text-gold text-shadow-pixel">Every boss conquered!</p>
      )}
    </div>
  );
}

/** Pixel coins raining down the screen during the victory card. */
function CoinShower() {
  return (
    <div className="absolute inset-0 overflow-hidden">
      {/* Waves of coins spread across the victory card's time on screen. */}
      {Array.from({ length: 28 }, (_, i) => (
        <CoinIcon
          key={i}
          className="coin-fall absolute top-[-8%] h-8 w-8"
          style={
            {
              left: `${(i * 37 + 7) % 96}%`,
              // Scattered start times and speeds, so they don't fall in rows.
              animationDelay: `${Math.round((((i * 113) % 97) / 97) * (T.victory - 1600))}ms`,
              animationDuration: `${1150 + ((i * 53) % 5) * 110}ms`,
              "--spin": `${i % 2 ? 540 : -540}deg`,
            } as React.CSSProperties
          }
        />
      ))}
    </div>
  );
}

/** Reduced motion: no dash, shake or flying — a card that fades in and out. */
function ReducedCard({ show }: { show: Show }) {
  const ko = show.phase === "ko" || show.phase === "victory";
  return (
    <div
      className={`reduced-card panel panel-stone mx-auto w-fit max-w-[92%] px-6 py-5 text-center ${
        show.phase === "fly" ? "reduced-card-out" : ""
      }`}
      style={show.phase === "fly" ? { animationDuration: `${T.fly}ms` } : undefined}
    >
      {show.phase === "teaser" || show.phase === "out" ? (
        <p className="font-display text-xl font-semibold text-parchment">
          {show.next ? "A new foe approaches…" : "Every boss conquered!"}
        </p>
      ) : ko ? (
        <>
          <p className="font-display text-4xl font-semibold text-gold text-shadow-pixel">K.O.! Victory!</p>
          {show.gold !== null && (
            <p className="mt-2 flex items-center justify-center gap-2 text-3xl font-black text-gold">
              <CoinIcon className="h-8 w-8" />+{show.gold}
              <span className="font-display text-2xl font-semibold">gold</span>
            </p>
          )}
        </>
      ) : (
        <>
          <p className="font-display text-2xl font-semibold uppercase text-parchment">
            {show.hits > 1 ? `Combo x${show.hits}` : "Hit!"}
          </p>
          <p className="text-6xl font-black leading-none text-gold text-shadow-pixel">-{show.total}</p>
        </>
      )}
    </div>
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

/** Load what the overlay draws ahead of time — once, into the frame cache. */
function preload(animations: SpriteAnimation[]) {
  for (const animation of animations) preloadFrames(animation.frames);
}

/** Development only: the boss after `boss` in the roster, for finalBlow(). */
const DEV_ROSTER: [string, string, Boss["tier"]][] = [
  ["trash_bag_slime", "Trash-Bag Slime", "low"],
  ["alarm_clock_swarm", "Alarm Clock Swarm", "low"],
  ["laundry_goblin", "Laundry Goblin", "low"],
  ["cable_spider", "Cable Spider", "low"],
  ["swamp_bag_ooze", "Swamp-Bag Ooze", "mid"],
  ["tupperware_troll", "Tupperware Troll", "mid"],
  ["mud_track_minotaur", "Mud-Track Minotaur", "mid"],
  ["magma_behemoth", "Magma Behemoth", "epic"],
  ["chronosphinx", "Chronosphinx", "epic"],
  ["abyssal_kraken", "Abyssal Kraken", "epic"],
  ["shogun_bot", "Shogun-Bot", "epic"],
];
function devNextBoss(boss: Boss): Boss {
  const i = DEV_ROSTER.findIndex(([key]) => key === boss.sprite_key);
  const [sprite_key, name, tier] = DEV_ROSTER[(i + 1) % DEV_ROSTER.length];
  return {
    ...boss,
    id: uuidV4(),
    name,
    tier,
    sprite_key,
    max_hp: tier === "epic" ? 300 : 60,
    current_hp: tier === "epic" ? 300 : 60,
    status: "active",
  };
}
