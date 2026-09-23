"use client";

import { useCallback, useEffect, useReducer, useState, useTransition } from "react";
import type { Boss, DailyResetResult, PartyHealth } from "@/lib/supabase/types";
import { useBattle, type BattleEvent } from "@/lib/hooks/use-battle";
import { initialStage, stageReducer } from "@/lib/rpg/boss-stage";
import { BossSprite } from "./boss-sprite";

// Boss battle panel: the active boss's sprite reacting live to game events
// (hurt on damage / missed quests, death or escape, then the next boss), its
// HP bar and the party's. Name, sprite and boss HP follow the boss *on stage*,
// which briefly lags the database while a finished boss plays out.

type Variant = "parent" | "player";

const styles: Record<
  Variant,
  {
    shell: string;
    title: string;
    muted: string;
    track: string;
    badge: string;
    button: string;
    note: string;
    /** Stage box (size included). */
    stage: string;
    /** Layer holding ground + sprite, laid out at full stage size. */
    stageLayer: string;
    ground: string;
    caption: string;
    hpRow: string;
    hpLabel: string;
    hpBar: string;
    spriteHeight: number;
  }
> = {
  parent: {
    shell: "rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5",
    title: "text-lg font-black text-slate-900",
    muted: "text-slate-500",
    track: "bg-slate-100",
    badge: "bg-slate-100 text-slate-600",
    button:
      "rounded-lg bg-slate-900 px-3 py-1.5 text-sm font-bold text-white hover:bg-slate-700 disabled:opacity-60",
    note: "rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700",
    stage: "mb-3 h-[160px] bg-gradient-to-b from-slate-50 to-slate-100 text-slate-400",
    stageLayer: "absolute inset-0",
    ground: "bg-slate-300/70",
    caption: "mb-2 min-h-5 text-sm text-slate-600",
    hpRow: "mt-3",
    hpLabel: "mb-1 text-xs",
    hpBar: "h-3",
    spriteHeight: 120,
  },
  player: {
    // Pinned while Reuben scrolls to his quests: opaque enough to read over
    // the board, and a single compact row on narrow or short screens.
    shell:
      "rounded-2xl border border-white/15 bg-indigo-950/85 p-4 shadow-lg shadow-black/30 backdrop-blur-md sm:p-5 compact:flex compact:items-center compact:gap-3 compact:p-3",
    title: "text-lg font-black text-amber-300 compact:min-w-0 compact:truncate compact:text-base",
    muted: "text-indigo-300",
    track: "bg-black/30",
    badge: "bg-white/10 text-indigo-100 compact:px-1.5 compact:text-[10px]",
    button: "",
    note: "",
    stage:
      "mb-3 h-[190px] bg-gradient-to-b from-indigo-900/40 to-indigo-950/70 text-indigo-300 compact:mb-0 compact:h-24 compact:w-36 compact:shrink-0",
    // Compact: lay the scene out at twice the box size and scale it down by
    // half, so the sprite shrinks with no JS measuring (and no layout jump).
    stageLayer:
      "absolute bottom-0 left-0 h-full w-full compact:h-[200%] compact:w-[200%] compact:origin-bottom-left compact:scale-50",
    ground: "bg-emerald-900/50",
    caption: "mb-2 min-h-5 text-sm text-amber-200 compact:mb-0.5 compact:min-h-4 compact:truncate compact:text-xs",
    hpRow: "mt-3 compact:mt-1",
    hpLabel: "mb-1 text-xs compact:mb-0.5 compact:text-[11px] compact:leading-none",
    hpBar: "h-3 compact:h-2",
    spriteHeight: 150,
  },
};

export function BossStatus({
  variant,
  familyId,
  initialBoss,
  initialParty,
  runReset,
}: {
  variant: Variant;
  familyId: string;
  initialBoss: Boss | null;
  initialParty: PartyHealth | null;
  /** Parent-only testing aid: runs the daily reset for this family now. */
  runReset?: () => Promise<{ ok: true; data: DailyResetResult } | { ok: false; error: string }>;
}) {
  const s = styles[variant];
  const [stage, dispatch] = useReducer(stageReducer, initialBoss, initialStage);
  const onEvent = useCallback((event: BattleEvent) => dispatch(event), []);
  const { boss, party, refetch } = useBattle({ familyId, initialBoss, initialParty, onEvent });
  // The database's active boss (also covers refetches, not just events).
  useEffect(() => {
    dispatch({ type: "active", boss });
  }, [boss]);
  const onHurtDone = useCallback(() => dispatch({ type: "animation-end" }), []);
  const onFinishDone = useCallback(() => dispatch({ type: "swap" }), []);
  const shown = stage.shown;
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  function reset() {
    if (!runReset) return;
    const bossName = shown?.name ?? "The boss";
    setMessage(null);
    startTransition(async () => {
      const result = await runReset();
      setMessage(result.ok ? summarize(result.data, bossName) : result.error);
      // Realtime will deliver the changes too; this covers a slow socket.
      await refetch();
    });
  }

  return (
    <section className={s.shell} aria-label="Boss battle">
      {/* Stage: sprite stands on the ground line at the bottom. */}
      <div className={`relative overflow-hidden rounded-xl ${s.stage}`}>
        <div className={s.stageLayer}>
          {/* Ground first, at z-0, so it never paints over the boss's feet. */}
          <div aria-hidden className={`absolute inset-x-0 bottom-0 z-0 h-3 ${s.ground}`} />
          {shown ? (
            <div key={shown.id} className="boss-enter absolute inset-x-0 bottom-3 top-0 z-10">
              <BossSprite
                spriteKey={shown.sprite_key}
                name={shown.name}
                mode={stage.mode}
                playKey={stage.playKey}
                height={s.spriteHeight}
                onHurtDone={onHurtDone}
                onFinishDone={onFinishDone}
              />
            </div>
          ) : (
            <p className="flex h-full items-center justify-center text-sm font-semibold">
              All quiet — no boss to fight.
            </p>
          )}
        </div>
      </div>

      <div className="min-w-0 flex-1">
        <p aria-live="polite" className={`font-semibold ${s.caption}`}>
          {stage.caption ??
            // Compact rows show the name right below; skip the idle echo.
            (shown ? <span className="compact:hidden">{shown.name} is waiting…</span> : "")}
        </p>

        {shown ? (
          <>
            <div className="flex items-baseline justify-between gap-2">
              <h2 className={s.title}>{shown.name}</h2>
              <span
                className={`shrink-0 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold uppercase ${s.badge}`}
              >
                {shown.tier === "epic" ? "Epic boss" : shown.tier === "mid" ? "Boss" : "Minion"}
              </span>
            </div>
            <HpBar
              label="Boss HP"
              current={shown.current_hp}
              max={shown.max_hp}
              fill="bg-gradient-to-r from-rose-600 to-orange-500"
              styles={s}
            />
          </>
        ) : (
          <p className={`text-sm ${s.muted}`}>No boss right now — all quests conquered!</p>
        )}

        {party && (
          <HpBar
            label="Party HP"
            current={party.current_hp}
            max={party.max_hp}
            fill="bg-gradient-to-r from-emerald-500 to-lime-400"
            styles={s}
          />
        )}

        {runReset && (
          <div className="mt-4 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" onClick={reset} disabled={pending} className={s.button}>
                {pending ? "Running…" : "Run daily reset now"}
              </button>
              <span className={`text-xs ${s.muted}`}>
                Testing aid — the same reset runs automatically every night.
              </span>
            </div>
            {message && (
              <p role="status" className={s.note}>
                {message}
              </p>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

function HpBar({
  label,
  current,
  max,
  fill,
  styles: s,
}: {
  label: string;
  current: number;
  max: number;
  fill: string;
  styles: (typeof styles)[Variant];
}) {
  const pct = max > 0 ? Math.max(0, Math.min(100, (current / max) * 100)) : 0;
  return (
    <div className={s.hpRow}>
      <div className={`flex justify-between font-semibold ${s.hpLabel} ${s.muted}`}>
        <span>{label}</span>
        <span>
          {current} / {max}
        </span>
      </div>
      <div
        className={`overflow-hidden rounded-full ${s.hpBar} ${s.track}`}
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={max}
        aria-valuenow={current}
      >
        <div className={`h-full rounded-full transition-all duration-700 ${fill}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function summarize(r: DailyResetResult, bossName: string) {
  // Completed quests damage the boss instantly; the nightly run only
  // handles misses, escapes and anything left over.
  const parts: string[] = [];
  if (r.missed_minutes) {
    parts.push(
      r.party_damage
        ? `${r.missed_minutes} missed minutes (party −${r.party_damage})`
        : `${r.missed_minutes} missed minutes`,
    );
  } else {
    parts.push("No missed quests");
  }
  if (r.defeated) {
    const gold = r.gold_awarded.reduce((sum, g) => sum + g.gold, 0);
    parts.push(`${bossName} defeated! +${gold} gold`);
  }
  if (r.escaped) parts.push(`${bossName} escaped — party healed`);
  if (r.activated) parts.push("a new boss appears");
  return `${parts.join(" · ")}.`;
}
