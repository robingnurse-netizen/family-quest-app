"use client";

import { useState, useTransition } from "react";
import type { Boss, DailyResetResult, PartyHealth } from "@/lib/supabase/types";
import { BattleProvider, useBattleContext } from "@/components/rpg/battle/battle-provider";
import { BossSprite } from "./boss-sprite";

// Parent HQ's boss battle panel: the active boss's sprite reacting live to
// game events (hurt on damage, attacking on missed quests, death or escape,
// then the next boss), its HP bar and the party's. Name, sprite and boss HP
// follow the boss *on stage*, which briefly lags the database while a
// finished boss plays out. (Reuben's dashboard has the battle scene instead:
// components/rpg/battle/.)

const s = {
  shell: "rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5",
  title: "text-lg font-black text-slate-900",
  muted: "text-slate-500",
  track: "bg-slate-100",
  badge: "rounded-full px-2 py-0.5 text-xs font-semibold uppercase bg-slate-100 text-slate-600",
  button:
    "rounded-lg bg-slate-900 px-3 py-1.5 text-sm font-bold text-white hover:bg-slate-700 disabled:opacity-60",
  note: "rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700",
  stage: "mb-3 h-[160px] rounded-xl bg-gradient-to-b from-slate-50 to-slate-100 text-slate-400",
  ground: "bg-slate-300/70",
  caption: "mb-2 min-h-5 text-sm text-slate-600",
  hpRow: "mt-3",
  hpLabel: "mb-1 text-xs",
  hpBar: "h-3",
  bossFill: "bg-gradient-to-r from-rose-600 to-orange-500",
  partyFill: "bg-gradient-to-r from-emerald-500 to-lime-400",
  spriteHeight: 120,
};

type RunReset = () => Promise<{ ok: true; data: DailyResetResult } | { ok: false; error: string }>;

export function BossStatus({
  familyId,
  initialBoss,
  initialParty,
  runReset,
}: {
  familyId: string;
  initialBoss: Boss | null;
  initialParty: PartyHealth | null;
  /** Testing aid: runs the daily reset for this family now. */
  runReset?: RunReset;
}) {
  return (
    <BattleProvider familyId={familyId} initialBoss={initialBoss} initialParty={initialParty}>
      <BossPanel runReset={runReset} />
    </BattleProvider>
  );
}

function BossPanel({ runReset }: { runReset?: RunReset }) {
  const { party, stage, onBossAnimationEnd, onBossFinished, refetch } = useBattleContext();
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
      <div className={`relative overflow-hidden ${s.stage}`}>
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
              onReactionDone={onBossAnimationEnd}
              onFinishDone={onBossFinished}
            />
          </div>
        ) : (
          <p className="flex h-full items-center justify-center text-sm font-semibold">
            All quiet — no boss to fight.
          </p>
        )}
      </div>

      <div className="min-w-0 flex-1">
        <p aria-live="polite" className={`font-semibold ${s.caption}`}>
          {stage.caption ?? (shown ? `${shown.name} is waiting…` : "")}
        </p>

        {shown ? (
          <>
            <div className="flex items-baseline justify-between gap-2">
              <h2 className={s.title}>{shown.name}</h2>
              <span className={`shrink-0 whitespace-nowrap ${s.badge}`}>
                {shown.tier === "epic" ? "Epic boss" : shown.tier === "mid" ? "Boss" : "Minion"}
              </span>
            </div>
            <HpBar label="Boss HP" current={shown.current_hp} max={shown.max_hp} fill={s.bossFill} />
          </>
        ) : (
          <p className={`text-sm ${s.muted}`}>No boss right now — all quests conquered!</p>
        )}

        {party && <HpBar label="Party HP" current={party.current_hp} max={party.max_hp} fill={s.partyFill} />}

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

function HpBar({ label, current, max, fill }: { label: string; current: number; max: number; fill: string }) {
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
        <div
          className={`h-full rounded-full transition-all duration-700 motion-reduce:transition-none ${fill}`}
          style={{ width: `${pct}%` }}
        />
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
