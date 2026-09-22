"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import type { CalendarEvent } from "@/lib/supabase/types";
import {
  dayKeyOf,
  eventDaySpan,
  formatDayLabel,
  formatEventWhen,
  timeOf,
} from "@/lib/calendar/dates";
import { XIcon } from "@/components/ui/icons";
import type { CalendarTheme } from "./theme";
import type { CalendarActions } from "@/lib/calendar/types";
import {
  WEEKDAY_CODES,
  describeRule,
  parseWeeklyRule,
  weekdayName,
  weekdayOf,
  type CalendarOccurrence,
  type WeekdayCode,
} from "@/lib/calendar/recurrence";

export type DialogState =
  | { kind: "create"; day: string }
  | { kind: "edit"; event: CalendarEvent }
  | { kind: "view"; event: CalendarEvent }
  | { kind: "day"; day: string };

type Props = {
  state: DialogState | null;
  onClose: () => void;
  onOpen: (state: DialogState) => void;
  onOpenOccurrence: (occ: CalendarOccurrence) => void;
  theme: CalendarTheme;
  timeZone: string;
  actions?: CalendarActions;
  memberNames: Record<string, string>;
  eventsForDay: (day: string) => CalendarOccurrence[];
  onSaved: (event: CalendarEvent) => void;
  onDeleted: (id: string) => void;
};

/** Native <dialog> wrapper: Esc, focus trapping and backdrop come for free. */
export function EventDialog({ state, onClose, theme, ...rest }: Props) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (state && !dialog.open) dialog.showModal();
    if (!state && dialog.open) dialog.close();
  }, [state]);

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => {
        // Clicking the backdrop (the dialog element itself) closes it.
        if (e.target === e.currentTarget) onClose();
      }}
      className={`m-auto w-[calc(100%-2rem)] max-w-md p-0 ${theme.dialog}`}
    >
      {state && (
        <div className="p-5">
          <DialogBody
            // Remount per target so form defaults reset.
            key={stateKey(state)}
            state={state}
            onClose={onClose}
            theme={theme}
            {...rest}
          />
        </div>
      )}
    </dialog>
  );
}

function stateKey(state: DialogState) {
  return state.kind === "create" || state.kind === "day"
    ? `${state.kind}:${state.day}`
    : `${state.kind}:${state.event.id}`;
}

function DialogBody(props: Props & { state: DialogState }) {
  const { state } = props;
  switch (state.kind) {
    case "day":
      return <DayList {...props} day={state.day} />;
    case "view":
      return <EventDetails {...props} event={state.event} />;
    case "create":
    case "edit":
      return props.actions ? (
        <EventForm {...props} state={state} actions={props.actions} />
      ) : null;
  }
}

function DialogHeader({
  title,
  theme,
  onClose,
}: {
  title: string;
  theme: CalendarTheme;
  onClose: () => void;
}) {
  return (
    <div className="mb-4 flex items-start justify-between gap-3">
      <h2 className={theme.dialogTitle}>{title}</h2>
      <button
        type="button"
        onClick={onClose}
        aria-label="Close"
        className={`-mr-1 -mt-1 rounded-lg p-1.5 ${theme.muted} hover:opacity-80`}
      >
        <XIcon className="h-5 w-5" />
      </button>
    </div>
  );
}

function DayList({
  day,
  theme,
  timeZone,
  actions,
  eventsForDay,
  onOpen,
  onOpenOccurrence,
  onClose,
}: Props & { day: string }) {
  const events = eventsForDay(day);
  return (
    <>
      <DialogHeader title={formatDayLabel(day)} theme={theme} onClose={onClose} />
      {events.length === 0 ? (
        <p className={theme.muted}>Nothing planned.</p>
      ) : (
        <ul className="space-y-2">
          {events.map((e) => (
            <li key={e.occurrenceKey}>
              <button
                type="button"
                onClick={() => onOpenOccurrence(e)}
                className={`w-full rounded-lg px-3 py-2 text-left ${e.all_day ? theme.chipAllDay : theme.chip}`}
              >
                <span className="block font-semibold">{e.title}</span>
                <span className="block text-xs opacity-80">
                  {formatEventWhen(e, timeZone)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {actions && (
        <div className="mt-5 flex justify-end">
          <button
            type="button"
            onClick={() => onOpen({ kind: "create", day })}
            className={theme.primaryButton}
          >
            Add event
          </button>
        </div>
      )}
    </>
  );
}

function EventDetails({
  event,
  theme,
  timeZone,
  memberNames,
  onClose,
}: Props & { event: CalendarEvent }) {
  const author = event.created_by ? memberNames[event.created_by] : undefined;
  const rule = parseWeeklyRule(event.recurrence_rule, timeZone);
  return (
    <>
      <DialogHeader title={event.title} theme={theme} onClose={onClose} />
      <dl className="space-y-3">
        <div>
          <dt className={theme.label}>When</dt>
          <dd>{formatEventWhen(event, timeZone)}</dd>
        </div>
        {rule && (
          <div>
            <dt className={theme.label}>Repeats</dt>
            <dd>{describeRule(rule, formatDayLabel)}</dd>
          </div>
        )}
        {event.location && (
          <div>
            <dt className={theme.label}>Where</dt>
            <dd>{event.location}</dd>
          </div>
        )}
        {event.description && (
          <div>
            <dt className={theme.label}>Details</dt>
            <dd className="whitespace-pre-wrap">{event.description}</dd>
          </div>
        )}
        {author && <p className={`text-sm ${theme.muted}`}>Added by {author}</p>}
      </dl>
      <div className="mt-5 flex justify-end">
        <button type="button" onClick={onClose} className={theme.primaryButton}>
          Got it
        </button>
      </div>
    </>
  );
}

function EventForm({
  state,
  theme,
  timeZone,
  actions,
  memberNames,
  onClose,
  onSaved,
  onDeleted,
}: Props & {
  state: Extract<DialogState, { kind: "create" | "edit" }>;
  actions: CalendarActions;
}) {
  const existing = state.kind === "edit" ? state.event : null;
  const defaults =
    state.kind === "edit"
      ? eventDefaults(state.event, timeZone)
      : { startDate: state.day, endDate: state.day, startTime: "09:00", endTime: "10:00" };

  const existingRule = existing ? parseWeeklyRule(existing.recurrence_rule, timeZone) : null;
  const [allDay, setAllDay] = useState(existing?.all_day ?? false);
  const [repeats, setRepeats] = useState(Boolean(existingRule));
  const [repeatDays, setRepeatDays] = useState<WeekdayCode[]>(existingRule?.days ?? []);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [saving, startSaving] = useTransition();
  const [deleting, startDeleting] = useTransition();

  // onSubmit rather than <form action>: React resets uncontrolled forms after
  // an action, which would wipe the parent's input on a validation error.
  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    if (repeats && repeatDays.length === 0) {
      return setError("Pick at least one day for it to repeat on.");
    }
    setError(null);
    startSaving(async () => {
      const result = await actions.save(formData);
      if (!result.ok) return setError(result.error);
      onSaved(result.event);
      onClose();
    });
  }

  function remove() {
    if (!existing) return;
    setError(null);
    startDeleting(async () => {
      const result = await actions.remove(existing.id);
      if (!result.ok) return setError(result.error);
      onDeleted(existing.id);
      onClose();
    });
  }

  const author = existing?.created_by ? memberNames[existing.created_by] : undefined;

  function toggleRepeats(e: React.ChangeEvent<HTMLInputElement>) {
    const on = e.target.checked;
    setRepeats(on);
    // Pre-select the start date's weekday — the most likely answer.
    if (on && repeatDays.length === 0) {
      const start = e.target.form?.elements.namedItem("start_date") as HTMLInputElement | null;
      const day = start?.value || defaults.startDate;
      if (day) setRepeatDays([weekdayOf(day)]);
    }
  }

  function toggleDay(code: WeekdayCode) {
    setRepeatDays((days) =>
      days.includes(code) ? days.filter((d) => d !== code) : [...days, code],
    );
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <DialogHeader
        title={
          state.kind === "edit" ? "Edit event" : `New event · ${formatDayLabel(state.day)}`
        }
        theme={theme}
        onClose={onClose}
      />
      {existing && <input type="hidden" name="id" value={existing.id} />}
      {existingRule && (
        <p className={theme.note}>Editing changes all repeats of this event.</p>
      )}

      <label className="block">
        <span className={`mb-1 block ${theme.label}`}>Title</span>
        <input
          name="title"
          required
          maxLength={200}
          autoFocus
          defaultValue={existing?.title}
          className={theme.input}
        />
      </label>

      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          name="all_day"
          checked={allDay}
          onChange={(e) => setAllDay(e.target.checked)}
          className="h-4 w-4 accent-indigo-600"
        />
        <span className={theme.label}>All day</span>
      </label>

      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className={`mb-1 block ${theme.label}`}>Starts</span>
          <input
            type="date"
            name="start_date"
            required
            defaultValue={defaults.startDate}
            className={theme.input}
          />
        </label>
        {!allDay && (
          <label className="block">
            <span className={`mb-1 block ${theme.label}`}>at</span>
            <input
              type="time"
              name="start_time"
              required
              defaultValue={defaults.startTime}
              className={theme.input}
            />
          </label>
        )}
        <label className={`block ${allDay ? "" : "col-start-1"}`}>
          <span className={`mb-1 block ${theme.label}`}>Ends</span>
          <input
            type="date"
            name="end_date"
            required
            defaultValue={defaults.endDate}
            className={theme.input}
          />
        </label>
        {!allDay && (
          <label className="block">
            <span className={`mb-1 block ${theme.label}`}>at</span>
            <input
              type="time"
              name="end_time"
              required
              defaultValue={defaults.endTime}
              className={theme.input}
            />
          </label>
        )}
      </div>

      <div className="space-y-3">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            name="repeats"
            checked={repeats}
            onChange={toggleRepeats}
            className="h-4 w-4 accent-indigo-600"
          />
          <span className={theme.label}>Repeats weekly</span>
        </label>

        {repeats && (
          <>
            <fieldset>
              <legend className={`mb-1 ${theme.label}`}>On</legend>
              <div className="grid grid-cols-7 gap-1">
                {WEEKDAY_CODES.map((code) => {
                  const on = repeatDays.includes(code);
                  return (
                    <button
                      key={code}
                      type="button"
                      aria-pressed={on}
                      onClick={() => toggleDay(code)}
                      className={`rounded-lg py-1.5 text-xs font-bold transition ${
                        on ? theme.toggleOn : theme.toggleOff
                      }`}
                    >
                      {weekdayName(code)}
                    </button>
                  );
                })}
              </div>
              {repeatDays.map((code) => (
                <input key={code} type="hidden" name="byday" value={code} />
              ))}
            </fieldset>

            <label className="block">
              <span className={`mb-1 block ${theme.label}`}>
                Ends on <span className={`font-normal ${theme.muted}`}>(optional)</span>
              </span>
              <input
                type="date"
                name="repeat_until"
                defaultValue={existingRule?.untilDay ?? ""}
                min={defaults.startDate}
                className={theme.input}
              />
            </label>
          </>
        )}
      </div>

      <label className="block">
        <span className={`mb-1 block ${theme.label}`}>Location</span>
        <input name="location" defaultValue={existing?.location ?? ""} className={theme.input} />
      </label>

      <label className="block">
        <span className={`mb-1 block ${theme.label}`}>Description</span>
        <textarea
          name="description"
          rows={3}
          defaultValue={existing?.description ?? ""}
          className={theme.input}
        />
      </label>

      {author && <p className={`text-sm ${theme.muted}`}>Added by {author}</p>}
      {error && (
        <p role="alert" className={theme.error}>
          {error}
        </p>
      )}

      <div className="flex items-center justify-between gap-2 pt-1">
        {existing ? (
          confirmDelete ? (
            <button
              type="button"
              onClick={remove}
              disabled={deleting}
              className={theme.dangerButton}
            >
              {deleting ? "Deleting…" : existingRule ? "Delete all repeats?" : "Really delete?"}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmDelete(true)}
              className={theme.dangerButton}
            >
              Delete
            </button>
          )
        ) : (
          <span />
        )}
        <div className="flex gap-2">
          <button type="button" onClick={onClose} className={theme.secondaryButton}>
            Cancel
          </button>
          <button type="submit" disabled={saving} className={theme.primaryButton}>
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </form>
  );
}

/** Form defaults for editing, converted back into the family timezone. */
function eventDefaults(event: CalendarEvent, timeZone: string) {
  const { first, last } = eventDaySpan(event, timeZone);
  const startTime = timeOf(event.start_time, timeZone);
  if (event.all_day || !event.end_time) {
    return {
      startDate: first,
      endDate: last,
      startTime: event.all_day ? "09:00" : startTime,
      endTime: event.all_day ? "10:00" : startTime,
    };
  }
  // Use the real end date (not the exclusive-end display day) so a
  // 22:00–00:00 event round-trips unchanged.
  return {
    startDate: first,
    endDate: dayKeyOf(event.end_time, timeZone),
    startTime,
    endTime: timeOf(event.end_time, timeZone),
  };
}
