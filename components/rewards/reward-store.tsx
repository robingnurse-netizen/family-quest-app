"use client";

import { useState, useTransition } from "react";
import type { Reward, RewardRedemption } from "@/lib/supabase/types";
import type { StoreData } from "@/lib/rewards/fetch-store";
import type { RedeemAction } from "@/lib/rewards/types";
import { rewardIcon } from "@/lib/rewards/icons";
import { formatRequestTime } from "@/lib/rewards/format";
import { useRewardStore } from "@/lib/hooks/use-reward-store";
import { Modal } from "@/components/ui/modal";

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
      <section
        aria-label="Your gold"
        className="flex items-center justify-between gap-4 rounded-2xl border border-amber-300/40 bg-gradient-to-br from-amber-400/20 to-amber-600/10 p-5"
      >
        <div>
          <p className="text-sm font-semibold uppercase tracking-wide text-amber-200">Your gold</p>
          <p aria-live="polite" className="text-5xl font-black text-amber-300 tabular-nums">
            {gold}
          </p>
        </div>
        <span aria-hidden className="text-6xl drop-shadow">
          🪙
        </span>
      </section>

      {notice && (
        <p role="status" className="rounded-xl bg-emerald-500/20 px-4 py-3 font-semibold text-emerald-100">
          {notice}
        </p>
      )}

      {waiting.length > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-amber-300">
            Waiting for a grown-up
          </h2>
          <ul className="space-y-2">
            {waiting.map((r) => (
              <WaitingRow key={r.id} redemption={r} reward={store.rewardsById[r.reward_id]} timeZone={timeZone} />
            ))}
          </ul>
        </section>
      )}

      <section>
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-amber-300">Rewards</h2>
        {available.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-white/30 p-6 text-center text-indigo-200">
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
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-amber-300">Recently</h2>
          <ul className="divide-y divide-white/10 rounded-2xl bg-white/5 px-4">
            {recent.map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                <span className="min-w-0 truncate text-indigo-100">
                  <span aria-hidden>{rewardIcon(store.rewardsById[r.reward_id]?.icon)} </span>
                  {store.rewardsById[r.reward_id]?.title ?? "Reward"}
                </span>
                {r.status === "fulfilled" ? (
                  <span className="shrink-0 font-bold text-emerald-300">Enjoy it! ✓</span>
                ) : (
                  <span className="shrink-0 font-semibold text-indigo-300">Not this time · +{r.gold_spent} gold back</span>
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
        className="rounded-2xl border border-amber-300/40 bg-indigo-950 text-white shadow-2xl backdrop:bg-black/60"
        titleClassName="text-lg font-black text-amber-300"
        closeClassName="text-indigo-300"
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
    <li className="flex flex-col rounded-2xl border border-white/15 bg-white/10 p-4">
      <div className="flex items-start gap-3">
        <span aria-hidden className="text-4xl leading-none">
          {rewardIcon(reward.icon)}
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-black leading-tight text-white">{reward.title}</p>
          {reward.description && <p className="mt-1 text-sm text-indigo-200">{reward.description}</p>}
        </div>
      </div>
      <div className="mt-auto flex items-center justify-between gap-2 pt-4">
        <p className="text-lg font-black text-amber-300 tabular-nums">
          {reward.gold_cost} <span className="text-sm font-bold">gold</span>
        </p>
        <div className="flex items-center gap-2">
          {requested > 0 && (
            <span className="rounded-full border border-dashed border-amber-300/70 px-2 py-0.5 text-xs font-bold text-amber-200">
              ⏳ Requested{requested > 1 ? ` ×${requested}` : ""}
            </span>
          )}
          <button
            type="button"
            onClick={onRedeem}
            disabled={!affordable}
            aria-label={
              affordable
                ? `Redeem ${reward.title} for ${reward.gold_cost} gold`
                : `${reward.title}: need ${reward.gold_cost - gold} more gold`
            }
            className="rounded-lg bg-amber-400 px-4 py-2 font-black text-indigo-950 shadow hover:bg-amber-300 disabled:cursor-not-allowed disabled:bg-white/10 disabled:text-indigo-300 disabled:shadow-none"
          >
            {affordable ? "Redeem" : `Need ${reward.gold_cost - gold} more`}
          </button>
        </div>
      </div>
    </li>
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
    <li
      className={`flex items-center gap-3 rounded-2xl border-2 border-dashed p-3 ${
        approved ? "border-sky-300/60 bg-sky-400/10" : "border-amber-300/60 bg-amber-400/10"
      }`}
    >
      <span aria-hidden className="text-3xl leading-none">
        {rewardIcon(reward?.icon)}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate font-bold text-white">{reward?.title ?? "Reward"}</p>
        <p className="text-xs text-indigo-200">
          {r.gold_spent} gold · {formatRequestTime(r.redeemed_at, timeZone)}
        </p>
      </div>
      <span
        className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-black ${
          approved ? "bg-sky-300 text-indigo-950" : "bg-amber-300 text-indigo-950"
        }`}
      >
        {approved ? "Approved! Coming soon" : "⏳ Waiting"}
      </span>
    </li>
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
      <p className="text-indigo-100">
        Spend <strong className="text-amber-300">{reward.gold_cost} gold</strong>? You&apos;ll have{" "}
        <strong className="text-amber-300">{gold - reward.gold_cost}</strong> left. A grown-up will say yes
        or no — if it&apos;s a no, you get the gold back.
      </p>
      {error && (
        <p role="alert" className="rounded-lg bg-red-500/20 px-3 py-2 text-sm text-red-100">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-lg bg-white/10 px-4 py-2 font-semibold text-white hover:bg-white/20"
        >
          Not yet
        </button>
        <button
          type="button"
          onClick={confirm}
          disabled={pending || gold < reward.gold_cost}
          className="rounded-lg bg-amber-400 px-4 py-2 font-black text-indigo-950 hover:bg-amber-300 disabled:opacity-50"
        >
          {pending ? "Sending…" : "Yes, redeem!"}
        </button>
      </div>
    </div>
  );
}
