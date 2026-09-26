// The evening nudge: from EVENING_WARNING_FROM (the family's timezone),
// while he still has open quests today and a boss can be raided, the boss
// charges up and a line offers tonight's opportunity — finish them (a
// perfect day) and Rogue goes on a Night Raid (tonight_stakes().raid_damage,
// …16). No loss framing: nothing is taken away overnight any more. Pure —
// tested in tests/evening.test.mjs.

import type { TonightStakes } from "@/lib/supabase/types";

/** When the evening warning starts, HH:MM in the family's timezone. Tune here. */
export const EVENING_WARNING_FROM = "18:00";

/** Minutes since midnight at `now` in `timeZone`. */
export function minutesInZone(now: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return get("hour") * 60 + get("minute");
}

const toMinutes = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
};

/** Is it evening (from `from` until midnight) in `timeZone`? */
export function isEvening(now: Date, timeZone: string, from: string = EVENING_WARNING_FROM): boolean {
  return minutesInZone(now, timeZone) >= toMinutes(from);
}

/**
 * The nudge line, or null when there's nothing on offer: not evening, no
 * boss, none of his quests left, or no raid possible (a boss at 1 HP). Folds
 * in the streak (the scene's streak nudge steps aside while this shows): a
 * perfect day also grows it — unless a rescue is open (a streak on hold
 * doesn't grow). PLACEHOLDER COPY.
 */
export function eveningNudge(
  evening: boolean,
  stakes: TonightStakes | null,
  streak: number,
): string | null {
  if (!evening || !stakes || !stakes.boss_active || stakes.my_open_quests <= 0 || stakes.raid_damage <= 0) return null;
  const n = stakes.my_open_quests;
  // Non-breaking space: "4 days" never splits across lines.
  const next = streak + 1;
  const streakPart = !stakes.rescue_open ? ` Your streak grows to ${next}\u00a0${next === 1 ? "day" : "days"} too!` : "";
  return `${n} quest${n === 1 ? "" : "s"} left — finish ${n === 1 ? "it" : "them"} and Rogue goes on a Night Raid tonight!${streakPart}`;
}
