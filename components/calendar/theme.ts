// Class sets for the two calendar skins. The rendering logic is shared; only
// these strings differ between Parent HQ and the player's RPG dashboard.

export type CalendarVariant = "parent" | "player";

export type CalendarTheme = {
  shell: string;
  title: string;
  navButton: string;
  weekday: string;
  cell: string;
  cellOutside: string;
  cellHover: string;
  dayNumber: string;
  today: string;
  chip: string;
  chipAllDay: string;
  chipTime: string;
  more: string;
  dialog: string;
  dialogTitle: string;
  label: string;
  input: string;
  muted: string;
  primaryButton: string;
  secondaryButton: string;
  dangerButton: string;
  error: string;
  note: string;
  toggleOn: string;
  toggleOff: string;
};

export const calendarThemes: Record<CalendarVariant, CalendarTheme> = {
  parent: {
    shell: "rounded-2xl border border-slate-200 bg-white p-3 shadow-sm sm:p-5",
    title: "text-xl font-black text-slate-900",
    navButton:
      "inline-flex h-8 min-w-8 items-center justify-center rounded-lg px-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-100",
    weekday: "text-slate-500",
    cell: "bg-white",
    cellOutside: "bg-slate-50 text-slate-400",
    cellHover: "hover:bg-indigo-50 focus-visible:bg-indigo-50",
    dayNumber: "text-slate-700",
    today: "bg-indigo-600 text-white",
    chip: "bg-indigo-100 text-indigo-900 hover:bg-indigo-200",
    chipAllDay: "bg-indigo-600 text-white hover:bg-indigo-500",
    chipTime: "text-indigo-600",
    more: "text-slate-500 hover:text-slate-800",
    dialog:
      "rounded-2xl border border-slate-200 bg-white text-slate-900 shadow-xl backdrop:bg-slate-900/40",
    dialogTitle: "text-lg font-black text-slate-900",
    label: "text-sm font-semibold text-slate-700",
    input:
      "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200",
    muted: "text-slate-500",
    primaryButton:
      "rounded-lg bg-indigo-600 px-4 py-2 font-bold text-white shadow hover:bg-indigo-500 disabled:opacity-60",
    secondaryButton:
      "rounded-lg bg-slate-100 px-4 py-2 font-semibold text-slate-700 hover:bg-slate-200",
    dangerButton:
      "rounded-lg px-4 py-2 font-semibold text-red-600 hover:bg-red-50 disabled:opacity-60",
    error: "rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700",
    note: "rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900",
    toggleOn: "bg-indigo-600 text-white hover:bg-indigo-500",
    toggleOff: "bg-slate-100 text-slate-600 hover:bg-slate-200",
  },
  player: {
    shell: "rounded-2xl border border-white/15 bg-white/5 p-3 sm:p-5",
    title: "text-xl font-black text-amber-300",
    navButton:
      "inline-flex h-8 min-w-8 items-center justify-center rounded-lg px-2.5 text-sm font-semibold text-indigo-100 hover:bg-white/10",
    weekday: "text-indigo-300",
    cell: "bg-indigo-950/60",
    cellOutside: "bg-indigo-950/20 text-indigo-400/60",
    cellHover: "",
    dayNumber: "text-indigo-100",
    today: "bg-amber-400 text-indigo-950",
    chip: "bg-purple-500/30 text-purple-50 hover:bg-purple-500/45",
    chipAllDay: "bg-amber-400/90 text-indigo-950 hover:bg-amber-300",
    chipTime: "text-amber-200",
    more: "text-indigo-300 hover:text-white",
    dialog:
      "rounded-2xl border border-amber-300/40 bg-indigo-950 text-white shadow-2xl backdrop:bg-black/60",
    dialogTitle: "text-lg font-black text-amber-300",
    label: "text-sm font-semibold text-indigo-200",
    input: "",
    muted: "text-indigo-300",
    primaryButton:
      "rounded-lg bg-amber-400 px-4 py-2 font-bold text-indigo-950 hover:bg-amber-300",
    secondaryButton:
      "rounded-lg bg-white/10 px-4 py-2 font-semibold text-white hover:bg-white/20",
    dangerButton: "",
    error: "rounded-lg bg-red-500/20 px-3 py-2 text-sm text-red-100",
    // Edit-only styles; the player calendar is read-only.
    note: "",
    toggleOn: "",
    toggleOff: "",
  },
};
