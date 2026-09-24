"use client";

import { useEffect, useRef } from "react";
import { armSounds, playSound } from "@/lib/sound/sound-manager";
import { useBattleEvents } from "./battle-provider";
import { OVERLAY_TIMING } from "./hit-overlay";
import { BOSS_ATTACK_IMPACT_MS } from "@/lib/rpg/hero-stage";

/**
 * Sound effects for the battle event stream: the one place events become
 * sounds (playing goes through lib/sound/sound-manager). Renders nothing.
 * Mount once inside each page's <BattleProvider>.
 *
 * Own hits sound on the hit overlay's beats (the attack on "impact", the
 * fanfare on "ko") so they land with the picture; hits and defeats the
 * overlay doesn't show (someone else's, the nightly reset, a refetch) sound
 * when the event arrives. A missed quest's party damage sounds on the
 * boss's blow (BOSS_ATTACK_IMPACT_MS after the miss, as the hero's flinch
 * peaks); its minGapMs still applies, checked when it plays.
 */
export function BattleSounds({ childId }: { childId: string }) {
  useEffect(() => armSounds(), []);

  // Delayed sounds (party damage on the blow), cancelled on unmount.
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());
  useEffect(() => {
    const pending = timers.current;
    return () => pending.forEach(clearTimeout);
  }, []);

  // Bosses this player hit recently: their defeat gets its sound from the
  // overlay's K.O. beat instead.
  const ownHits = useRef(new Map<string, number>());

  useBattleEvents((event) => {
    switch (event.type) {
      case "damage":
        if (event.childId === childId) ownHits.current.set(event.bossId, Date.now());
        else playSound("attack");
        return;
      case "defeated": {
        const hitAt = ownHits.current.get(event.boss.id);
        if (hitAt === undefined || Date.now() - hitAt > OVERLAY_TIMING.recent) playSound("bossDefeated");
        return;
      }
      case "miss": {
        const t = setTimeout(() => {
          timers.current.delete(t);
          playSound("partyDamage");
        }, BOSS_ATTACK_IMPACT_MS);
        timers.current.add(t);
        return;
      }
      case "moment":
        switch (event.name) {
          case "quest_complete":
            playSound("questComplete");
            return;
          case "quest_dropped":
            playSound("dragDrop");
            return;
          case "impact":
            playSound("attack");
            return;
          case "ko":
            playSound("bossDefeated");
            return;
          case "celebration":
            playSound(event.kind === "level_up" ? "levelUp" : "streakMilestone");
            return;
          case "purchase":
          case "potion":
            playSound("itemPurchased");
            return;
          // The recap stages its own blow and emits this as it lands.
          case "party_hit":
            playSound("partyDamage");
            return;
        }
    }
  });

  return null;
}
