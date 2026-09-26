"use client";

import { useState, useTransition } from "react";
import type { ActionResult } from "@/lib/backlog/types";
import type { StreakRescue } from "@/lib/supabase/types";
import { rescueDeadline } from "@/lib/rpg/rescue";
import { FlameIcon } from "@/components/ui/icons";
import { PixelButton } from "@/components/ui/pixel-button";

// Streak recovery on the dashboard: his streak is on hold, and this
// parchment note is the way to win it back. He picks one of the offered rescue quests (up
// to 5, from the parents' pool) and taps "Done it!" when it's done — that
// strikes the boss like any quest (the hit overlay and sounds play from the
// battle event stream), and tonight's reset repairs the streak. With an empty
// pool it's the fallback: finish any quest by the deadline. Rules and
// deadlines live in the database (20260928000014_streak_recovery.sql).
//
// PLACEHOLDER COPY: the card's wording is temporary (no loss framing — it's
// about what can be won back).

type Props = {
  initial: StreakRescue;
  /** His today (family time), for "by the end of today / tomorrow / Wednesday". */
  today: string;
  pick: (rescueId: string, jobId: string) => Promise<ActionResult<StreakRescue>>;
  complete: (rescueId: string) => Promise<ActionResult<StreakRescue>>;
};

export function RescueQuest({ initial, today, pick, complete }: Props) {
  const [rescue, setRescue] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const days = `${rescue.streak_at_crack}‑day`;
  const byWhen = `by the end of ${rescueDeadline(rescue.due_on, today)}`;

  const run = (fn: () => Promise<ActionResult<StreakRescue>>) =>
    startTransition(async () => {
      setError(null);
      const result = await fn();
      if (result.ok) setRescue(result.data);
      else setError(result.error);
    });

  if (rescue.completed_at) {
    return (
      <section aria-live="polite" className="panel panel-parchment flex items-center gap-3 p-4">
        <FlameIcon className="h-9 w-9 shrink-0" />
        <div>
          <p className="font-display text-lg font-semibold">Rescue done!</p>
          <p className="text-sm font-bold text-ink-soft">Your {days} streak comes back tonight. Keep going!</p>
        </div>
      </section>
    );
  }

  return (
    <section aria-labelledby="rescue-title" className="panel panel-parchment p-4">
      <div className="flex items-start gap-3">
        {/* The streak's flame, dimmed while it's on hold. */}
        <FlameIcon className="h-9 w-9 shrink-0 opacity-60 grayscale-[60%]" />
        <div className="min-w-0">
          <h2 id="rescue-title" className="font-display text-lg font-semibold">
            Your {days} streak is on hold!
          </h2>
          <p className="text-sm font-bold text-ink-soft">
            {rescue.fallback
              ? `Finish any quest ${byWhen} to win it back.`
              : `Do a rescue quest ${byWhen} to win it back.`}
          </p>
        </div>
      </div>

      {!rescue.fallback && (
        <>
          <div role="radiogroup" aria-label="Rescue quests" className="mt-3 grid gap-2 sm:grid-cols-2">
            {rescue.offered.map((job) => {
              const chosen = rescue.job_id === job.job_id;
              return (
                <button
                  key={job.job_id}
                  type="button"
                  role="radio"
                  aria-checked={chosen}
                  disabled={pending}
                  onClick={() => !chosen && run(() => pick(rescue.id, job.job_id))}
                  className={`flex items-center justify-between gap-2 rounded-[3px] border-2 px-3 py-2 text-left font-bold transition-colors ${
                    chosen
                      ? "border-ink bg-gold/40"
                      : "border-parchment-edge bg-parchment-dark/40 hover:bg-parchment-dark/70"
                  }`}
                >
                  <span className="min-w-0">{job.title}</span>
                  <span className="shrink-0 text-sm tabular-nums text-ink-soft">{job.minutes} min</span>
                </button>
              );
            })}
          </div>
          <div className="mt-3 flex items-center justify-end gap-3">
            {error && (
              <p role="alert" className="text-sm font-bold text-[#9c1c1c]">
                {error}
              </p>
            )}
            <PixelButton
              variant="gold"
              disabled={pending || !rescue.job_id}
              onClick={() => run(() => complete(rescue.id))}
            >
              Done it!
            </PixelButton>
          </div>
        </>
      )}
    </section>
  );
}
