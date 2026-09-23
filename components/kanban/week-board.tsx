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
import { GameHeading } from "@/components/ui/game-heading";
import { pixelButtonClass } from "@/components/ui/pixel-button";
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
    // A wooden quest board.
    <section className="panel panel-wood p-3 sm:p-5">
      <WeekNav
        week={week}
        today={today}
        onChange={goTo}
        titleClassName="font-display text-xl font-semibold text-gold text-shadow-pixel"
        buttonClassName={`${pixelButtonClass("stone", "sm")} min-w-9`}
      />

      {error && (
        <p role="alert" className="panel panel-stone mt-3 px-3 py-2 font-bold text-boss-text">
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

          <div className="mt-4 grid grid-cols-1 gap-2 md:grid-cols-7 md:gap-1.5">
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
        className="panel panel-parchment backdrop:bg-black/60"
        titleClassName="font-display text-xl font-semibold text-ink"
        closeClassName="text-ink-soft"
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
      // Recessed well; a dashed outline shows it's a drop target mid-drag.
      className={`panel panel-inset mt-4 p-3 ${
        isOver
          ? "outline-3 -outline-offset-6 outline-dashed outline-gold"
          : draggingSlot
            ? "outline-2 -outline-offset-6 outline-dashed outline-parchment/50"
            : ""
      }`}
    >
      <div className="mb-3 flex items-center justify-between gap-3">
        <GameHeading as="h3" size="sm" className="shrink-0 uppercase tracking-wide">
          Weekly Quests
        </GameHeading>
        <p className="text-right text-stone-text">
          {draggingSlot ? "Drop here to put the minutes back" : "Drag a card onto a day"}
        </p>
      </div>
      {pools.length === 0 ? (
        <p className="py-4 text-center text-stone-text">No weekly quests this week.</p>
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
      className={`touch-manipulation rounded-[4px] outline-none focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-gold ${
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
    // Bevelled card in the pool's colour; a hard text shadow keeps white text
    // legible on the lighter pool colours.
    <div
      className={`rounded-[4px] border-3 border-stone-edge px-4 py-3 text-white shadow-[inset_2px_2px_0_rgb(255_255_255/0.3),inset_-2px_-2px_0_rgb(0_0_0/0.25)] [text-shadow:1px_1px_0_rgb(0_0_0/0.45)] ${
        overlay ? "rotate-2 scale-105 drop-shadow-[4px_6px_0_rgb(0_0_0/0.4)]" : ""
      }`}
      style={{ backgroundColor: poolColor(pool.color) }}
    >
      <p className="truncate font-black">{pool.title}</p>
      {pool.category && <p className="truncate text-sm font-bold opacity-90">{pool.category}</p>}
      <p className="mt-2 font-bold">
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
      // Recessed slot in the board; gold outline while a card hovers over it.
      className={`panel panel-inset flex min-h-20 min-w-0 flex-col gap-1.5 border-2 p-2 md:min-h-40 md:p-1 ${
        isOver ? "outline-3 outline-gold" : isToday ? "outline-2 outline-gold/60" : ""
      }`}
    >
      <div className="flex items-center gap-2 md:flex-col md:gap-0.5">
        <span className="font-display text-sm font-semibold uppercase tracking-wide text-stone-text">
          {formatWeekdayShort(day)}
        </span>
        <span
          className={`flex h-7 w-7 items-center justify-center rounded-[3px] font-black tabular-nums ${
            isToday ? "bg-gold text-ink" : "text-white"
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
      // A parchment quest note pinned to the day, tinted green once done.
      className={`relative flex items-stretch overflow-hidden rounded-[3px] border-2 border-parchment-edge text-left text-ink shadow-[2px_2px_0_rgb(0_0_0/0.4)] ${
        done ? "bg-[#d3f9d8]" : missed ? "bg-parchment-dark opacity-75" : "bg-parchment"
      } ${overlay ? "rotate-2 scale-105 shadow-2xl" : ""} ${isTemp(slot) ? "animate-pulse motion-reduce:animate-none" : ""}`}
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
        className="min-w-0 flex-1 px-2 py-1.5 text-left disabled:cursor-default md:px-1"
      >
        <span
          // Up to two lines, wrapping at word boundaries (hyphenating a long
          // single word rather than chopping it), then an ellipsis.
          // Full body size in the single-column (phone) layout. Seven narrow
          // desktop columns (~60px of text) only fit 12px bold without
          // splitting words, until the quest board is rebuilt.
          className="line-clamp-2 break-words hyphens-auto text-base font-extrabold leading-tight md:text-xs md:font-bold"
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
            className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-[2px] border-2 ${
              done ? "border-[#2b8a3e] bg-party text-ink" : "border-ink-soft bg-white/60"
            }`}
          >
            {done && <CheckIcon className="h-2.5 w-2.5" />}
          </span>
          <span className="truncate text-sm font-bold text-ink-soft md:text-xs">
            {formatMinutes(slot.duration_minutes)}
            {missed && " · missed"}
          </span>
          {locked && (
            <span className="shrink-0 whitespace-nowrap rounded-[2px] bg-danger px-1 text-xs font-black uppercase leading-4 text-white">
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
          className="absolute bottom-0.5 right-0.5 flex h-6 w-6 items-center justify-center rounded-[2px] text-ink-soft hover:bg-ink/10 hover:text-ink"
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
      <p className="text-ink-soft">
        How long will you spend on it? {formatMinutes(remaining)} left in this pool.
      </p>
      <div className="flex flex-wrap gap-2">
        {[...chunks, remaining].map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => setMinutes(c)}
            aria-pressed={minutes === c}
            // Minutes are numbers: body font (see app/(player)/layout.tsx).
            className={`${pixelButtonClass(minutes === c ? "gold" : "stone", "md")} font-body font-black`}
          >
            {c === remaining ? `All (${formatMinutes(c)})` : formatMinutes(c)}
          </button>
        ))}
      </div>
      <label className="block">
        <span className="mb-1 block font-bold text-ink">Minutes</span>
        <input
          type="number"
          min={1}
          max={remaining}
          value={Number.isNaN(minutes) ? "" : minutes}
          onChange={(e) => setMinutes(e.target.valueAsNumber)}
          autoFocus
          className="w-full rounded-[3px] border-2 border-parchment-edge bg-[#fffaf0] px-3 py-2 text-ink shadow-[inset_2px_2px_0_rgb(0_0_0/0.08)] outline-none focus:border-ink focus:ring-2 focus:ring-ink/30"
        />
      </label>
      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className={pixelButtonClass("stone", "md")}
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={!valid}
          className={pixelButtonClass("primary", "md")}
        >
          Schedule
        </button>
      </div>
    </form>
  );
}
