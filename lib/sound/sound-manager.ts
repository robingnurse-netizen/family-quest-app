// The one place sound effects are played from (Howler). Components never
// touch Howler: they call playSound(name), and the battle event stream is
// mapped to sounds in components/rpg/battle/battle-sounds.tsx. The sound
// list, volumes, rate limits and the mute store live in ./sound-rules.
//
// Loading: Howler and the files (~5 MB of WAVs) are fetched on the first
// pointer/key press anywhere on the page (armSounds), not on page load —
// and not at all while muted. That first press is also the user gesture
// browsers want before audio may play (Howler unlocks on it).

import { useSyncExternalStore } from "react";
import type { Howl } from "howler";
import { createNoRepeatPicker } from "@/lib/random";
import { SOUNDS, createMuteStore, createSoundGate, type SoundName } from "./sound-rules";

/** A sound whose file is still loading this long after it was asked for is
 *  dropped — a late effect is worse than none. */
const STALE_MS = 800;

const muteStore = createMuteStore(() => (typeof window === "undefined" ? null : window.localStorage));
const gate = createSoundGate();
const pickers = Object.fromEntries(
  Object.entries(SOUNDS).map(([name, spec]) => [name, createNoRepeatPicker(spec.files.length)]),
) as Record<SoundName, () => number>;

let loading: Promise<Record<SoundName, Howl[]>> | null = null;

function load() {
  loading ??= import("howler").then(({ Howl, Howler }) => {
    Howler.mute(muteStore.isMuted());
    muteStore.subscribe(() => Howler.mute(muteStore.isMuted()));
    return Object.fromEntries(
      Object.entries(SOUNDS).map(([name, spec]) => [
        name,
        spec.files.map((src) => new Howl({ src: [src], volume: spec.volume })),
      ]),
    ) as Record<SoundName, Howl[]>;
  });
  return loading;
}

/** Play a sound effect (no-op while muted, on the server, or rate-limited). */
export function playSound(name: SoundName) {
  if (typeof window === "undefined" || muteStore.isMuted()) return;
  const requestedAt = Date.now();
  if (!gate(name, requestedAt)) return;
  const index = pickers[name]();
  void load().then((howls) => {
    const howl = howls[name][index];
    const fresh = () => Date.now() - requestedAt < STALE_MS;
    if (howl.state() === "loaded") {
      if (fresh()) howl.play();
    } else {
      howl.once("load", () => {
        if (fresh()) howl.play();
      });
    }
  });
}

/**
 * Start loading on the first user gesture (call once from a component that's
 * on every page with sounds). Returns a cleanup.
 */
export function armSounds() {
  const events = ["pointerdown", "keydown"] as const;
  const start = () => {
    if (!muteStore.isMuted()) void load();
    stop();
  };
  const stop = () => events.forEach((e) => window.removeEventListener(e, start, true));
  events.forEach((e) => window.addEventListener(e, start, { capture: true, passive: true }));
  return stop;
}

export function isSoundMuted() {
  return muteStore.isMuted();
}

export function setSoundMuted(muted: boolean) {
  muteStore.setMuted(muted);
  // Unmuting is a click: a fine moment to start loading.
  if (!muted) void load();
}

/** The mute setting, live (persisted in localStorage). */
export function useSoundMuted() {
  return useSyncExternalStore(muteStore.subscribe, muteStore.isMuted, () => false);
}
