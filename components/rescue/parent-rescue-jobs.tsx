"use client";

import { useState, useTransition } from "react";
import type { ActionResult } from "@/lib/backlog/types";
import type { RescueJob } from "@/lib/supabase/types";

// Parent HQ's rescue-quest pool: add a job (name + minutes), hide or show
// one. Minimal by design — the Rewards catalog's look, without its modal.

type Actions = {
  add: (title: string, minutes: number) => Promise<ActionResult<RescueJob>>;
  setActive: (id: string, active: boolean) => Promise<ActionResult<RescueJob>>;
};

export function ParentRescueJobs({ initial, actions }: { initial: RescueJob[]; actions: Actions }) {
  const [jobs, setJobs] = useState(initial);
  const [title, setTitle] = useState("");
  const [minutes, setMinutes] = useState(10);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const upsert = (job: RescueJob) => setJobs((js) => (js.some((j) => j.id === job.id) ? js.map((j) => (j.id === job.id ? job : j)) : [...js, job]));
  const active = jobs.filter((j) => j.active).length;

  function add(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      setError(null);
      const result = await actions.add(title, minutes);
      if (!result.ok) return setError(result.error);
      upsert(result.data);
      setTitle("");
    });
  }

  function toggle(job: RescueJob) {
    startTransition(async () => {
      setError(null);
      const result = await actions.setActive(job.id, !job.active);
      if (result.ok) upsert(result.data);
      else setError(result.error);
    });
  }

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
      <h2 className="mb-1 text-lg font-black text-slate-900">Rescue job pool</h2>
      <p className="mb-3 text-sm text-slate-600">
        {active} active {active === 1 ? "job" : "jobs"} — he&apos;s offered up to 5 at random to choose from.
      </p>
      {jobs.length === 0 ? (
        <p className="rounded-xl border border-dashed border-slate-300 p-6 text-center text-slate-500">
          No rescue jobs yet. Add a few quick ones (about 10 minutes each).
        </p>
      ) : (
        <ul className="space-y-2">
          {[...jobs].sort((a, b) => Number(b.active) - Number(a.active)).map((job) => (
            <li
              key={job.id}
              className={`flex items-center justify-between gap-3 rounded-xl border border-slate-200 px-3 py-2 ${job.active ? "" : "opacity-60"}`}
            >
              <span className="min-w-0 font-semibold text-slate-900">
                {job.title} <span className="font-normal text-slate-500">· {job.minutes} min</span>
                {!job.active && <span className="ml-2 text-xs font-bold uppercase text-slate-500">Hidden</span>}
              </span>
              <button
                type="button"
                disabled={pending}
                onClick={() => toggle(job)}
                className="shrink-0 rounded-lg border border-slate-300 px-3 py-1 text-sm font-bold text-slate-700 hover:bg-slate-50"
              >
                {job.active ? "Hide" : "Show"}
              </button>
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={add} className="mt-4 flex flex-wrap items-end gap-2">
        <label className="min-w-0 flex-1">
          <span className="block text-sm font-semibold text-slate-700">New job</span>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={80}
            placeholder="e.g. Tidy the shoe rack"
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900"
          />
        </label>
        <label>
          <span className="block text-sm font-semibold text-slate-700">Minutes</span>
          <input
            type="number"
            min={5}
            max={60}
            value={minutes}
            onChange={(e) => setMinutes(Number(e.target.value))}
            className="mt-1 w-24 rounded-lg border border-slate-300 px-3 py-2 text-slate-900"
          />
        </label>
        <button
          type="submit"
          disabled={pending || !title.trim()}
          className="rounded-lg bg-indigo-600 px-4 py-2 font-bold text-white shadow hover:bg-indigo-500 disabled:opacity-50"
        >
          Add
        </button>
      </form>
      {error && (
        <p role="alert" className="mt-2 text-sm font-semibold text-red-700">
          {error}
        </p>
      )}
    </section>
  );
}
