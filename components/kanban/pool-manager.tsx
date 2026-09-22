"use client";

import { useMemo, useState, useTransition } from "react";
import type { TaskSlot, WeeklyPool } from "@/lib/supabase/types";
import type { ActionResult, BoardMember } from "@/lib/backlog/types";
import { formatMinutes, poolTotals } from "@/lib/backlog/types";
import { DEFAULT_POOL_COLOR, POOL_COLORS, poolColor } from "@/lib/backlog/colors";
import { addDays, formatWeekLabel, weekStartOf } from "@/lib/calendar/dates";
import { useWeekBoard } from "@/lib/hooks/use-week-board";
import { Modal } from "@/components/ui/modal";
import { WeekNav, syncWeekParam } from "./week-nav";

export type PoolActions = {
  save: (formData: FormData) => Promise<ActionResult<WeeklyPool>>;
  remove: (id: string) => Promise<ActionResult<string>>;
};

type Props = {
  familyId: string;
  initialWeek: string;
  today: string;
  initialPools: WeeklyPool[];
  initialSlots: TaskSlot[];
  members: BoardMember[];
  /** Provide to allow creating/editing/deleting pools. Omit for read-only. */
  actions?: PoolActions;
};

const CATEGORY_SUGGESTIONS = ["Homework", "Reading", "Music practice", "Chores", "Exercise", "Screen-free play"];

/**
 * Parent view of a week's pools with live allocated / done / remaining
 * minutes. Editable on /parent/pools, read-only summary on /parent.
 */
export function PoolManager({
  familyId,
  initialWeek,
  today,
  initialPools,
  initialSlots,
  members,
  actions,
}: Props) {
  const [week, setWeek] = useState(initialWeek);
  const [editing, setEditing] = useState<WeeklyPool | "new" | null>(null);
  const board = useWeekBoard({ familyId, childId: null, week, initialPools, initialSlots });

  const children = members.filter((m) => m.role === "child");
  const names = useMemo(
    () => Object.fromEntries(members.map((m) => [m.id, m.display_name])),
    [members],
  );

  function goTo(target: string) {
    setWeek(target);
    syncWeekParam(target);
  }

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
      <WeekNav
        week={week}
        today={today}
        onChange={goTo}
        titleClassName="text-xl font-black text-slate-900"
        buttonClassName="text-slate-700 hover:bg-slate-100"
      />

      <div className={`mt-4 space-y-3 transition-opacity ${board.loading ? "opacity-60" : ""}`}>
        {board.pools.length === 0 ? (
          <p className="rounded-xl border border-dashed border-slate-300 p-6 text-center text-slate-500">
            No pools for this week yet.
          </p>
        ) : (
          board.pools.map((pool) => (
            <PoolRow
              key={pool.id}
              pool={pool}
              slots={board.slots}
              childName={names[pool.child_id]}
              authorName={pool.created_by ? names[pool.created_by] : undefined}
              onEdit={actions ? () => setEditing(pool) : undefined}
            />
          ))
        )}
      </div>

      {actions &&
        (children.length ? (
          <button
            type="button"
            onClick={() => setEditing("new")}
            className="mt-4 rounded-lg bg-indigo-600 px-4 py-2 font-bold text-white shadow hover:bg-indigo-500"
          >
            New pool
          </button>
        ) : (
          <p className="mt-4 text-sm text-slate-500">
            Pools are assigned to a player. Once a player joins the family with the invite code,
            you can create pools for them.
          </p>
        ))}

      {actions && (
        <Modal
          open={editing !== null}
          onClose={() => setEditing(null)}
          title={editing === "new" ? "New pool" : "Edit pool"}
          className="rounded-2xl border border-slate-200 bg-white text-slate-900 shadow-xl backdrop:bg-slate-900/40"
          titleClassName="text-lg font-black text-slate-900"
          closeClassName="text-slate-500"
        >
          {editing !== null && (
            <PoolForm
              pool={editing === "new" ? null : editing}
              week={week}
              today={today}
              players={children}
              slots={board.slots}
              actions={actions}
              onDone={() => setEditing(null)}
              onSaved={board.upsertPoolLocal}
              onDeleted={board.removePoolLocal}
            />
          )}
        </Modal>
      )}
    </section>
  );
}

function PoolRow({
  pool,
  slots,
  childName,
  authorName,
  onEdit,
}: {
  pool: WeeklyPool;
  slots: TaskSlot[];
  childName?: string;
  authorName?: string;
  onEdit?: () => void;
}) {
  const totals = poolTotals(pool, slots);
  const color = poolColor(pool.color);
  const pct = (n: number) => `${Math.min(100, (n / pool.total_minutes) * 100)}%`;

  return (
    <div className="rounded-xl border border-slate-200 p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-2">
          <span
            aria-hidden
            className="mt-1 h-3 w-3 shrink-0 rounded-full"
            style={{ backgroundColor: color }}
          />
          <div className="min-w-0">
            <p className="truncate font-bold text-slate-900">{pool.title}</p>
            <p className="text-xs text-slate-500">
              {[childName, pool.category, authorName && `added by ${authorName}`]
                .filter(Boolean)
                .join(" · ")}
            </p>
          </div>
        </div>
        {onEdit && (
          <button
            type="button"
            onClick={onEdit}
            className="shrink-0 rounded-lg px-2.5 py-1 text-sm font-semibold text-indigo-600 hover:bg-indigo-50"
          >
            Edit
          </button>
        )}
      </div>

      {/* Done (solid) inside scheduled (tinted) inside total (track). */}
      <div
        className="relative mt-3 h-2.5 overflow-hidden rounded-full bg-slate-100"
        role="img"
        aria-label={`${formatMinutes(totals.allocated)} of ${formatMinutes(pool.total_minutes)} scheduled, ${formatMinutes(totals.completed)} done`}
      >
        <div
          className="absolute inset-y-0 left-0 rounded-full opacity-35 transition-all"
          style={{ width: pct(totals.allocated), backgroundColor: color }}
        />
        <div
          className="absolute inset-y-0 left-0 rounded-full transition-all"
          style={{ width: pct(totals.completed), backgroundColor: color }}
        />
      </div>
      <dl className="mt-2 grid grid-cols-3 gap-2 text-xs">
        <Stat label="Scheduled" value={`${formatMinutes(totals.allocated)} / ${formatMinutes(pool.total_minutes)}`} />
        <Stat label="Done" value={formatMinutes(totals.completed)} />
        <Stat label="Remaining" value={formatMinutes(totals.remaining)} />
      </dl>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="font-semibold uppercase tracking-wide text-slate-400">{label}</dt>
      <dd className="font-bold text-slate-800">{value}</dd>
    </div>
  );
}

function PoolForm({
  pool,
  week,
  today,
  players,
  slots,
  actions,
  onDone,
  onSaved,
  onDeleted,
}: {
  pool: WeeklyPool | null;
  week: string;
  today: string;
  players: BoardMember[];
  slots: TaskSlot[];
  actions: PoolActions;
  onDone: () => void;
  onSaved: (pool: WeeklyPool) => void;
  onDeleted: (id: string) => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [saving, startSaving] = useTransition();
  const [deleting, startDeleting] = useTransition();
  const [color, setColor] = useState(pool?.color ?? DEFAULT_POOL_COLOR);

  const allocated = pool ? poolTotals(pool, slots).allocated : 0;
  const weekOptions = useMemo(() => {
    const current = weekStartOf(today);
    const set = new Set<string>();
    for (let i = -1; i <= 10; i++) set.add(addDays(current, i * 7));
    set.add(pool?.week_start_date ?? week);
    return [...set].sort();
  }, [today, week, pool]);

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    setError(null);
    startSaving(async () => {
      const result = await actions.save(formData);
      if (!result.ok) return setError(result.error);
      onSaved(result.data);
      onDone();
    });
  }

  function remove() {
    if (!pool) return;
    setError(null);
    startDeleting(async () => {
      const result = await actions.remove(pool.id);
      if (!result.ok) return setError(result.error);
      onDeleted(pool.id);
      onDone();
    });
  }

  const input =
    "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200";
  const label = "mb-1 block text-sm font-semibold text-slate-700";

  return (
    <form onSubmit={submit} className="space-y-4">
      {pool && <input type="hidden" name="id" value={pool.id} />}

      <label className="block">
        <span className={label}>Title</span>
        <input name="title" required maxLength={120} autoFocus defaultValue={pool?.title} className={input} />
      </label>

      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className={label}>For</span>
          <select name="child_id" required defaultValue={pool?.child_id ?? players[0]?.id} className={input}>
            {players.map((p) => (
              <option key={p.id} value={p.id}>
                {p.display_name}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className={label}>Week</span>
          <select
            name="week_start_date"
            required
            defaultValue={pool?.week_start_date ?? week}
            // Moving a pool with scheduled slots would strand them.
            disabled={allocated > 0}
            className={input}
          >
            {weekOptions.map((w) => (
              <option key={w} value={w}>
                {formatWeekLabel(w)}
              </option>
            ))}
          </select>
          {allocated > 0 && pool && (
            <input type="hidden" name="week_start_date" value={pool.week_start_date} />
          )}
        </label>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className={label}>Category</span>
          <input name="category" list="pool-categories" defaultValue={pool?.category ?? ""} className={input} />
          <datalist id="pool-categories">
            {CATEGORY_SUGGESTIONS.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </label>
        <label className="block">
          <span className={label}>Total minutes</span>
          <input
            type="number"
            name="total_minutes"
            required
            min={Math.max(1, allocated)}
            max={7 * 24 * 60}
            defaultValue={pool?.total_minutes ?? 120}
            className={input}
          />
        </label>
      </div>
      {allocated > 0 && (
        <p className="-mt-2 text-xs text-slate-500">
          {formatMinutes(allocated)} already scheduled, so the total can&apos;t go below that and the
          week is locked.
        </p>
      )}

      <fieldset>
        <legend className={label}>Colour</legend>
        <div className="flex flex-wrap gap-2">
          {POOL_COLORS.map((c) => (
            <label key={c.hex} className="cursor-pointer">
              <input
                type="radio"
                name="color"
                value={c.hex}
                checked={color === c.hex}
                onChange={() => setColor(c.hex)}
                className="peer sr-only"
              />
              <span
                title={c.name}
                className="block h-8 w-8 rounded-full ring-offset-2 peer-checked:ring-2 peer-checked:ring-slate-900 peer-focus-visible:ring-2 peer-focus-visible:ring-indigo-400"
                style={{ backgroundColor: c.hex }}
              />
              <span className="sr-only">{c.name}</span>
            </label>
          ))}
        </div>
      </fieldset>

      {error && (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}

      <div className="flex items-center justify-between gap-2 pt-1">
        {pool ? (
          <button
            type="button"
            onClick={confirmDelete ? remove : () => setConfirmDelete(true)}
            disabled={deleting}
            className="rounded-lg px-4 py-2 font-semibold text-red-600 hover:bg-red-50 disabled:opacity-60"
          >
            {deleting
              ? "Deleting…"
              : confirmDelete
                ? allocated > 0
                  ? "Delete pool and its slots?"
                  : "Really delete?"
                : "Delete"}
          </button>
        ) : (
          <span />
        )}
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onDone}
            className="rounded-lg bg-slate-100 px-4 py-2 font-semibold text-slate-700 hover:bg-slate-200"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving}
            className="rounded-lg bg-indigo-600 px-4 py-2 font-bold text-white shadow hover:bg-indigo-500 disabled:opacity-60"
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </form>
  );
}
