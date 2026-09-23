// Sound effects: what plays, and the rules around it — no audio here.
// lib/sound/sound-manager.ts does the playing (Howler); this module is kept
// self-contained (no imports) so tests/sound.test.mjs can load it directly.

/** Every sound effect, by name. Files live in public/sounds/. */
export type SoundName =
  | "questComplete"
  | "attack"
  | "bossDefeated"
  | "levelUp"
  | "streakMilestone"
  | "partyDamage"
  | "itemPurchased"
  | "dragDrop";

export type SoundSpec = {
  /** One file, or a pool picked at random (never the same twice running). */
  files: string[];
  /** 0–1. The files aren't loudness-matched: tune by ear here. */
  volume: number;
  /**
   * The same sound again within this many ms is dropped. Overlap is fine;
   * a pile-up of the same sound isn't (rapid ticks, a batch of Realtime
   * rows). Sounds that are one-off events get a long gap.
   */
  minGapMs: number;
};

export const SOUNDS: Record<SoundName, SoundSpec> = {
  questComplete: { files: ["/sounds/quest-complete.wav"], volume: 0.7, minGapMs: 90 },
  attack: {
    files: [
      "/sounds/attack/1.wav",
      "/sounds/attack/2.wav",
      "/sounds/attack/3.wav",
      "/sounds/attack/4.wav",
      "/sounds/attack/5.wav",
      "/sounds/attack/6.mp3",
      "/sounds/attack/7.wav",
      "/sounds/attack/8.mp3",
    ],
    volume: 0.8,
    minGapMs: 120,
  },
  // A defeat can be reported twice (the overlay's K.O. beat and the boss
  // row); one fanfare per defeat.
  bossDefeated: { files: ["/sounds/boss-defeated.wav"], volume: 0.9, minGapMs: 4000 },
  levelUp: { files: ["/sounds/level-up.wav"], volume: 0.85, minGapMs: 1500 },
  streakMilestone: { files: ["/sounds/streak-milestone.wav"], volume: 0.85, minGapMs: 1500 },
  // The nightly reset logs one miss_penalty row per child at once.
  partyDamage: { files: ["/sounds/party-damage.wav"], volume: 0.75, minGapMs: 1500 },
  itemPurchased: { files: ["/sounds/item-purchased.wav"], volume: 0.8, minGapMs: 300 },
  dragDrop: { files: ["/sounds/drag-drop.wav"], volume: 0.5, minGapMs: 90 },
};

/**
 * Picks an index in [0, count) at random, never the one it picked last
 * (when there's more than one). `random` is injectable for tests.
 */
export function createNoRepeatPicker(count: number, random: () => number = Math.random) {
  let last = -1;
  // random() is in [0, 1); clamp anyway so a stray 1 can't overflow.
  const below = (n: number) => Math.min(n - 1, Math.floor(random() * n));
  return () => {
    if (count <= 1) return (last = 0);
    if (last < 0) return (last = below(count));
    // One of the other count − 1 indices: pick, then skip over the last one.
    const i = below(count - 1);
    return (last = i >= last ? i + 1 : i);
  };
}

/** Per-sound rate limit: `allow(name, now)` is false within its minGapMs. */
export function createSoundGate(specs: Record<string, { minGapMs: number }> = SOUNDS) {
  const lastAt = new Map<string, number>();
  return (name: string, now: number) => {
    const prev = lastAt.get(name);
    if (prev !== undefined && now - prev < (specs[name]?.minGapMs ?? 0)) return false;
    lastAt.set(name, now);
    return true;
  };
}

// --- Mute (persisted per browser) -------------------------------------------

export const MUTE_STORAGE_KEY = "fq:sound-muted";

type KeyValueStorage = Pick<Storage, "getItem" | "setItem">;

/**
 * The mute setting, persisted in `storage` (localStorage in the app). Storage
 * can be missing or throw (private mode, blocked site data): then it's
 * unmuted by default and a change still holds for this page.
 */
export function createMuteStore(storage: () => KeyValueStorage | null | undefined) {
  let muted: boolean | null = null;
  const listeners = new Set<() => void>();
  const read = () => {
    if (muted === null) {
      try {
        muted = storage()?.getItem(MUTE_STORAGE_KEY) === "1";
      } catch {
        muted = false;
      }
    }
    return muted;
  };
  return {
    isMuted: read,
    setMuted(next: boolean) {
      if (next === read()) return;
      muted = next;
      try {
        storage()?.setItem(MUTE_STORAGE_KEY, next ? "1" : "0");
      } catch {
        // Not persisted; still muted for this page.
      }
      for (const listener of [...listeners]) listener();
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
