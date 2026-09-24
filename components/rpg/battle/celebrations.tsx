"use client";

import { useEffect, useState } from "react";
import { FlameIcon, StarIcon } from "@/components/ui/icons";
import { useBattleContext, useBattleEvents } from "./battle-provider";

/** How long each celebration card stays up (ms). */
const CARD_MS = 2600;

type Celebration = { id: number; kind: "level_up"; level: number } | { id: number; kind: "streak"; days: number };

/**
 * LEVEL UP! and streak-milestone cards. Listens for the "level_up" and
 * "streak_milestone" moments (emitted by the battle scene's live stats) and
 * shows them one at a time — only while no hit sequence or recap is
 * playing, so a level gained by a hit appears after it and the "while you
 * were away" recap always comes first. Reduced motion: fade only.
 */
export function Celebrations() {
  const { overlayActive, recapActive, emit } = useBattleContext();
  const [queue, setQueue] = useState<Celebration[]>([]);
  const [showing, setShowing] = useState<Celebration | null>(null);

  useBattleEvents((event) => {
    if (event.type !== "moment") return;
    if (event.name === "level_up") setQueue((q) => [...q, { id: Date.now(), kind: "level_up", level: event.level }]);
    if (event.name === "streak_milestone") setQueue((q) => [...q, { id: Date.now() + 1, kind: "streak", days: event.days }]);
  });

  // Next card once the stage is clear.
  if (!showing && !overlayActive && !recapActive && queue.length > 0) {
    setShowing(queue[0]);
    setQueue(queue.slice(1));
  }
  useEffect(() => {
    if (!showing) return;
    // The card is up: its sound plays now, not when the level was gained.
    emit({ type: "moment", name: "celebration", kind: showing.kind === "streak" ? "streak_milestone" : "level_up" });
    const t = setTimeout(() => setShowing(null), CARD_MS);
    return () => clearTimeout(t);
  }, [showing, emit]);

  const announcement = !showing
    ? ""
    : showing.kind === "level_up"
      ? `Level up! You're now level ${showing.level}.`
      : `${showing.days}-day streak! Keep it going.`;

  return (
    <>
      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>
      {showing && (
        <div aria-hidden className="pointer-events-none fixed inset-0 z-40 flex items-center justify-center p-4">
          <div key={showing.id} className="celebration-card panel panel-stone px-6 py-5 text-center">
            {showing.kind === "level_up" ? (
              <>
                <p className="flex items-center justify-center gap-2 font-display text-4xl font-semibold text-gold text-shadow-pixel sm:text-5xl">
                  <StarIcon className="h-9 w-9" /> Level up! <StarIcon className="h-9 w-9" />
                </p>
                {/* Numbers in the body font (Stage 1's digit rule). */}
                <p className="mt-2 font-black text-parchment">
                  You&apos;re now <span className="text-3xl text-gold">level {showing.level}</span>
                </p>
              </>
            ) : (
              <>
                <p className="flex items-center justify-center gap-2 text-4xl font-black text-gold text-shadow-pixel">
                  <FlameIcon className="h-10 w-10" />
                  {showing.days}
                  <span className="font-display text-3xl font-semibold">day streak!</span>
                </p>
                <p className="mt-2 font-bold text-parchment">Every quest done, day after day. Keep it going!</p>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
