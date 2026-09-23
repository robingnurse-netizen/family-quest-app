// Class sets for the two calendar skins. The rendering logic is shared; only
// these strings differ between Parent HQ and the player's RPG dashboard.

export type CalendarVariant = "parent" | "player";

export type CalendarTheme = {
  shell: string;
  title: string;
  navButton: string;
  /** Weekday header row: size/weight/colour. */
  weekday: string;
  /** Day grid wrapper (shape and grid-line colour showing through gap-px). */
  grid: string;
  /** Day number badge: shape, size, weight. */
  dayShape: string;
  cell: string;
  cellOutside: string;
  cellHover: string;
  dayNumber: string;
  today: string;
  chip: string;
  chipAllDay: string;
  chipTime: string;
  /** Event chip shape and text size. */
  chipShape: string;
  chipText: string;
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
    weekday: "text-[11px] font-semibold text-slate-500",
    grid: "rounded-xl",
    dayShape: "rounded-full text-xs font-bold",
    cell: "bg-white",
    cellOutside: "bg-slate-50 text-slate-400",
    cellHover: "hover:bg-indigo-50 focus-visible:bg-indigo-50",
    dayNumber: "text-slate-700",
    today: "bg-indigo-600 text-white",
    chip: "bg-indigo-100 text-indigo-900 hover:bg-indigo-200",
    chipAllDay: "bg-indigo-600 text-white hover:bg-indigo-500",
    chipTime: "text-indigo-600",
    chipShape: "rounded text-[10px] font-semibold sm:text-xs",
    chipText: "text-[10px] font-semibold sm:text-xs",
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
  // Player (the Quest Log page): an unrolled parchment scroll.
  player: {
    shell: "scroll-sheet px-3 pb-5 pt-5 text-ink sm:px-5",
    // One line next to the nav buttons on a phone.
    title: "font-display text-lg font-semibold text-ink sm:text-xl",
    navButton: "btn-pixel btn-stone btn-sm min-w-9",
    weekday: "bg-parchment-dark font-display text-sm font-semibold text-ink",
    // gap-px lines show the scroll's inked rules between the cells.
    grid: "rounded-[2px] border-2 border-parchment-edge bg-parchment-edge",
    dayShape: "rounded-[3px] text-sm font-black tabular-nums",
    cell: "bg-[#f7ecd3] text-ink",
    cellOutside: "bg-parchment-dark/70 text-ink-soft",
    cellHover: "",
    dayNumber: "text-ink",
    today: "bg-danger text-white ring-2 ring-ink",
    chip: "bg-stone text-white hover:bg-stone-hi",
    chipAllDay: "bg-gold text-ink hover:brightness-105",
    chipTime: "text-gold",
    // Seven columns on a phone only fit ~12px chips.
    chipShape: "rounded-[2px] text-xs font-bold sm:text-sm",
    chipText: "text-xs font-bold sm:text-sm",
    more: "text-ink-soft hover:text-ink",
    dialog: "panel panel-parchment backdrop:bg-black/60",
    dialogTitle: "font-display text-xl font-semibold text-ink",
    label: "font-bold text-ink-soft",
    input: "",
    muted: "text-ink-soft",
    primaryButton: "btn-pixel btn-primary btn-md",
    secondaryButton: "btn-pixel btn-stone btn-md",
    dangerButton: "",
    error: "rounded-[3px] border-2 border-danger bg-[#fff0f0] px-3 py-2 font-bold text-ink",
    // Edit-only styles; the player calendar is read-only.
    note: "",
    toggleOn: "",
    toggleOff: "",
  },
};
