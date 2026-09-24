// "While you were away": the nightly resets since the player last saw a
// recap (reset_recaps rows), combined into one short story and its lines.
// Pure (no React) — components/rpg/battle/recap.tsx stages it and
// tests/recap.test.mjs checks it.

import type { BossTier, ResetRecap } from "@/lib/supabase/types";

export type RecapBoss = { id: string; name: string; sprite_key: string; tier: BossTier };

export type RecapRow = Pick<
  ResetRecap,
  | "created_at"
  | "day_from"
  | "day_to"
  | "missed_quests"
  | "missed_minutes"
  | "party_damage"
  | "boss_id"
  | "perfect_days"
  | "healed"
  | "streak_before"
  | "streak_after"
  | "knocked_out"
  | "escaped_boss_id"
  | "next_boss_id"
  | "hp_before"
  | "hp_after"
  | "max_hp"
>;

/**
 * How the recap plays: "blow" (the boss hits the party: lunge, flinch, one
 * damage number), "text" (misses with no boss around: no blow), "perfect"
 * (no misses: a brief, positive card).
 */
export type RecapKind = "blow" | "text" | "perfect";

export type RecapSummary = {
  kind: RecapKind;
  /** Newest row's created_at: acknowledge up to here. */
  through: string;
  nights: number;
  /** "Yesterday" (one night, yesterday) or "Since you were last here". */
  when: string;
  missedQuests: number;
  missedMinutes: number;
  /** Party damage, all nights together (one number on screen). */
  damage: number;
  /** The boss that dealt it (the first damaging night's). */
  attacker: RecapBoss | null;
  knockedOut: boolean;
  escaped: RecapBoss | null;
  /** Who arrived after the escape (null: none left, or no escape). */
  next: RecapBoss | null;
  streakLost: boolean;
  perfectDays: number;
  healed: number;
  hpBefore: number;
  hpAfter: number;
  maxHp: number;
  /** The story, in order, then the closing line. */
  lines: string[];
  /** When each line appears: with the blow / start, the boss leaving, the
   *  next boss arriving, or the heal (so the text never runs ahead). */
  cues: RecapCue[];
  closing: string;
};

export type RecapCue = "start" | "escape" | "enter" | "heal";

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * Combine unseen recap rows (any order) into one summary, or null if there's
 * nothing to show. `yesterday` is the family's yesterday (YYYY-MM-DD).
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
  const sum = (key: "missed_quests" | "missed_minutes" | "party_damage" | "perfect_days" | "healed") =>
    nights.reduce((n, r) => n + r[key], 0);
  const boss = (id: string | null) => (id ? (bosses[id] ?? null) : null);

  const missedQuests = sum("missed_quests");
  const missedMinutes = sum("missed_minutes");
  const damage = sum("party_damage");
  const perfectDays = sum("perfect_days");
  const healed = sum("healed");
  const ko = [...nights].reverse().find((r) => r.knocked_out);
  const attackerId = nights.find((r) => r.party_damage > 0)?.boss_id ?? null;

  const oneNight = nights.length === 1 && first.day_from === yesterday && first.day_to === yesterday;
  const when = oneNight ? "Yesterday" : "Since you were last here";

  const kind: RecapKind = damage > 0 ? "blow" : missedQuests > 0 ? "text" : "perfect";
  const summary: Omit<RecapSummary, "lines" | "cues" | "closing"> = {
    kind,
    through: last.created_at,
    nights: nights.length,
    when,
    missedQuests,
    missedMinutes,
    damage,
    attacker: boss(attackerId),
    knockedOut: Boolean(ko),
    escaped: boss(ko?.escaped_boss_id ?? null),
    next: boss(ko?.next_boss_id ?? null),
    streakLost: nights.some((r) => r.streak_before > 0 && r.streak_after === 0),
    perfectDays,
    healed,
    hpBefore: first.hp_before,
    hpAfter: last.hp_after,
    maxHp: last.max_hp,
  };
  return { ...summary, ...recapText(summary) };
}

/** The recap's lines: short, kid-friendly, in the order things happened. */
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
  if (s.missedQuests > 0) {
    const took = s.damage > 0 ? ` The party took ${s.damage} damage.` : "";
    say(`${s.when}: ${plural(s.missedQuests, "quest")} missed (${s.missedMinutes} min).${took}`, "start");
  } else if (s.damage > 0) {
    // Someone else's misses (a brother or sister) still hurt the party.
    say(`${s.when}: the party took ${s.damage} damage.`, "start");
  }
  if (s.streakLost) say("Streak lost.", "start");
  if (s.knockedOut) {
    say(`The party was knocked out${s.escaped ? ` — ${s.escaped.name} got away!` : "!"}`, "escape");
    if (s.next) say(`A new foe appears: ${s.next.name}!`, "enter");
  }
  if (s.perfectDays > 0) {
    const days = s.perfectDays === 1 ? "Perfect day!" : `${s.perfectDays} perfect days!`;
    say(s.healed > 0 ? `${days} Party healed ${s.healed} HP.` : days, s.healed > 0 ? "heal" : "start");
  }

  const closing =
    s.kind === "perfect"
      ? "Keep it up!"
      : s.knockedOut && s.next
        ? "New day — new foe. Let's go!"
        : s.damage > 0
          ? "New day — let's get him back!"
          : "New day — let's go!";
  return { lines, cues, closing };
}

// --- Staging ------------------------------------------------------------------

/** Every duration in the recap, in ms — tune here. */
export const RECAP_TIMING = {
  /** Card up, the party and the boss standing, before the boss attacks. */
  lead: 900,
  /** Boss attack → its blow lands (the lunge's peak; BOSS_ATTACK_IMPACT_MS). */
  impact: 210,
  /** After the blow: he falls (knocked out)… */
  koAfter: 800,
  /** …the K.O. animation (9 frames at 10fps). */
  koMs: 900,
  /** The boss sliding off (.boss-fx-escaped). */
  escapeMs: 1400,
  /** The next boss arriving (.boss-enter) before the party refills. */
  enterMs: 700,
  /** Getting up: the K.O. in reverse. */
  riseMs: 900,
  /** After the blow, the heal (a perfect day) lands. */
  healAfter: 1100,
  /** Between lines of text. */
  lineGap: 650,
} as const;

export type RecapBeat =
  | { at: number; kind: "attack" | "blow" | "boss_idle" | "ko" | "down" | "escape" | "enter" | "refill" | "rise" | "stand" | "heal" }
  | { at: number; kind: "line"; index: number }
  | { at: number; kind: "closing" };

/**
 * The recap's animated part: when each beat happens (ms from the start), in
 * order, ending with "closing" — the summary card is then complete (every
 * line and the closing line) and stays up until he taps Continue; nothing
 * closes by itself. A tap before that skips straight to the summary
 * (recapFinalState). A blow: attack → blow (sound, one damage number) →
 * [knocked out: fall, the boss leaves, the next one arrives, refill, he
 * gets up] → heal. No blow ("text" / "perfect"): just the lines, and a
 * heal for perfect days.
 */
export function recapSchedule(s: RecapSummary): RecapBeat[] {
  const T = RECAP_TIMING;
  const beats: RecapBeat[] = [];
  let t = 0;
  let textFrom: number;
  const lineAt: number[] = [];

  if (s.kind === "blow") {
    t = T.lead;
    beats.push({ at: t, kind: "attack" });
    t += T.impact;
    beats.push({ at: t, kind: "blow" });
    beats.push({ at: t + 500, kind: "boss_idle" });
    textFrom = t;
    if (s.knockedOut) {
      t += T.koAfter;
      beats.push({ at: t, kind: "ko" });
      t += T.koMs;
      beats.push({ at: t, kind: "down" });
      beats.push({ at: t, kind: "escape" });
      t += T.escapeMs;
      beats.push({ at: t, kind: "enter" });
      t += T.enterMs;
      beats.push({ at: t, kind: "refill" });
      beats.push({ at: t, kind: "rise" });
      t += T.riseMs;
      beats.push({ at: t, kind: "stand" });
    }
    if (s.healed > 0) {
      t = Math.max(t, textFrom + T.healAfter);
      beats.push({ at: t, kind: "heal" });
    }
  } else {
    textFrom = 400;
    if (s.healed > 0) beats.push({ at: textFrom + 300, kind: "heal" });
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
 * reduced motion): final party HP, every line, and whoever stands on stage
 * (the next boss after a knock-out, or none if it escaped with no one to
 * follow; otherwise the boss that struck).
 */
export function recapFinalState(s: RecapSummary): { hp: number; lines: number; boss: RecapBoss | null } {
  return {
    hp: s.hpAfter,
    lines: s.lines.length,
    boss: s.knockedOut ? s.next : s.kind === "blow" ? s.attacker : null,
  };
}
