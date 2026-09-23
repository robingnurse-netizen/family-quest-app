"use client";

import { useMemo, useRef, useState } from "react";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import type { TaskSlot, WeeklyPool } from "@/lib/supabase/types";
import type { BoardActions } from "@/lib/backlog/types";
import { formatMinutes, poolTotals } from "@/lib/backlog/types";
import { poolColor } from "@/lib/backlog/colors";
import { formatDayLabel, formatWeekdayShort, parseDayKey, weekDays } from "@/lib/calendar/dates";
import { useWeekBoard } from "@/lib/hooks/use-week-board";
import { CheckIcon, XIcon } from "@/components/ui/icons";
import { Modal } from "@/components/ui/modal";
import { WeekNav, syncWeekParam } from "./week-nav";

type Props = {
  familyId: string;
  childId: string;
  initialWeek: string;
  today: string;
  initialPools: WeeklyPool[];
  initialSlots: TaskSlot[];
  actions: BoardActions;
};

type DropPrompt = { pool: WeeklyPool; day: string; remaining: number };

const isTemp = (slot: TaskSlot) => slot.id.startsWith("temp-");

/**
 * The player's weekly board: pool cards in a tray, dragged onto Mon–Sun day
 * columns to schedule minutes. Placed slots can be tapped to toggle done,
 * dragged to another day, or dragged back to the tray (or ×) to remove.
 * All changes are optimistic, confirmed by the server and Realtime.
 */
export function WeekBoard({
  familyId,
  childId,
  initialWeek,
  today,
  initialPools,
  initialSlots,
  actions,
}: Props) {
  const [week, setWeek] = useState(initialWeek);
  const board = useWeekBoard({ familyId, childId, week, initialPools, initialSlots });
  const [activeId, setActiveId] = useState<string | null>(null);
  const [prompt, setPrompt] = useState<DropPrompt | null>(null);
  const [error, setError] = useState<string | null>(null);
  const errorTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  // A mouse drag ends with a click on the element it started from; that click
  // fires right after onDragEnd, so a flag cleared on the next tick skips it.
  const justDragged = useRef(false);
  const tempSeq = useRef(0);

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    // Press-and-hold on touch so the page still scrolls normally.
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 8 } }),
    // Space picks up / drops; Enter is left for tapping (toggle done).
    useSensor(KeyboardSensor, {
      keyboardCodes: { start: ["Space"], cancel: ["Escape"], end: ["Space"] },
    }),
  );

  const days = useMemo(() => weekDays(week), [week]);
  const poolsById = useMemo(() => new Map(board.pools.map((p) => [p.id, p])), [board.pools]);
  const slotsByDay = useMemo(() => {
    const map = new Map<string, TaskSlot[]>();
    for (const slot of board.slots) {
      if (!poolsById.has(slot.pool_id)) continue;
      const list = map.get(slot.scheduled_date);
      if (list) list.push(slot);
      else map.set(slot.scheduled_date, [slot]);
    }
    return map;
  }, [board.slots, poolsById]);

  function showError(message: string) {
    setError(message);
    clearTimeout(errorTimer.current);
    errorTimer.current = setTimeout(() => setError(null), 4000);
  }

  function goTo(target: string) {
    setWeek(target);
    syncWeekParam(target);
  }

  // --- mutations (optimistic) ---------------------------------------------

  async function schedule(pool: WeeklyPool, day: string, minutes: number) {
    const temp: TaskSlot = {
      // Local-only id until the server returns the real row.
      id: `temp-${++tempSeq.current}`,
      pool_id: pool.id,
      scheduled_date: day,
      duration_minutes: minutes,
      sort_order: 0,
      status: "scheduled",
      applied_to_boss: false,
      completed_at: null,
      // Sorts after existing slots; replaced by the real row moments later.
      created_at: "9999-12-31T00:00:00Z",
    };
    board.upsertSlotLocal(temp);
    const result = await actions.createSlot(pool.id, day, minutes);
    board.removeSlotLocal(temp.id);
    if (result.ok) board.upsertSlotLocal(result.data);
    else showError(result.error);
  }

  async function move(slot: TaskSlot, day: string) {
    board.upsertSlotLocal({ ...slot, scheduled_date: day });
    const result = await actions.moveSlot(slot.id, day);
    if (result.ok) board.upsertSlotLocal(result.data);
    else {
      board.upsertSlotLocal(slot);
      showError(result.error);
    }
  }

  async function remove(slot: TaskSlot) {
    board.removeSlotLocal(slot.id);
    const result = await actions.removeSlot(slot.id);
    if (!result.ok) {
      board.upsertSlotLocal(slot);
      showError(result.error);
    }
  }

  async function toggle(slot: TaskSlot) {
    if (justDragged.current) return;
    const status = slot.status === "completed" ? "scheduled" : "completed";
    board.upsertSlotLocal({ ...slot, status });
    const result = await actions.setSlotStatus(slot.id, status);
    if (result.ok) board.upsertSlotLocal(result.data);
    else {
      board.upsertSlotLocal(slot);
      showError(result.error);
    }
  }

  // --- drag and drop --------------------------------------------------------

  function onDragStart(e: DragStartEvent) {
    setActiveId(String(e.active.id));
  }

  function onDragEnd(e: DragEndEvent) {
    setActiveId(null);
    justDragged.current = true;
    setTimeout(() => {
      justDragged.current = false;
    }, 0);
    const [kind, id] = String(e.active.id).split(":");
    const target = e.over ? String(e.over.id) : null;
    if (!target) return;

    if (kind === "pool" && target.startsWith("day:")) {
      const pool = poolsById.get(id);
      if (!pool) return;
      const remaining = poolTotals(pool, board.slots).remaining;
      if (remaining > 0) setPrompt({ pool, day: target.slice(4), remaining });
      return;
    }

    if (kind === "slot") {
      const slot = board.slots.find((s) => s.id === id);
      if (!slot) return;
      if (target === "tray") void remove(slot);
      else if (target.startsWith("day:") && target.slice(4) !== slot.scheduled_date) {
        void move(slot, target.slice(4));
      }
    }
  }

  const active = (() => {
    if (!activeId) return null;
    const [kind, id] = activeId.split(":");
    if (kind === "pool") {
      const pool = poolsById.get(id);
      return pool ? <PoolCard pool={pool} slots={board.slots} overlay /> : null;
    }
    const slot = board.slots.find((s) => s.id === id);
    const pool = slot && poolsById.get(slot.pool_id);
    return slot && pool ? <SlotCardView slot={slot} pool={pool} overlay /> : null;
  })();

  return (
    <section className="rounded-2xl border border-white/15 bg-white/5 p-3 sm:p-5">
      <WeekNav
        week={week}
        today={today}
        onChange={goTo}
        titleClassName="text-xl font-black text-amber-300"
        buttonClassName="text-indigo-100 hover:bg-white/10"
      />

      {error && (
        <p role="alert" className="mt-3 rounded-lg bg-red-500/20 px-3 py-2 text-sm text-red-100">
          {error}
        </p>
      )}

      <DndContext
        // Fixed id: dnd-kit's auto ids come from a module-level counter that
        // keeps climbing across server requests, so aria-describedby
        // wouldn't match the browser's and hydration would warn.
        id="week-board"
        sensors={sensors}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        onDragCancel={() => setActiveId(null)}
      >
        <div className={`transition-opacity ${board.loading ? "opacity-60" : ""}`}>
          <PoolTray
            pools={board.pools}
            slots={board.slots}
            draggingSlot={activeId?.startsWith("slot:") ?? false}
          />

          <div className="mt-4 grid grid-cols-1 gap-2 md:grid-cols-7">
            {days.map((day) => (
              <DayColumn key={day} day={day} isToday={day === today}>
                {(slotsByDay.get(day) ?? []).map((slot) => {
                  const pool = poolsById.get(slot.pool_id);
                  return pool ? (
                    <SlotCard
                      key={slot.id}
                      slot={slot}
                      pool={pool}
                      onToggle={() => void toggle(slot)}
                      onRemove={() => void remove(slot)}
                    />
                  ) : null;
                })}
              </DayColumn>
            ))}
          </div>
        </div>

        {/* The overlay sits under the pointer on release. It must not catch
            the mouseup: a slot overlay contains a disabled button, and
            disabled controls swallow mouse events, so the drag never ended. */}
        <DragOverlay dropAnimation={null} className="pointer-events-none">
          {active}
        </DragOverlay>
      </DndContext>

      <Modal
        open={prompt !== null}
        onClose={() => setPrompt(null)}
        title={prompt ? `${prompt.pool.title} · ${formatDayLabel(prompt.day)}` : ""}
        className="rounded-2xl border border-amber-300/40 bg-indigo-950 text-white shadow-2xl backdrop:bg-black/60"
        titleClassName="text-lg font-black text-amber-300"
        closeClassName="text-indigo-300"
      >
        {prompt && (
          <MinutesPrompt
            prompt={prompt}
            onCancel={() => setPrompt(null)}
            onConfirm={(minutes) => {
              setPrompt(null);
              void schedule(prompt.pool, prompt.day, minutes);
            }}
          />
        )}
      </Modal>
    </section>
  );
}

// --- tray & pool cards --------------------------------------------------------

function PoolTray({
  pools,
  slots,
  draggingSlot,
}: {
  pools: WeeklyPool[];
  slots: TaskSlot[];
  draggingSlot: boolean;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: "tray" });
  return (
    <div
      ref={setNodeRef}
      className={`mt-4 rounded-xl border-2 border-dashed p-3 transition ${
        isOver ? "border-amber-300 bg-amber-300/10" : draggingSlot ? "border-white/40" : "border-transparent bg-black/10"
      }`}
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-amber-300">Weekly Pool</h3>
        <p className="text-xs text-indigo-300">
          {draggingSlot ? "Drop here to put the minutes back" : "Drag a card onto a day"}
        </p>
      </div>
      {pools.length === 0 ? (
        <p className="py-4 text-center text-sm text-indigo-300">No quests in the pool this week.</p>
      ) : (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
          {pools.map((pool) => (
            <DraggablePoolCard key={pool.id} pool={pool} slots={slots} />
          ))}
        </div>
      )}
    </div>
  );
}

function DraggablePoolCard({ pool, slots }: { pool: WeeklyPool; slots: TaskSlot[] }) {
  const { remaining } = poolTotals(pool, slots);
  const { setNodeRef, attributes, listeners, isDragging } = useDraggable({
    id: `pool:${pool.id}`,
    disabled: remaining === 0,
  });
  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      aria-roledescription="draggable quest"
      aria-label={`${pool.title}, ${formatMinutes(remaining)} left. Press space to pick up.`}
      className={`touch-manipulation rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-amber-300 ${
        remaining === 0 ? "cursor-default opacity-50" : "cursor-grab active:cursor-grabbing"
      } ${isDragging ? "opacity-30" : ""}`}
    >
      <PoolCard pool={pool} slots={slots} />
    </div>
  );
}

function PoolCard({
  pool,
  slots,
  overlay = false,
}: {
  pool: WeeklyPool;
  slots: TaskSlot[];
  overlay?: boolean;
}) {
  const { remaining } = poolTotals(pool, slots);
  return (
    <div
      className={`rounded-xl px-4 py-3 text-white shadow ${overlay ? "rotate-2 scale-105 shadow-2xl" : ""}`}
      style={{ backgroundColor: poolColor(pool.color) }}
    >
      <p className="truncate font-black">{pool.title}</p>
      {pool.category && <p className="truncate text-xs opacity-85">{pool.category}</p>}
      <p className="mt-2 text-sm font-bold">
        {remaining === 0 ? (
          <span className="inline-flex items-center gap-1.5">
            <CheckIcon className="h-3.5 w-3.5" /> All scheduled
          </span>
        ) : (
          <>
            {formatMinutes(remaining)} <span className="font-normal opacity-85">left</span>
          </>
        )}
      </p>
    </div>
  );
}

// --- day columns & slots ------------------------------------------------------

function DayColumn({
  day,
  isToday,
  children,
}: {
  day: string;
  isToday: boolean;
  children: React.ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `day:${day}` });
  return (
    <div
      ref={setNodeRef}
      className={`flex min-h-20 min-w-0 flex-col gap-1.5 rounded-xl p-2 transition md:min-h-40 md:p-1.5 ${
        isOver ? "bg-amber-300/20 ring-2 ring-amber-300" : "bg-indigo-950/60"
      }`}
    >
      <div className="flex items-center gap-2 md:flex-col md:gap-0.5">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-indigo-300">
          {formatWeekdayShort(day)}
        </span>
        <span
          className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold ${
            isToday ? "bg-amber-400 text-indigo-950" : "text-indigo-100"
          }`}
        >
          {parseDayKey(day).day}
        </span>
      </div>
      {children}
    </div>
  );
}

function SlotCard({
  slot,
  pool,
  onToggle,
  onRemove,
}: {
  slot: TaskSlot;
  pool: WeeklyPool;
  onToggle: () => void;
  onRemove: () => void;
}) {
  // Only open (scheduled) slots can be moved or removed.
  const movable = slot.status === "scheduled" && !isTemp(slot);
  const { setNodeRef, attributes, listeners, isDragging } = useDraggable({
    id: `slot:${slot.id}`,
    disabled: !movable,
  });
  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      // The toggle button inside handles focus/keyboard; keep one tab stop.
      tabIndex={-1}
      className={`touch-manipulation ${movable ? "cursor-grab active:cursor-grabbing" : ""} ${
        isDragging ? "opacity-30" : ""
      }`}
    >
      <SlotCardView slot={slot} pool={pool} onToggle={onToggle} onRemove={movable ? onRemove : undefined} />
    </div>
  );
}

function SlotCardView({
  slot,
  pool,
  onToggle,
  onRemove,
  overlay = false,
}: {
  slot: TaskSlot;
  pool: WeeklyPool;
  onToggle?: () => void;
  onRemove?: () => void;
  overlay?: boolean;
}) {
  const done = slot.status === "completed";
  const missed = slot.status === "missed";
  // Completing a slot strikes the boss instantly and locks it (no un-tick).
  const locked = slot.applied_to_boss;
  const color = poolColor(pool.color);
  return (
    <div
      // Full title on hover (and for long-press previews) when it's clamped.
      title={pool.title}
      className={`relative flex items-stretch overflow-hidden rounded-lg text-left shadow ${
        done ? "bg-emerald-500/25" : missed ? "bg-white/5" : "bg-white/10"
      } ${overlay ? "rotate-2 scale-105 shadow-2xl" : ""} ${isTemp(slot) ? "animate-pulse" : ""}`}
    >
      <span aria-hidden className="w-1.5 shrink-0" style={{ backgroundColor: color }} />
      {/* Title gets its own full-width line; status + duration (+ ×) sit
          below it, so narrow 7-column days never squeeze the title. */}
      <button
        type="button"
        onClick={onToggle}
        disabled={!onToggle || missed || locked || isTemp(slot)}
        aria-pressed={done}
        aria-label={`${pool.title}, ${formatMinutes(slot.duration_minutes)}${
          missed
            ? ", missed"
            : locked
              ? ", done. Damage dealt"
              : done
                ? ", done. Tap to undo"
                : ". Tap when done"
        }`}
        className="min-w-0 flex-1 px-2 py-1.5 text-left disabled:cursor-default md:px-1.5"
      >
        <span
          // Up to two lines, wrapping at word boundaries (hyphenating a long
          // single word rather than chopping it), then an ellipsis.
          className={`line-clamp-2 break-words hyphens-auto text-xs font-bold leading-tight ${
            done ? "text-emerald-100" : "text-white"
          }`}
        >
          {pool.title}
        </span>
        <span
          className={`mt-1 flex items-center gap-1.5 ${onRemove ? "pr-6" : ""} ${
            // Locked slots carry a "hit!" badge: let it drop to its own line
            // on narrow day columns rather than being clipped.
            locked ? "flex-wrap gap-y-0.5" : ""
          }`}
        >
          <span
            aria-hidden
            className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2 ${
              done ? "border-emerald-300 bg-emerald-400 text-indigo-950" : "border-white/50"
            }`}
          >
            {done && <CheckIcon className="h-2.5 w-2.5" />}
          </span>
          <span className="truncate text-[11px] text-indigo-200">
            {formatMinutes(slot.duration_minutes)}
            {missed && " · missed"}
          </span>
          {locked && (
            <span className="shrink-0 whitespace-nowrap rounded bg-amber-400/90 px-1 text-[10px] font-black leading-4 text-indigo-950">
              hit!
            </span>
          )}
        </span>
      </button>
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Remove ${pool.title} slot`}
          className="absolute bottom-0.5 right-0.5 flex h-6 w-6 items-center justify-center rounded text-indigo-300 hover:bg-white/10 hover:text-white"
        >
          <XIcon className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}

// --- minutes prompt -------------------------------------------------------------

const CHUNKS = [15, 30, 45, 60];

function MinutesPrompt({
  prompt,
  onCancel,
  onConfirm,
}: {
  prompt: DropPrompt;
  onCancel: () => void;
  onConfirm: (minutes: number) => void;
}) {
  const { remaining } = prompt;
  // A sensible chunk: half an hour, or whatever's left if that's less.
  const [minutes, setMinutes] = useState(Math.min(30, remaining));
  const chunks = CHUNKS.filter((c) => c < remaining);
  const valid = Number.isInteger(minutes) && minutes > 0 && minutes <= remaining;

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (valid) onConfirm(minutes);
      }}
      className="space-y-4"
    >
      <p className="text-sm text-indigo-200">
        How long will you spend on it? {formatMinutes(remaining)} left in this pool.
      </p>
      <div className="flex flex-wrap gap-2">
        {[...chunks, remaining].map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => setMinutes(c)}
            aria-pressed={minutes === c}
            className={`rounded-lg px-3 py-1.5 text-sm font-bold ${
              minutes === c ? "bg-amber-400 text-indigo-950" : "bg-white/10 text-white hover:bg-white/20"
            }`}
          >
            {c === remaining ? `All (${formatMinutes(c)})` : formatMinutes(c)}
          </button>
        ))}
      </div>
      <label className="block">
        <span className="mb-1 block text-sm font-semibold text-indigo-200">Minutes</span>
        <input
          type="number"
          min={1}
          max={remaining}
          value={Number.isNaN(minutes) ? "" : minutes}
          onChange={(e) => setMinutes(e.target.valueAsNumber)}
          autoFocus
          className="w-full rounded-lg border border-white/20 bg-white/10 px-3 py-2 text-white outline-none focus:border-amber-300 focus:ring-2 focus:ring-amber-300/40"
        />
      </label>
      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-lg bg-white/10 px-4 py-2 font-semibold text-white hover:bg-white/20"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={!valid}
          className="rounded-lg bg-amber-400 px-4 py-2 font-bold text-indigo-950 hover:bg-amber-300 disabled:opacity-50"
        >
          Schedule
        </button>
      </div>
    </form>
  );
}
