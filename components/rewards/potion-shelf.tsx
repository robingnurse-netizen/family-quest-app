"use client";

import { useEffect, useState, useTransition } from "react";
import type { Potion } from "@/lib/supabase/types";
import type { BuyPotionAction } from "@/lib/potions/types";
import { useBattleContext } from "@/components/rpg/battle/battle-provider";
import { HudBar } from "@/components/rpg/battle/hud-bar";
import { CoinIcon, HeartIcon, PotionIcon } from "@/components/ui/icons";
import { GameHeading } from "@/components/ui/game-heading";
import { PixelButton } from "@/components/ui/pixel-button";

/**
 * Potions: bought with gold and drunk at once to heal the party — no
 * inventory and no grown-up (unlike the real-life rewards, which have their
 * own shelves below). Shows the party's live HP; a purchase pops a green
 * +N and refills the bar. The database prices and applies it
 * (buy_potion()); can't buy at full HP, never heals past max.
 */
export function PotionShelf({
  potions,
  gold,
  buy,
  onBought,
}: {
  potions: Potion[];
  gold: number;
  buy: BuyPotionAction;
  /** New gold balance after a purchase. */
  onBought: (gold: number) => void;
}) {
  const { party, refetch, emit } = useBattleContext();
  const [pending, startTransition] = useTransition();
  const [buying, setBuying] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [healPop, setHealPop] = useState<{ key: number; amount: number } | null>(null);
  // Straight from the purchase, until Realtime / the refetch catches up.
  const [boughtHp, setBoughtHp] = useState<number | null>(null);

  useEffect(() => {
    if (!healPop) return;
    const t = setTimeout(() => setHealPop(null), 1600);
    return () => clearTimeout(t);
  }, [healPop]);

  if (potions.length === 0 || !party) return null;
  const hp = boughtHp !== null && boughtHp > party.current_hp ? boughtHp : party.current_hp;
  const full = hp >= party.max_hp;

  function purchase(potion: Potion) {
    setError(null);
    setBuying(potion.id);
    startTransition(async () => {
      const result = await buy(potion.id, potion.gold_cost);
      setBuying(null);
      if (!result.ok) return setError(result.error);
      const r = result.data;
      onBought(r.gold);
      setBoughtHp(r.hp);
      setHealPop((h) => ({ key: (h?.key ?? 0) + 1, amount: r.healed }));
      emit({ type: "moment", name: "potion" });
      void refetch();
    });
  }

  return (
    <section aria-labelledby="potions-heading">
      <GameHeading id="potions-heading" size="sm" className="mb-1 uppercase tracking-wide">
        Potions
      </GameHeading>
      <p className="mb-2 text-sm text-world-text">Drink one now to heal the party. No grown-up needed.</p>
      <div className="panel panel-stone space-y-4 p-3 sm:p-4">
        <div className="relative">
          <HudBar
            label="Party HP"
            icon={<HeartIcon className="h-4 w-4 shrink-0" />}
            current={hp}
            max={party.max_hp}
            segments={10}
            tone="party"
          />
          {healPop && (
            <p
              key={healPop.key}
              aria-hidden
              className="heal-pop pointer-events-none absolute -top-6 right-2 font-body text-3xl font-black leading-none"
            >
              +{healPop.amount}
            </p>
          )}
          <p aria-live="polite" className="sr-only">
            {healPop ? `Party healed ${healPop.amount} HP.` : ""}
          </p>
        </div>

        {error && (
          <p role="alert" className="rounded-[3px] border-2 border-danger bg-[#fff0f0] px-3 py-2 font-bold text-ink">
            {error}
          </p>
        )}

        <ul className="grid gap-3 sm:grid-cols-2">
          {potions.map((potion, i) => {
            const need = potion.gold_cost - gold;
            const heals = Math.min(potion.heal_hp, party.max_hp - hp);
            return (
              <li key={potion.id} className="flex items-center gap-3 rounded-[3px] border-2 border-stone-edge bg-well p-3 shadow-[inset_2px_2px_0_rgb(0_0_0/0.5)]">
                <PotionIcon size={i === 0 ? "small" : "large"} className="h-12 w-12 shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="font-black leading-tight text-parchment">{potion.name}</p>
                  <p className="text-sm font-bold text-party-text">
                    Heals {potion.heal_hp} HP{!full && heals < potion.heal_hp ? ` (only ${heals} needed)` : ""}
                  </p>
                  <p className="flex items-center gap-1 text-sm font-black text-gold">
                    <CoinIcon className="h-4 w-4" />
                    {potion.gold_cost}
                    <span className="sr-only"> gold</span>
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  {full ? (
                    <p className="max-w-24 text-sm font-bold text-stone-text">Party at full health</p>
                  ) : need > 0 ? (
                    <p className="max-w-24 text-sm font-extrabold text-parchment">
                      Need <span className="text-gold">{need}</span> more
                    </p>
                  ) : (
                    <PixelButton
                      variant="gold"
                      onClick={() => purchase(potion)}
                      disabled={pending}
                      aria-label={`Buy and drink ${potion.name} for ${potion.gold_cost} gold: heals ${heals} HP`}
                    >
                      {buying === potion.id ? "…" : "Drink"}
                    </PixelButton>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
