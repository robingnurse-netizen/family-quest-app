"use client";

import { useState, useTransition } from "react";
import type { Reward, RewardRedemption } from "@/lib/supabase/types";
import type { StoreData } from "@/lib/rewards/fetch-store";
import type { RedeemAction } from "@/lib/rewards/types";
import { rewardIcon } from "@/lib/rewards/icons";
import { formatRequestTime } from "@/lib/rewards/format";
import { useRewardStore } from "@/lib/hooks/use-reward-store";
import { Modal } from "@/components/ui/modal";
import { CoinIcon } from "@/components/ui/icons";
import { Panel } from "@/components/ui/panel";
import { PixelButton } from "@/components/ui/pixel-button";
import { GameHeading } from "@/components/ui/game-heading";

const RECENT_LIMIT = 6;

/**
 * The player's rewards store, live via Realtime: spendable gold up top,
 * active rewards to redeem, requests waiting on a parent, and recent
 * results (a denial shows its refund, and the gold comes back live).
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
  const gold = store.gold ?? 0;
  const [confirming, setConfirming] = useState<Reward | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const available = store.rewards.filter((r) => r.active);
  const waiting = store.redemptions.filter((r) => r.status === "pending" || r.status === "approved");
  const recent = store.redemptions
    .filter((r) => r.status === "fulfilled" || r.status === "denied")
    .slice(0, RECENT_LIMIT);
  const waitingFor = (rewardId: string) => waiting.filter((r) => r.reward_id === rewardId).length;

  return (
    <div className="space-y-6">
      {/* Spendable gold: the headline number here. */}
      <Panel as="section" variant="stone" aria-label="Your gold" className="flex items-center gap-4 p-5">
        <CoinIcon className="h-14 w-14 shrink-0" />
        <div>
          <p className="font-display text-base font-semibold uppercase tracking-wide text-stone-text">Your gold</p>
          <p aria-live="polite" className="font-display text-5xl font-semibold leading-none text-gold tabular-nums text-shadow-pixel">
            {gold}
          </p>
        </div>
      </Panel>

      {notice && (
        <p role="status" className="panel panel-parchment border-l-8 border-l-party px-4 py-3 font-bold">
          {notice}
        </p>
      )}

      {waiting.length > 0 && (
        <section>
          <GameHeading size="sm" className="mb-2 uppercase tracking-wide">
            Waiting for a grown-up
          </GameHeading>
          <ul className="space-y-2">
            {waiting.map((r) => (
              <WaitingRow key={r.id} redemption={r} reward={store.rewardsById[r.reward_id]} timeZone={timeZone} />
            ))}
          </ul>
        </section>
      )}

      <section>
        <GameHeading size="sm" className="mb-2 uppercase tracking-wide">
          Rewards
        </GameHeading>
        {available.length === 0 ? (
          <p className="panel panel-parchment p-6 text-center">
            No rewards in the store yet — ask a grown-up to add some!
          </p>
        ) : (
          <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {available.map((reward) => (
              <RewardCard
                key={reward.id}
                reward={reward}
                gold={gold}
                requested={waitingFor(reward.id)}
                onRedeem={() => {
                  setNotice(null);
                  setConfirming(reward);
                }}
              />
            ))}
          </ul>
        )}
      </section>

      {recent.length > 0 && (
        <section>
          <GameHeading size="sm" className="mb-2 uppercase tracking-wide">
            Recently
          </GameHeading>
          <ul className="panel panel-stone divide-y-2 divide-stone-edge px-4">
            {recent.map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-3 py-2.5">
                <span className="min-w-0 truncate">
                  <span aria-hidden>{rewardIcon(store.rewardsById[r.reward_id]?.icon)} </span>
                  {store.rewardsById[r.reward_id]?.title ?? "Reward"}
                </span>
                {r.status === "fulfilled" ? (
                  <span className="shrink-0 font-bold text-party-text">Enjoy it! ✓</span>
                ) : (
                  <span className="shrink-0 text-stone-text">Not this time · +{r.gold_spent} gold back</span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      <Modal
        open={confirming !== null}
        onClose={() => setConfirming(null)}
        title={confirming ? `${rewardIcon(confirming.icon)} ${confirming.title}` : ""}
        className="panel panel-parchment backdrop:bg-black/60"
        titleClassName="font-display text-xl font-semibold text-ink"
        closeClassName="text-ink-soft"
      >
        {confirming && (
          <ConfirmRedeem
            reward={confirming}
            gold={gold}
            redeem={redeem}
            onCancel={() => setConfirming(null)}
            onDone={(redemption, newGold) => {
              store.upsertRedemption(redemption);
              store.setGold(newGold);
              setConfirming(null);
              setNotice(`Request sent! A grown-up will sort out your ${confirming.title}.`);
            }}
          />
        )}
      </Modal>
    </div>
  );
}

function RewardCard({
  reward,
  gold,
  requested,
  onRedeem,
}: {
  reward: Reward;
  gold: number;
  requested: number;
  onRedeem: () => void;
}) {
  const affordable = gold >= reward.gold_cost;
  return (
    <Panel as="li" variant="parchment" className="flex flex-col p-4">
      <div className="flex items-start gap-3">
        <span aria-hidden className="text-4xl leading-none">
          {rewardIcon(reward.icon)}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-lg font-black leading-tight">{reward.title}</p>
          {reward.description && <p className="mt-1 text-ink-soft">{reward.description}</p>}
        </div>
      </div>
      <div className="mt-auto flex items-center justify-between gap-2 pt-4">
        <p className="flex items-center gap-1.5 text-xl font-black text-gold-ink tabular-nums">
          <CoinIcon className="h-5 w-5" />
          {reward.gold_cost}
          <span className="sr-only"> gold</span>
        </p>
        <div className="flex flex-wrap items-center justify-end gap-2">
          {requested > 0 && (
            <span className="rounded-[3px] border-2 border-dashed border-ink-soft px-2 py-0.5 text-sm font-bold text-ink-soft">
              ⏳ Requested{requested > 1 ? ` ×${requested}` : ""}
            </span>
          )}
          <PixelButton
            variant="primary"
            onClick={onRedeem}
            disabled={!affordable}
            aria-label={
              affordable
                ? `Redeem ${reward.title} for ${reward.gold_cost} gold`
                : `${reward.title}: need ${reward.gold_cost - gold} more gold`
            }
          >
            {affordable ? (
              "Redeem"
            ) : (
              <>
                Need <span className="font-body font-black">{reward.gold_cost - gold}</span> more
              </>
            )}
          </PixelButton>
        </div>
      </div>
    </Panel>
  );
}

function WaitingRow({
  redemption: r,
  reward,
  timeZone,
}: {
  redemption: RewardRedemption;
  reward?: Reward;
  timeZone: string;
}) {
  const approved = r.status === "approved";
  return (
    <Panel as="li" variant="parchment" className="flex items-center gap-3 p-3">
      <span aria-hidden className="text-3xl leading-none">
        {rewardIcon(reward?.icon)}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate font-extrabold">{reward?.title ?? "Reward"}</p>
        <p className="text-sm text-ink-soft">
          {r.gold_spent} gold · {formatRequestTime(r.redeemed_at, timeZone)}
        </p>
      </div>
      <span
        // A stamped status: blue once approved, gold while waiting.
        className={`shrink-0 rounded-[3px] border-2 px-2 py-1 text-sm font-black ${
          approved ? "border-[#1864ab] bg-[#d0ebff] text-[#0b3d6e]" : "border-[#8a5a00] bg-gold text-ink"
        }`}
      >
        {approved ? "Approved! Coming soon" : "⏳ Waiting"}
      </span>
    </Panel>
  );
}

function ConfirmRedeem({
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
      <p>
        Spend <strong className="text-gold-ink">{reward.gold_cost} gold</strong>? You&apos;ll have{" "}
        <strong className="text-gold-ink">{gold - reward.gold_cost}</strong> left. A grown-up will say yes
        or no — if it&apos;s a no, you get the gold back.
      </p>
      {error && (
        <p role="alert" className="rounded-[3px] border-2 border-danger bg-[#fff0f0] px-3 py-2 font-bold">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <PixelButton variant="stone" onClick={onCancel}>
          Not yet
        </PixelButton>
        <PixelButton variant="primary" onClick={confirm} disabled={pending || gold < reward.gold_cost}>
          {pending ? "Sending…" : "Yes, redeem!"}
        </PixelButton>
      </div>
    </div>
  );
}
