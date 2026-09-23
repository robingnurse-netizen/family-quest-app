"use client";

import { useMemo, useRef, useState } from "react";
import Link from "next/link";
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
import type { CalendarEvent, TaskSlot, WeeklyPool } from "@/lib/supabase/types";
import type { BoardActions } from "@/lib/backlog/types";
import { formatMinutes, poolTotals } from "@/lib/backlog/types";
import { poolColor } from "@/lib/backlog/colors";
import {
  formatDayLabel,
  formatWeekLabel,
  formatWeekdayShort,
  monthKeyOf,
  parseDayKey,
  timeOf,
  weekDays,
} from "@/lib/calendar/dates";
import { occurrencesByDay } from "@/lib/calendar/by-day";
import type { CalendarOccurrence } from "@/lib/calendar/recurrence";
import { useWeekBoard } from "@/lib/hooks/use-week-board";
import { useCalendarEvents } from "@/lib/hooks/use-calendar-events";
import { CheckIcon, ClockIcon, HourglassIcon, PadlockIcon, PinIcon, ScrollIcon, XIcon } from "@/components/ui/icons";
import { Modal } from "@/components/ui/modal";
import { GameHeading } from "@/components/ui/game-heading";
import { pixelButtonClass } from "@/components/ui/pixel-button";
import { WeekNav, syncWeekParam } from "./week-nav";

type Props = {
  familyId: string;
  childId: string;
  initialWeek: string;
  today: string;
  /** Family timezone, for the day notices. */
  timeZone: string;
  /** Calendar events for the first week's month (the day notices). */
  initialEvents: CalendarEvent[];
  initialPools: WeeklyPool[];
  initialSlots: TaskSlot[];
  actions: BoardActions;
};

type DropPrompt = { pool: WeeklyPool; day: string; remaining: number };

const isTemp = (slot: TaskSlot) => slot.id.startsWith("temp-");

/**
 * The player's quest board: a cork board in a wooden frame. Weekly quests
 * are parchment notes pinned in a tray, dragged onto Mon–Sun day slots to
 * schedule minutes. Each day shows its fixed calendar events first (read-only
 * notices), then the quests placed on it. Placed slots can be tapped to
 * toggle done, dragged to another day, or dragged back to the tray (or ×) to
 * remove. All changes are optimistic, confirmed by the server and Realtime.
 */
export function WeekBoard({
  familyId,
  childId,
  initialWeek,
  today,
  initialPools,
  initialSlots,
  timeZone,
  initialEvents,
  actions,
}: Props) {
  const [week, setWeek] = useState(initialWeek);
  const board = useWeekBoard({ familyId, childId, week, initialPools, initialSlots });
  // The family calendar, live: its month grid always covers this week.
  const calendar = useCalendarEvents({ familyId, timeZone, month: monthKeyOf(week), initialEvents });
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
  // Fixed notices per day: recurring events expanded like the calendar does.
  const noticesByDay = useMemo(
    () => occurrencesByDay(calendar.events, days[0], days[6], timeZone, today),
    [calendar.events, days, timeZone, today],
  );
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
    // The quest board: a wooden frame around a cork board.
    <section className="panel panel-wood p-2 sm:p-3" aria-label="Quest board">
      <div className="quest-cork rounded-[2px] border-2 border-wood-edge p-3 sm:p-4">
        <WeekNav
          week={week}
          today={today}
          onChange={goTo}
          titleClassName="min-w-0"
          buttonClassName={`${pixelButtonClass("stone", "sm")} min-w-9`}
          title={<CarvedSign week={week} />}
          extra={
            <Link href={`/player/quest-log?month=${monthKeyOf(week)}`} className={pixelButtonClass("gold", "sm")}>
              See whole month
            </Link>
          }
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
              {days.map((day) => {
                const daySlots = slotsByDay.get(day) ?? [];
                return (
                  <DayColumn
                    key={day}
                    day={day}
                    isToday={day === today}
                    isPast={day < today}
                    notices={noticesByDay.get(day) ?? []}
                    timeZone={timeZone}
                    dragging={activeId !== null}
                    hasQuests={daySlots.length > 0}
                  >
                    {daySlots.map((slot) => {
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
                );
              })}
            </div>
          </div>

          {/* The overlay sits under the pointer on release. It must not catch
              the mouseup: a slot overlay contains a disabled button, and
              disabled controls swallow mouse events, so the drag never ended. */}
          <DragOverlay dropAnimation={null} className="pointer-events-none">
            {active}
          </DragOverlay>
        </DndContext>
      </div>

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

/** The board's header: a carved wooden sign with the week range. */
function CarvedSign({ week }: { week: string }) {
  return (
    <span className="carved-sign inline-flex flex-col rounded-[3px] px-3 py-1.5">
      <span className="font-display text-xl font-semibold leading-tight text-gold text-shadow-pixel">
        Quest Board
      </span>
      {/* Dates in the body font (Stage 1's digit rule). */}
      <span className="text-sm font-extrabold leading-tight text-parchment">{formatWeekLabel(week)}</span>
    </span>
  );
}

/** A small tilt (±1.5°) per quest, stable across renders. */
function tiltOf(id: string) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return ((Math.abs(h) % 7) - 3) * 0.5;
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
      // Notes pinned straight onto the cork; glows while a placed quest is
      // being dragged back.
      className={`mt-4 rounded-[3px] ${
        isOver ? "drop-over" : draggingSlot ? "drop-ready" : ""
      }`}
    >
      <div className="plaque mb-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-3 py-1.5">
        <GameHeading as="h3" size="sm" className="shrink-0 uppercase tracking-wide">
          Weekly Quests
        </GameHeading>
        <p className="text-sm font-bold text-parchment">
          {draggingSlot ? "Drop here to put the minutes back" : "Drag a quest onto a day"}
        </p>
      </div>
      {pools.length === 0 ? (
        <p className="plaque px-3 py-3 text-center text-parchment">No weekly quests this week.</p>
      ) : (
        <div className="grid grid-cols-2 gap-x-3 gap-y-4 pt-1 sm:grid-cols-3 lg:grid-cols-4">
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
      className={`touch-manipulation rounded-[3px] outline-none focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-gold ${
        remaining === 0 ? "cursor-default opacity-55" : "cursor-grab active:cursor-grabbing"
      } ${isDragging ? "opacity-30" : ""}`}
    >
      <PoolCard pool={pool} slots={slots} />
    </div>
  );
}

/**
 * A weekly quest as a parchment note pinned to the board, tilted a touch.
 * The quest's colour is the ribbon in the corner (not the fill), so the ink
 * text always has full contrast. Picked up (`overlay`), it straightens and
 * lifts off the board.
 */
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
      className={`relative rounded-[2px] border-2 border-parchment-edge bg-parchment px-3 pb-2.5 pt-3.5 text-ink ${
        overlay ? "note-lifted" : "shadow-[2px_3px_0_rgb(0_0_0/0.35)]"
      }`}
      style={{ rotate: overlay ? "0deg" : `${tiltOf(pool.id)}deg` }}
    >
      {!overlay && <PinIcon className="absolute -top-2 left-1/2 h-4 w-3 -translate-x-1/2" />}
      <span
        aria-hidden
        className="quest-ribbon absolute right-2 top-0 h-6 w-3.5"
        style={{ backgroundColor: poolColor(pool.color) }}
      />
      <p className="truncate pr-5 font-black">{pool.title}</p>
      {pool.category && <p className="truncate text-sm font-bold text-ink-soft">{pool.category}</p>}
      <p className="mt-2 flex items-center gap-1.5 font-bold">
        {remaining === 0 ? (
          <>
            <CheckIcon className="h-3.5 w-3.5" /> All scheduled
          </>
        ) : (
          <>
            <HourglassIcon className="h-4 w-4 shrink-0" />
            {formatMinutes(remaining)} <span className="font-normal text-ink-soft">left</span>
          </>
        )}
      </p>
    </div>
  );
}

// --- day columns & slots ------------------------------------------------------

/**
 * One day on the board, top to bottom: a plaque (day + date; a wax seal on
 * today), the day's fixed calendar events as locked notices (only if there
 * are any), a "+ Quests" divider, then the quest drop zone. The whole column
 * accepts drops. On a phone, a day with nothing on it collapses to one line.
 */
function DayColumn({
  day,
  isToday,
  isPast,
  notices,
  timeZone,
  dragging,
  hasQuests,
  children,
}: {
  day: string;
  isToday: boolean;
  isPast: boolean;
  notices: CalendarOccurrence[];
  timeZone: string;
  dragging: boolean;
  hasQuests: boolean;
  children: React.ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `day:${day}` });
  const compact = !hasQuests && notices.length === 0;
  return (
    <div
      ref={setNodeRef}
      className={`day-slot relative flex min-w-0 flex-col gap-1.5 rounded-[3px] p-1.5 md:min-h-56 md:p-1 ${
        isToday ? "day-today" : ""
      } ${isPast ? "day-past" : ""} ${compact ? "max-md:flex-row max-md:items-center max-md:gap-2" : ""}`}
    >
      <DayPlaque day={day} isToday={isToday} />

      {notices.length > 0 && (
        <section aria-label={`Fixed on ${formatDayLabel(day)}`}>
          <p className="mb-1 flex items-center gap-1 px-0.5 font-display text-sm font-semibold uppercase leading-none text-parchment">
            <PadlockIcon className="h-3.5 w-3.5 shrink-0" />
            Fixed
          </p>
          <ul className="space-y-1">
            {notices.map((notice) => (
              <Notice key={notice.occurrenceKey} notice={notice} timeZone={timeZone} />
            ))}
          </ul>
        </section>
      )}

      <p className={`flex items-center gap-1.5 px-0.5 md:gap-1 ${compact ? "max-md:hidden" : ""}`} aria-hidden>
        <span className="h-0.5 min-w-1 flex-1 bg-parchment/35" />
        <span className="whitespace-nowrap font-display text-sm font-semibold leading-none text-parchment">+ Quests</span>
        <span className="h-0.5 min-w-1 flex-1 bg-parchment/35" />
      </p>

      <div
        className={`flex min-w-0 flex-1 flex-col gap-1.5 rounded-[3px] ${
          isOver ? "drop-over" : dragging ? "drop-ready" : ""
        }`}
      >
        {children}
        {!hasQuests && <EmptyQuestSlot compact={compact} />}
      </div>
    </div>
  );
}

/** Day plaque: weekday + date; today's date is a red wax seal. */
function DayPlaque({ day, isToday }: { day: string; isToday: boolean }) {
  return (
    <div className="plaque flex shrink-0 items-center justify-between gap-2 px-2 py-1 md:flex-col md:gap-0.5 md:px-1">
      <span className="font-display text-sm font-semibold uppercase tracking-wide text-parchment">
        {formatWeekdayShort(day)}
        {isToday && <span className="sr-only"> (today)</span>}
      </span>
      {isToday ? (
        <WaxSeal>{parseDayKey(day).day}</WaxSeal>
      ) : (
        // Same 40px box as the seal, so every day's plaque is the same height.
        <span className="flex h-10 min-w-10 items-center justify-center font-black tabular-nums text-white">
          {parseDayKey(day).day}
        </span>
      )}
    </div>
  );
}

/**
 * A red wax seal: irregular poured edge, a raised ring pressed into the wax,
 * and the date stamped inside it. The number is kept small (≤ ~55% of the
 * seal's width even for two digits) so it reads as an impression, not a
 * sticker.
 */
function WaxSeal({ children }: { children: React.ReactNode }) {
  return (
    <span className="relative flex h-10 w-10 shrink-0 items-center justify-center">
      <svg viewBox="0 0 40 40" className="absolute inset-0 h-full w-full" aria-hidden>
        {/* Poured wax: a lumpy edge with a darker rim. */}
        <path
          d="M20 1.6 L24.2 3.9 L28.9 3 L31.1 7.2 L35.8 8.9 L35.4 13.8 L38.3 17.6 L36.2 22 L37.3 26.8 L33.3 29.6 L32.1 34.4 L27.2 34.9 L23.7 38.4 L19.3 36.3 L14.6 38 L12.1 33.7 L7.3 32.5 L7.1 27.6 L3.3 24.5 L5.3 20 L3.7 15.3 L7.5 12.4 L8.3 7.5 L13.1 6.6 L15.9 2.6 Z"
          fill="#c92a2a"
          stroke="#7a1414"
          strokeWidth="1.6"
        />
        {/* A soft highlight on the poured wax, top-left. */}
        <path d="M10.5 12 Q14 8.4 18.5 7.8" fill="none" stroke="#ff8787" strokeWidth="1.5" strokeLinecap="round" />
        {/* The pressed face: slightly darker, recessed. */}
        <circle cx="20" cy="20" r="12.2" fill="#b32424" />
        {/* Raised ring: shadow down-right, highlight up-left (embossed). */}
        <circle cx="20.6" cy="20.7" r="12.2" fill="none" stroke="#6e1111" strokeWidth="1.8" />
        <circle cx="19.5" cy="19.4" r="12.2" fill="none" stroke="#ef6b6b" strokeWidth="1.2" />
        <circle cx="20" cy="20" r="12.2" fill="none" stroke="#d63a3a" strokeWidth="1" />
      </svg>
      {/* 14px black digits: "23" is ~16px wide (40% of the seal), "5" ~8px.
          Nunito's digits sit a touch high in their line box; nudge down. */}
      <span className="relative translate-y-px text-sm font-black leading-none tabular-nums text-[#fff5f5] [text-shadow:0_1px_0_#6e1111,0_-1px_0_rgb(255_255_255/0.2)]">
        {children}
      </span>
    </span>
  );
}

/** A fixed calendar event on a day: read-only, not draggable. */
function Notice({ notice, timeZone }: { notice: CalendarOccurrence; timeZone: string }) {
  const when = notice.all_day ? "All day" : timeOf(notice.start_time, timeZone);
  return (
    <li
      title={`${when} · ${notice.title}`}
      className="notice flex min-w-0 items-center gap-1.5 rounded-[2px] border-2 border-stone-edge bg-stone px-1.5 py-1 text-white md:flex-col md:items-start md:gap-0.5"
    >
      <span className="flex shrink-0 items-center gap-1 text-sm font-extrabold tabular-nums text-gold md:text-xs">
        <ClockIcon className="h-3.5 w-3.5 shrink-0" />
        {when}
      </span>
      <span className="min-w-0 truncate text-sm font-bold leading-tight md:w-full md:text-xs">{notice.title}</span>
    </li>
  );
}

/** Where a quest can go: a dotted slot with a faint scroll (one line on a phone). */
function EmptyQuestSlot({ compact }: { compact: boolean }) {
  return (
    <div
      className={`flex flex-1 items-center justify-center gap-2 rounded-[3px] border-2 border-dashed border-parchment/35 px-2 text-parchment/80 ${
        compact ? "min-h-10 max-md:justify-start" : "min-h-14"
      } md:min-h-24 md:flex-col md:gap-1`}
    >
      <ScrollIcon className="h-5 w-5 shrink-0 opacity-70" />
      <span className="text-sm font-bold md:text-center md:text-xs">Drop a quest here</span>
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
      // A parchment quest card on the day: tinted green once done, faded and
      // torn if missed. The quest's colour is the stripe down the side.
      className={`relative flex items-stretch rounded-[2px] border-2 border-parchment-edge text-left text-ink ${
        done ? "bg-[#d3f9d8]" : missed ? "quest-missed bg-parchment-dark" : "bg-parchment"
      } ${overlay ? "note-lifted" : "shadow-[2px_2px_0_rgb(0_0_0/0.4)]"} ${
        isTemp(slot) ? "animate-pulse motion-reduce:animate-none" : ""
      }`}
    >
      <span aria-hidden className="w-1.5 shrink-0 md:w-1" style={{ backgroundColor: color }} />
      {/* Title gets its own full-width line; status + duration (+ stamp, ×)
          sit below it, so narrow 7-column days never squeeze the title. */}
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
          // single word rather than chopping it), then an ellipsis. Full body
          // size in the single-column (phone) layout; seven desktop columns
          // (~60px of text) only fit 12px bold without splitting words.
          className="line-clamp-2 break-words hyphens-auto text-base font-extrabold leading-tight md:text-xs md:font-bold"
        >
          {pool.title}
        </span>
        {/* The stamp sits in this row and wraps to its own line on narrow
            desktop columns rather than covering the minutes. */}
        <span className={`mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-1 ${onRemove ? "pr-6" : ""}`}>
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
          </span>
          {/* Ink stamps (the aria-label above already says it). */}
          {locked && !missed && (
            <span aria-hidden className="ink-stamp ink-stamp-hit">
              Hit!
            </span>
          )}
          {missed && (
            <span aria-hidden className="ink-stamp ink-stamp-missed">
              Missed
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
