// The evening warning: from EVENING_WARNING_FROM (the family's timezone),
// while today still has open quests and a boss is active, the boss charges
// up and a line states tonight's stakes (tonight_stakes(): what the nightly
// reset would actually deal). Pure — tested in tests/evening.test.mjs.

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
 * The warning line, or null when there's nothing to warn about: not
 * evening, no boss, none of his quests left, or no damage at stake. Folds
 * in the streak (the scene's streak nudge steps aside while this shows).
 */
export function eveningWarning(
  evening: boolean,
  stakes: TonightStakes | null,
  streak: number,
): string | null {
  if (!evening || !stakes || !stakes.boss_active || stakes.my_open_quests <= 0 || stakes.damage <= 0) return null;
  const n = stakes.my_open_quests;
  const boss = stakes.boss_name ?? "The boss";
  const ko = stakes.damage >= stakes.party_hp ? " and gets knocked out" : "";
  // Non-breaking hyphen: "3-day" never splits across lines.
  const streakPart = streak > 0 ? ` — and your ${streak}\u2011day streak ends` : "";
  return `${boss} is powering up! ${n} quest${n === 1 ? "" : "s"} left before midnight, or the party takes ${stakes.damage} damage${ko}${streakPart}.`;
}
