"use client";

import { useState, useTransition } from "react";
import type { Boss, DailyResetResult, PartyHealth } from "@/lib/supabase/types";
import { useBattle } from "@/lib/hooks/use-battle";

// Minimal boss + party HP display for verifying the engine. The real battle
// screen (sprites, animations) replaces this in RPG Phase B.

type Variant = "parent" | "player";

const styles: Record<
  Variant,
  { shell: string; title: string; muted: string; track: string; badge: string; button: string; note: string }
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
  },
  player: {
    shell: "rounded-2xl border border-white/15 bg-white/5 p-4 sm:p-5",
    title: "text-lg font-black text-amber-300",
    muted: "text-indigo-300",
    track: "bg-black/30",
    badge: "bg-white/10 text-indigo-100",
    button: "",
    note: "",
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
  const { boss, party, refetch } = useBattle({ familyId, initialBoss, initialParty });
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  function reset() {
    if (!runReset) return;
    const bossName = boss?.name ?? "The boss";
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
      {boss ? (
        <>
          <div className="flex items-baseline justify-between gap-2">
            <h2 className={s.title}>{boss.name}</h2>
            <span className={`rounded-full px-2 py-0.5 text-xs font-semibold uppercase ${s.badge}`}>
              {boss.tier === "epic" ? "Epic boss" : boss.tier === "mid" ? "Boss" : "Minion"}
            </span>
          </div>
          <HpBar
            label="Boss HP"
            current={boss.current_hp}
            max={boss.max_hp}
            fill="bg-gradient-to-r from-rose-600 to-orange-500"
            track={s.track}
            muted={s.muted}
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
          track={s.track}
          muted={s.muted}
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
    </section>
  );
}

function HpBar({
  label,
  current,
  max,
  fill,
  track,
  muted,
}: {
  label: string;
  current: number;
  max: number;
  fill: string;
  track: string;
  muted: string;
}) {
  const pct = max > 0 ? Math.max(0, Math.min(100, (current / max) * 100)) : 0;
  return (
    <div className="mt-3">
      <div className={`mb-1 flex justify-between text-xs font-semibold ${muted}`}>
        <span>{label}</span>
        <span>
          {current} / {max}
        </span>
      </div>
      <div
        className={`h-3 overflow-hidden rounded-full ${track}`}
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
