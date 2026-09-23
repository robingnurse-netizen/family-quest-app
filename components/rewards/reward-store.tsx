"use client";

import { useRef, useState, useTransition } from "react";
import type { Reward, RewardRedemption } from "@/lib/supabase/types";
import type { StoreData } from "@/lib/rewards/fetch-store";
import type { RedeemAction } from "@/lib/rewards/types";
import { formatRequestTime } from "@/lib/rewards/format";
import { progressTo } from "@/lib/rewards/progress";
import { useRewardStore } from "@/lib/hooks/use-reward-store";
import { useBattleContext } from "@/components/rpg/battle/battle-provider";
import { Modal } from "@/components/ui/modal";
import { CoinIcon, CoinStackIcon, PadlockIcon } from "@/components/ui/icons";
import { PixelButton } from "@/components/ui/pixel-button";
import { GameHeading } from "@/components/ui/game-heading";
import { WaxSeal } from "@/components/ui/wax-seal";
import { RewardIcon } from "./reward-icon";
import { GoldBar } from "./gold-bar";

const LEDGER_LIMIT = 10;

type Flight = { id: number; from: DOMRect; to: DOMRect };

/**
 * The item shop, live via Realtime: the coin purse (spendable gold), rewards
 * as items on wooden shelves with parchment price tags, requests waiting on
 * a grown-up as sealed parcels, and a ledger of what happened to earlier
 * requests. Buying goes through the same redeem action and database checks
 * as before; on success coins fly from the purse to the item and a
 * "purchase" moment is emitted for sound effects.
 */
export function RewardStore({
  familyId,
  childId,
  timeZone,
  initial,
  redeem,
}: {
  familyId: string;
  childId: string;
  timeZone: string;
  initial: StoreData;
  redeem: RedeemAction;
}) {
  const store = useRewardStore({ familyId, childId, initial });
  const { emit } = useBattleContext();
  const gold = store.gold ?? 0;
  const [confirming, setConfirming] = useState<Reward | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [flights, setFlights] = useState<Flight[]>([]);
  const purseRef = useRef<HTMLDivElement>(null);
  const shelfRef = useRef<HTMLUListElement>(null);

  const available = store.rewards.filter((r) => r.active);
  const pending = store.redemptions.filter((r) => r.status === "pending");
  const ledger = store.redemptions.filter((r) => r.status !== "pending").slice(0, LEDGER_LIMIT);
  const requestedCount = (rewardId: string) =>
    store.redemptions.filter((r) => r.reward_id === rewardId && (r.status === "pending" || r.status === "approved"))
      .length;

  function flyCoins(rewardId: string) {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const from = purseRef.current?.getBoundingClientRect();
    const to = shelfRef.current?.querySelector(`[data-reward-id="${rewardId}"] .item-slot`)?.getBoundingClientRect();
    if (from && to) setFlights((f) => [...f, { id: Date.now(), from, to }]);
  }

  return (
    <div className="space-y-6">
      {/* The coin purse: spendable gold, the headline number here. */}
      <div ref={purseRef} className="panel panel-stone flex items-center gap-4 p-4 sm:p-5">
        <CoinStackIcon className="h-16 w-16 shrink-0" />
        <div>
          <p className="font-display text-base font-semibold uppercase tracking-wide text-stone-text">Coin purse</p>
          {/* Numbers in the body font (Stage 1's digit rule). */}
          <p aria-live="polite" className="text-5xl font-black leading-none tabular-nums text-gold text-shadow-pixel">
            {gold}
            <span className="ml-2 font-display text-2xl font-semibold">gold</span>
          </p>
        </div>
      </div>

      {notice && (
        <p role="status" className="panel panel-parchment border-l-8 border-l-party px-4 py-3 font-bold">
          {notice}
        </p>
      )}

      {pending.length > 0 && (
        <section>
          <GameHeading size="sm" className="mb-2 uppercase tracking-wide">
            Waiting for a grown-up
          </GameHeading>
          <ul className="grid gap-3 sm:grid-cols-2">
            {pending.map((r) => (
              <Parcel key={r.id} redemption={r} reward={store.rewardsById[r.reward_id]} timeZone={timeZone} />
            ))}
          </ul>
        </section>
      )}

      <section>
        <GameHeading size="sm" className="mb-2 uppercase tracking-wide">
          Wares
        </GameHeading>
        {available.length === 0 ? (
          <p className="panel panel-parchment p-6 text-center">
            The shelves are empty — ask a grown-up to add some rewards!
          </p>
        ) : (
          <div className="shop-wall rounded-[3px] px-2 pb-3 pt-4 sm:px-4">
            <ul ref={shelfRef} className="grid grid-cols-2 gap-y-6 sm:grid-cols-3">
              {available.map((reward) => (
                <ShelfItem
                  key={reward.id}
                  reward={reward}
                  gold={gold}
                  requested={requestedCount(reward.id)}
                  onBuy={() => {
                    setNotice(null);
                    setConfirming(reward);
                  }}
                />
              ))}
            </ul>
          </div>
        )}
      </section>

      {ledger.length > 0 && (
        <section>
          <GameHeading size="sm" className="mb-2 uppercase tracking-wide">
            Ledger
          </GameHeading>
          <ul className="ledger panel panel-parchment divide-y-2 divide-dashed divide-parchment-edge/60 px-3 sm:px-4">
            {ledger.map((r) => (
              <LedgerRow key={r.id} redemption={r} reward={store.rewardsById[r.reward_id]} timeZone={timeZone} />
            ))}
          </ul>
        </section>
      )}

      <Modal
        open={confirming !== null}
        onClose={() => setConfirming(null)}
        title={confirming?.title ?? ""}
        className="panel panel-parchment backdrop:bg-black/60"
        titleClassName="font-display text-xl font-semibold text-ink"
        closeClassName="text-ink-soft"
      >
        {confirming && (
          <ConfirmBuy
            reward={confirming}
            gold={gold}
            redeem={redeem}
            onCancel={() => setConfirming(null)}
            onDone={(redemption, newGold) => {
              const bought = confirming;
              store.upsertRedemption(redemption);
              store.setGold(newGold);
              setConfirming(null);
              flyCoins(bought.id);
              emit({ type: "moment", name: "purchase", rewardId: bought.id, cost: redemption.gold_spent });
              setNotice(`Sent to a grown-up! They'll sort out your ${bought.title}.`);
            }}
          />
        )}
      </Modal>

      {flights.map((f) => (
        <CoinFlight
          key={f.id}
          from={f.from}
          to={f.to}
          onDone={() => setFlights((all) => all.filter((x) => x.id !== f.id))}
        />
      ))}
    </div>
  );
}

/**
 * One reward on the shelf: its item slot sitting on the plank, a parchment
 * price tag hanging on a string, then its name and either a gold Buy button
 * or — dimmed with a padlock — how much more gold it needs. The upper part
 * is a fixed height, so neighbouring planks line up into one shelf.
 */
function ShelfItem({
  reward,
  gold,
  requested,
  onBuy,
}: {
  reward: Reward;
  gold: number;
  requested: number;
  onBuy: () => void;
}) {
  const affordable = gold >= reward.gold_cost;
  const need = reward.gold_cost - gold;
  return (
    <li data-reward-id={reward.id} className="flex min-w-0 flex-col">
      <div className="relative flex h-28 items-end justify-center">
        <div className={`relative ${affordable ? "" : "opacity-55 saturate-50"}`}>
          <RewardIcon value={reward.icon} variant="slot" size={44} />
          {!affordable && <PadlockIcon className="absolute -bottom-1 -right-2 h-6 w-6" />}
        </div>
        <PriceTag cost={reward.gold_cost} />
      </div>
      <div aria-hidden className="shelf-plank h-3.5" />
      <div className="flex flex-1 flex-col items-center px-1.5 pt-2 text-center sm:px-2">
        <p className="line-clamp-2 font-black leading-tight text-parchment">{reward.title}</p>
        {reward.description && (
          <p className="mt-0.5 line-clamp-2 text-sm text-parchment-dark">{reward.description}</p>
        )}
        {requested > 0 && (
          <p className="mt-1 text-sm font-bold text-gold">Requested{requested > 1 ? ` ×${requested}` : ""}</p>
        )}
        <div className="mt-auto w-full pt-2">
          {affordable ? (
            <PixelButton
              variant="gold"
              size="md"
              onClick={onBuy}
              className="w-full"
              aria-label={`Buy ${reward.title} for ${reward.gold_cost} gold`}
            >
              Buy
            </PixelButton>
          ) : (
            <div className="space-y-1">
              <p className="text-sm font-extrabold text-parchment">
                Need <span className="text-gold">{need}</span> more
              </p>
              <GoldBar
                size="sm"
                value={progressTo(reward, gold)}
                label={`${reward.title}: ${need} more gold needed`}
                current={gold}
                max={reward.gold_cost}
              />
            </div>
          )}
        </div>
      </div>
    </li>
  );
}

/** A parchment price tag hanging from the item on a string. */
function PriceTag({ cost }: { cost: number }) {
  return (
    <span className="price-tag absolute right-1 top-1 flex items-center gap-1 px-2 py-0.5 text-base font-black tabular-nums text-ink sm:right-3">
      <CoinIcon className="h-4 w-4" />
      {cost}
      <span className="sr-only"> gold</span>
    </span>
  );
}

/** A request waiting on a grown-up: a wrapped parcel with a wax seal. */
function Parcel({
  redemption: r,
  reward,
  timeZone,
}: {
  redemption: RewardRedemption;
  reward?: Reward;
  timeZone: string;
}) {
  return (
    <li className="panel panel-wood flex items-center gap-3 p-3">
      <span aria-hidden className="parcel relative flex h-16 w-20 shrink-0 items-center justify-center">
        <WaxSeal />
      </span>
      <div className="min-w-0">
        <p className="flex items-center gap-1.5 font-extrabold">
          <RewardIcon value={reward?.icon} size={20} />
          <span className="truncate">{reward?.title ?? "Reward"}</span>
        </p>
        <p className="font-bold text-gold text-shadow-pixel">Waiting for a grown-up</p>
        <p className="text-sm">
          {r.gold_spent} gold · {formatRequestTime(r.redeemed_at, timeZone)}
        </p>
      </div>
    </li>
  );
}

const STAMP: Record<Exclude<RewardRedemption["status"], "pending">, { label: string; className: string }> = {
  approved: { label: "Approved", className: "text-[#1864ab]" }, // 4.8:1 on parchment
  fulfilled: { label: "Fulfilled", className: "text-[#1e6b30]" }, // 5.1:1
  denied: { label: "Denied", className: "text-[#a61e1e]" }, // 5.8:1
};

/** One line in the ledger: what, when, the gold, and an ink stamp. */
function LedgerRow({
  redemption: r,
  reward,
  timeZone,
}: {
  redemption: RewardRedemption;
  reward?: Reward;
  timeZone: string;
}) {
  const stamp = r.status === "pending" ? null : STAMP[r.status];
  return (
    <li className="flex items-center gap-3 py-2.5">
      <RewardIcon value={reward?.icon} size={24} />
      <div className="min-w-0 flex-1">
        <p className="truncate font-extrabold">{reward?.title ?? "Reward"}</p>
        <p className="text-sm text-ink-soft">
          {r.gold_spent} gold · {formatRequestTime(r.redeemed_at, timeZone)}
          {r.status === "denied" && (
            <span className="font-bold text-[#1e6b30]"> · +{r.gold_spent} gold refunded</span>
          )}
        </p>
      </div>
      {stamp && <span className={`ink-stamp shrink-0 ${stamp.className}`}>{stamp.label}</span>}
    </li>
  );
}

function ConfirmBuy({
  reward,
  gold,
  redeem,
  onCancel,
  onDone,
}: {
  reward: Reward;
  gold: number;
  redeem: RedeemAction;
  onCancel: () => void;
  onDone: (redemption: RewardRedemption, gold: number) => void;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function confirm() {
    setError(null);
    startTransition(async () => {
      const result = await redeem(reward.id, reward.gold_cost);
      if (!result.ok) return setError(result.error);
      onDone(result.data.redemption, result.data.gold);
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <RewardIcon value={reward.icon} variant="slot" size={40} />
        <p>
          Spend <strong className="text-gold-ink">{reward.gold_cost} gold</strong>? You&apos;ll have{" "}
          <strong className="text-gold-ink">{gold - reward.gold_cost}</strong> left. A grown-up will say yes or
          no — if it&apos;s a no, you get the gold back.
        </p>
      </div>
      {error && (
        <p role="alert" className="rounded-[3px] border-2 border-danger bg-[#fff0f0] px-3 py-2 font-bold">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <PixelButton variant="stone" onClick={onCancel}>
          Not yet
        </PixelButton>
        <PixelButton variant="gold" onClick={confirm} disabled={pending || gold < reward.gold_cost}>
          {pending ? "Sending…" : "Buy it!"}
        </PixelButton>
      </div>
    </div>
  );
}

/** Coins arcing from the purse to the bought item (transforms/opacity only). */
function CoinFlight({ from, to, onDone }: { from: DOMRect; to: DOMRect; onDone: () => void }) {
  const dx = to.left + to.width / 2 - (from.left + from.width / 2);
  const dy = to.top + to.height / 2 - (from.top + from.height / 2);
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 z-50">
      {Array.from({ length: 7 }, (_, i) => (
        <CoinIcon
          key={i}
          className="coin-fly absolute h-7 w-7"
          style={
            {
              left: from.left + from.width / 2 - 14 + (i - 3) * 6,
              top: from.top + from.height / 2 - 14,
              "--dx": `${dx - (i - 3) * 6}px`,
              "--dy": `${dy}px`,
              animationDelay: `${i * 70}ms`,
            } as React.CSSProperties
          }
          onAnimationEnd={i === 6 ? onDone : undefined}
        />
      ))}
    </div>
  );
}
