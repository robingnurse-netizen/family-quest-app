// "While you were away": the nightly resets since the player last saw a
// recap (reset_recaps rows), combined into one short story and its lines.
// Pure (no React) — components/rpg/battle/recap.tsx stages it and
// tests/recap.test.mjs checks it.
//
// PROGRESS NEVER GOES BACKWARDS (…16): nothing is taken away overnight, so
// the recap only tells good news and what can be won back — Rogue's Night
// Raid (the good-news beat), a streak on hold and how to win it back, a
// streak won back. Missed quests on their own get no recap at all (the rows
// are still acknowledged, silently). No loss framing anywhere.
//
// PLACEHOLDER COPY: every line in this file is temporary wording, to be
// replaced in a copy pass.

import type { BossStatus, BossTier, RescueEvent, ResetRecap } from "@/lib/supabase/types";

export type RecapBoss = {
  id: string;
  name: string;
  sprite_key: string;
  tier: BossTier;
  /** Live state, as the recap loads (the "one hit from K.O." closing line). */
  status?: BossStatus;
  current_hp?: number;
};

export type RecapRow = Pick<
  ResetRecap,
  | "created_at"
  | "day_from"
  | "day_to"
  | "boss_id"
  | "perfect_days"
  | "streak_before"
  | "streak_after"
  | "rescue_events"
  | "raid_damage"
  | "raids"
>;

/**
 * How the recap plays: "raid" (Rogue's Night Raid lands on the boss — the
 * animated good-news beat), "text" (no raid, but something worth saying:
 * a streak on hold / won back, a perfect day), "quiet" (nothing to say —
 * acknowledged without showing anything).
 */
export type RecapKind = "raid" | "text" | "quiet";

export type RecapSummary = {
  kind: RecapKind;
  /** Newest row's created_at: acknowledge up to here. */
  through: string;
  nights: number;
  /** "Last night" (one night, yesterday) or "While you were away". */
  when: string;
  /** His Night Raids, all nights together (one number on screen). */
  raidDamage: number;
  raids: number;
  /** The boss his (latest) raid hit. */
  raidBoss: RecapBoss | null;
  /** The newest night's active boss (after its run), if any. */
  boss: RecapBoss | null;
  perfectDays: number;
  /**
   * Streak-recovery events, all nights in order: a streak put on hold (with
   * its rescue quest's deadline), won back, or halved.
   */
  rescue: RescueEvent[];
  /** The story, in order, then the closing line. */
  lines: string[];
  /** When each line appears: at the start, or as the raid lands. */
  cues: RecapCue[];
  closing: string;
};

export type RecapCue = "start" | "raid";

/**
 * Combine unseen recap rows (any order) into one summary, or null if there
 * are none. `yesterday` is the family's yesterday (YYYY-MM-DD).
 */
export function summarizeRecaps(
  rows: RecapRow[],
  bosses: Record<string, RecapBoss>,
  yesterday: string,
): RecapSummary | null {
  if (rows.length === 0) return null;
  const nights = [...rows].sort((a, b) => a.created_at.localeCompare(b.created_at));
  const first = nights[0];
  const last = nights[nights.length - 1];
  const sum = (key: "raid_damage" | "raids" | "perfect_days") => nights.reduce((n, r) => n + (r[key] ?? 0), 0);

  const raidDamage = sum("raid_damage");
  const raids = sum("raids");
  const perfectDays = sum("perfect_days");
  const raidBossId = [...nights].reverse().find((r) => (r.raid_damage ?? 0) > 0)?.boss_id ?? null;
  const bossId = last.boss_id;
  const rescue = nights.flatMap((r) => r.rescue_events ?? []);

  const oneNight = nights.length === 1 && first.day_from === yesterday && first.day_to === yesterday;
  const when = oneNight ? "Last night" : "While you were away";

  const kind: RecapKind = raidDamage > 0 ? "raid" : rescue.length > 0 || perfectDays > 0 ? "text" : "quiet";
  const summary: Omit<RecapSummary, "lines" | "cues" | "closing"> = {
    kind,
    through: last.created_at,
    nights: nights.length,
    when,
    raidDamage,
    raids,
    raidBoss: raidBossId ? (bosses[raidBossId] ?? null) : null,
    boss: bossId ? (bosses[bossId] ?? null) : null,
    perfectDays,
    rescue,
  };
  return { ...summary, ...recapText(summary) };
}

/** The recap's lines: short, kid-friendly, all good news. PLACEHOLDER COPY. */
export function recapText(s: Omit<RecapSummary, "lines" | "cues" | "closing">): {
  lines: string[];
  cues: RecapCue[];
  closing: string;
} {
  const lines: string[] = [];
  const cues: RecapCue[] = [];
  const say = (line: string, cue: RecapCue) => {
    lines.push(line);
    cues.push(cue);
  };
  if (s.raidDamage > 0) {
    const boss = s.raidBoss?.name ?? "the boss";
    say(
      s.raids > 1
        ? `${s.when}, Rogue snuck out on ${s.raids} Night Raids — ${boss} took ${s.raidDamage} damage!`
        : `${s.when}, Rogue snuck out on a Night Raid — ${boss} took ${s.raidDamage} damage!`,
      "raid",
    );
  } else if (s.perfectDays > 0) {
    // A perfect day with nothing to raid (no boss, or one left at 1 HP).
    say(s.perfectDays > 1 ? `${s.perfectDays} perfect days!` : "Perfect day!", "start");
  }
  for (const e of s.rescue) say(rescueLine(e), "start");

  // A perfect day last night with nothing to raid because the boss (still
  // active, still at 1 HP) is one hit from K.O. No boss, or it's since been
  // hit or beaten: the plain line.
  const oneHit =
    s.raidDamage === 0 &&
    s.perfectDays > 0 &&
    s.when === "Last night" &&
    s.boss?.status === "active" &&
    s.boss.current_hp === 1;
  const closing =
    s.raidDamage > 0
      ? "Another perfect day, another raid!"
      : oneHit && s.boss
        ? `Full clear yesterday — ${s.boss.name} is one hit from K.O.!`
        : "New day — let's go!";
  return { lines, cues, closing };
}

/** The day a rescue is due, as a weekday ("Wednesday"). */
const weekday = (day: string) =>
  new Date(`${day}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "long", timeZone: "UTC" });

/**
 * One streak-recovery line, framed around what can be won back: a streak on
 * hold comes with its fix and deadline, a rescue celebrates, a halving
 * points at the next perfect day. Non-breaking hyphens keep "6-day"
 * together. PLACEHOLDER COPY.
 */
export function rescueLine(e: RescueEvent): string {
  const days = (n: number) => `${n}‑day`;
  const dayCount = (n: number) => `${n} ${n === 1 ? "day" : "days"}`;
  switch (e.event) {
    case "cracked":
      return e.fallback
        ? `Your ${days(e.streak_at_crack)} streak has a crack. Finish any quest by the end of ${weekday(e.due_on)} to patch it up.`
        : `Your ${days(e.streak_at_crack)} streak has a crack. Do a rescue quest by the end of ${weekday(e.due_on)} to patch it up.`;
    case "rescued":
      return `Rescue complete — your ${days(e.streak_after)} streak is whole again!`;
    case "halved":
      return `Your streak is on ${dayCount(e.streak_after)} — every perfect day adds one!`;
  }
}

// --- Staging ------------------------------------------------------------------

/** Every duration in the recap, in ms — tune here. */
export const RECAP_TIMING = {
  /** Card up, everyone standing, before the raid lands on the boss. */
  lead: 900,
  /** The raid → the hero cheers and Rogue barks. */
  cheerAfter: 700,
  /** Between lines of text. */
  lineGap: 650,
} as const;

export type RecapBeat =
  | { at: number; kind: "raid" | "cheer" }
  | { at: number; kind: "line"; index: number }
  | { at: number; kind: "closing" };

/**
 * The recap's animated part: when each beat happens (ms from the start), in
 * order, ending with "closing" — the summary card is then complete (every
 * line and the closing line) and stays up until he taps Continue; nothing
 * closes by itself. A tap before that skips straight to the summary
 * (recapFinalState). A raid: the boss takes it (hurt, one damage number, a
 * sound) → the hero cheers and Rogue barks. "text": just the lines.
 */
export function recapSchedule(s: RecapSummary): RecapBeat[] {
  const T = RECAP_TIMING;
  const beats: RecapBeat[] = [];
  let t = 0;
  let textFrom: number;
  const lineAt: number[] = [];

  if (s.kind === "raid") {
    t = T.lead;
    beats.push({ at: t, kind: "raid" });
    textFrom = t;
    t += T.cheerAfter;
    beats.push({ at: t, kind: "cheer" });
  } else {
    textFrom = 400;
  }

  // Each line on its cue (never before the one above it, a gap apart).
  const cueAt = (cue: RecapCue) =>
    cue === "start" ? textFrom : (beats.find((b) => b.kind === cue)?.at ?? textFrom);
  s.lines.forEach((_, index) => {
    const after = index === 0 ? textFrom : lineAt[index - 1] + T.lineGap;
    lineAt.push(Math.max(after, cueAt(s.cues[index] ?? "start")));
    beats.push({ at: lineAt[index], kind: "line", index });
  });
  const lastLine = lineAt.length ? lineAt[lineAt.length - 1] + T.lineGap : textFrom;
  const closingAt = Math.max(t, lastLine);
  beats.push({ at: closingAt, kind: "closing" });
  return beats.sort((a, b) => a.at - b.at);
}

/**
 * Where the animated part ends — the summary card's state, for a skip (or
 * reduced motion): every line, and the raided boss on stage (none for a
 * text recap).
 */
export function recapFinalState(s: RecapSummary): { lines: number; boss: RecapBoss | null } {
  return { lines: s.lines.length, boss: s.kind === "raid" ? s.raidBoss : null };
}
