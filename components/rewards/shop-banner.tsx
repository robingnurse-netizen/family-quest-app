"use client";

import Link from "next/link";
import type { StoreData } from "@/lib/rewards/fetch-store";
import { shopProgress } from "@/lib/rewards/progress";
import { useRewardStore } from "@/lib/hooks/use-reward-store";
import { CoinIcon } from "@/components/ui/icons";
import { GameHeading } from "@/components/ui/game-heading";
import { pixelButtonClass } from "@/components/ui/pixel-button";
import { GoldBar } from "./gold-bar";

/**
 * The dashboard's way into the shop: a merchant's stall (striped awning,
 * wooden front, carved sign) that also motivates — live gold, and either
 * how many rewards he can already afford or how close the cheapest one
 * he can't is.
 */
export function ShopBanner({
  familyId,
  childId,
  initial,
}: {
  familyId: string;
  childId: string;
  initial: StoreData;
}) {
  const store = useRewardStore({ familyId, childId, initial });
  const gold = store.gold ?? 0;
  const p = shopProgress(store.rewards, gold);

  return (
    <section aria-label="Item shop" className="shop-stall">
      <div aria-hidden className="shop-awning" />
      <div className="panel panel-wood rounded-t-none px-4 pb-4 pt-5">
        <div className="flex flex-wrap items-center gap-3">
          <span className="carved-sign rounded-[3px] px-3 py-1">
            <GameHeading as="h2" size="md">
              Item Shop
            </GameHeading>
          </span>
          <p className="flex items-center gap-1.5 text-xl font-black tabular-nums text-gold text-shadow-pixel">
            <CoinIcon className="h-6 w-6" />
            {gold}
            <span className="sr-only"> gold</span>
          </p>
          <Link href="/player/store" className={`${pixelButtonClass("gold", "md")} ml-auto`}>
            Browse wares
          </Link>
        </div>

        <div className="mt-3">
          {p.total === 0 ? (
            <p className="font-bold">The merchant is restocking — check back soon!</p>
          ) : p.affordable > 0 ? (
            <p className="font-extrabold text-gold text-shadow-pixel">
              {p.affordable} reward{p.affordable === 1 ? "" : "s"} within reach!
            </p>
          ) : (
            p.next && (
              <>
                <p className="mb-1.5 font-bold">
                  <span className="font-black text-gold text-shadow-pixel">{p.needed} more gold</span> to{" "}
                  {p.next.title}
                </p>
                <GoldBar value={p.progress} label={`Gold toward ${p.next.title}`} current={gold} max={p.next.gold_cost} />
              </>
            )
          )}
        </div>
      </div>
    </section>
  );
}
