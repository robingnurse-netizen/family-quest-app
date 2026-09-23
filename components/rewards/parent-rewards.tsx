"use client";

import { useState, useTransition } from "react";
import type { Reward, RewardRedemption } from "@/lib/supabase/types";
import type { BoardMember } from "@/lib/backlog/types";
import type { StoreData } from "@/lib/rewards/fetch-store";
import { DEFAULT_REWARD_ICON, REWARD_ICONS, rewardIcon } from "@/lib/rewards/icons";
import { formatRequestTime } from "@/lib/rewards/format";
import { MAX_REWARD_COST, type CatalogActions, type Resolution, type ResolveAction } from "@/lib/rewards/types";
import { useRewardStore } from "@/lib/hooks/use-reward-store";
import { Modal } from "@/components/ui/modal";

type Props = {
  familyId: string;
  timeZone: string;
  members: BoardMember[];
  initial: StoreData;
  resolve: ResolveAction;
  /** With catalog actions, the reward catalog renders below the queue. */
  catalog?: CatalogActions;
};

const RECENT_LIMIT = 5;

/**
 * Parent side of the rewards store, live via Realtime: the queue of open
 * requests (pending, and approved but not yet handed over) with
 * Approve / Deny / Fulfilled, and optionally the reward catalog. One hook
 * (one Realtime channel) serves both.
 */
export function ParentRewards({ familyId, timeZone, members, initial, resolve, catalog }: Props) {
  const store = useRewardStore({ familyId, childId: null, initial });
  const names = Object.fromEntries(members.map((m) => [m.id, m.display_name]));

  // Needs a decision first, then approved-but-not-handed-over; oldest first
  // within each (store.redemptions is newest first).
  const open = [
    ...store.redemptions.filter((r) => r.status === "pending").reverse(),
    ...store.redemptions.filter((r) => r.status === "approved").reverse(),
  ];
  const recent = store.redemptions
    .filter((r) => r.status === "fulfilled" || r.status === "denied")
    .slice(0, RECENT_LIMIT);

  return (
    <div className="space-y-8">
      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
        <div className="mb-3 flex items-baseline justify-between gap-2">
          <h2 className="text-lg font-black text-slate-900">Reward requests</h2>
          {open.some((r) => r.status === "pending") && (
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-bold text-amber-800">
              {open.filter((r) => r.status === "pending").length} waiting
            </span>
          )}
        </div>
        {open.length === 0 ? (
          <p className="rounded-xl border border-dashed border-slate-300 p-6 text-center text-slate-500">
            No requests waiting.
          </p>
        ) : (
          <ul className="space-y-2">
            {open.map((r) => (
              <RequestRow
                key={r.id}
                redemption={r}
                reward={store.rewardsById[r.reward_id]}
                childName={names[r.child_id]}
                timeZone={timeZone}
                resolve={resolve}
                onResolved={store.upsertRedemption}
              />
            ))}
          </ul>
        )}

        {recent.length > 0 && (
          <div className="mt-4">
            <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">Recently sorted</h3>
            <ul className="divide-y divide-slate-100 text-sm">
              {recent.map((r) => (
                <li key={r.id} className="flex items-center justify-between gap-2 py-1.5">
                  <span className="min-w-0 truncate text-slate-700">
                    <span aria-hidden>{rewardIcon(store.rewardsById[r.reward_id]?.icon)} </span>
                    {store.rewardsById[r.reward_id]?.title ?? "Reward"} · {names[r.child_id] ?? "Player"} ·{" "}
                    {r.gold_spent} gold
                  </span>
                  <StatusBadge status={r.status} />
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      {catalog && (
        <RewardCatalog
          rewards={store.rewards}
          usedRewardIds={store.usedRewardIds}
          actions={catalog}
          onSaved={store.upsertReward}
          onDeleted={store.removeReward}
        />
      )}
    </div>
  );
}

// --- request queue ------------------------------------------------------------

function RequestRow({
  redemption: r,
  reward,
  childName,
  timeZone,
  resolve,
  onResolved,
}: {
  redemption: RewardRedemption;
  reward?: Reward;
  childName?: string;
  timeZone: string;
  resolve: ResolveAction;
  onResolved: (row: RewardRedemption) => void;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [confirmDeny, setConfirmDeny] = useState(false);

  function act(status: Resolution) {
    setError(null);
    startTransition(async () => {
      const result = await resolve(r.id, status);
      if (!result.ok) return setError(result.error);
      onResolved(result.data);
    });
  }

  const button = "rounded-lg px-3 py-1.5 text-sm font-bold disabled:opacity-60";
  return (
    <li
      className={`rounded-xl border p-3 ${
        r.status === "pending" ? "border-amber-300 bg-amber-50/60" : "border-slate-200"
      }`}
    >
      <div className="flex items-start gap-3">
        <span aria-hidden className="text-3xl leading-none">
          {rewardIcon(reward?.icon)}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2">
            <p className="truncate font-bold text-slate-900">{reward?.title ?? "Reward"}</p>
            <StatusBadge status={r.status} />
          </div>
          <p className="text-sm text-slate-600">
            {childName ?? "Player"} · <span className="font-semibold text-amber-700">{r.gold_spent} gold</span> ·{" "}
            {formatRequestTime(r.redeemed_at, timeZone)}
          </p>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap justify-end gap-2">
        {confirmDeny ? (
          <>
            <button
              type="button"
              onClick={() => setConfirmDeny(false)}
              disabled={pending}
              className={`${button} bg-slate-100 text-slate-700 hover:bg-slate-200`}
            >
              Keep
            </button>
            <button
              type="button"
              onClick={() => act("denied")}
              disabled={pending}
              className={`${button} bg-red-600 text-white hover:bg-red-500`}
            >
              {pending ? "Denying…" : `Deny & refund ${r.gold_spent} gold`}
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              onClick={() => setConfirmDeny(true)}
              disabled={pending}
              className={`${button} text-red-600 hover:bg-red-50`}
            >
              Deny
            </button>
            {r.status === "pending" && (
              <button
                type="button"
                onClick={() => act("approved")}
                disabled={pending}
                className={`${button} bg-slate-100 text-slate-800 hover:bg-slate-200`}
              >
                Approve
              </button>
            )}
            <button
              type="button"
              onClick={() => act("fulfilled")}
              disabled={pending}
              className={`${button} bg-indigo-600 text-white shadow hover:bg-indigo-500`}
            >
              {pending ? "Saving…" : "Fulfilled"}
            </button>
          </>
        )}
      </div>
      {error && (
        <p role="alert" className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}
    </li>
  );
}

const STATUS_STYLES: Record<RewardRedemption["status"], [string, string]> = {
  pending: ["Waiting", "bg-amber-100 text-amber-800"],
  approved: ["Approved", "bg-sky-100 text-sky-800"],
  fulfilled: ["Fulfilled", "bg-emerald-100 text-emerald-800"],
  denied: ["Denied · refunded", "bg-slate-100 text-slate-600"],
};

function StatusBadge({ status }: { status: RewardRedemption["status"] }) {
  const [label, style] = STATUS_STYLES[status];
  return (
    <span className={`shrink-0 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold ${style}`}>
      {label}
    </span>
  );
}

// --- catalog --------------------------------------------------------------------

function RewardCatalog({
  rewards,
  usedRewardIds,
  actions,
  onSaved,
  onDeleted,
}: {
  rewards: Reward[];
  usedRewardIds: Set<string>;
  actions: CatalogActions;
  onSaved: (reward: Reward) => void;
  onDeleted: (id: string) => void;
}) {
  const [editing, setEditing] = useState<Reward | "new" | null>(null);

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
      <h2 className="mb-3 text-lg font-black text-slate-900">Reward catalog</h2>
      {rewards.length === 0 ? (
        <p className="rounded-xl border border-dashed border-slate-300 p-6 text-center text-slate-500">
          No rewards yet. Add a few things worth saving gold for.
        </p>
      ) : (
        <ul className="space-y-2">
          {/* In the store first, hidden ones after. */}
          {[...rewards].sort((a, b) => Number(b.active) - Number(a.active)).map((reward) => (
            <CatalogRow
              key={reward.id}
              reward={reward}
              actions={actions}
              onSaved={onSaved}
              onEdit={() => setEditing(reward)}
            />
          ))}
        </ul>
      )}

      <button
        type="button"
        onClick={() => setEditing("new")}
        className="mt-4 rounded-lg bg-indigo-600 px-4 py-2 font-bold text-white shadow hover:bg-indigo-500"
      >
        New reward
      </button>

      <Modal
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={editing === "new" ? "New reward" : "Edit reward"}
        className="rounded-2xl border border-slate-200 bg-white text-slate-900 shadow-xl backdrop:bg-slate-900/40"
        titleClassName="text-lg font-black text-slate-900"
        closeClassName="text-slate-500"
      >
        {editing !== null && (
          <RewardForm
            reward={editing === "new" ? null : editing}
            used={editing !== "new" && usedRewardIds.has(editing.id)}
            actions={actions}
            onDone={() => setEditing(null)}
            onSaved={onSaved}
            onDeleted={onDeleted}
          />
        )}
      </Modal>
    </section>
  );
}

function CatalogRow({
  reward,
  actions,
  onSaved,
  onEdit,
}: {
  reward: Reward;
  actions: CatalogActions;
  onSaved: (reward: Reward) => void;
  onEdit: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function toggle() {
    setError(null);
    startTransition(async () => {
      const result = await actions.setActive(reward.id, !reward.active);
      if (!result.ok) return setError(result.error);
      onSaved(result.data);
    });
  }

  return (
    <li className={`rounded-xl border border-slate-200 p-3 ${reward.active ? "" : "bg-slate-50"}`}>
      <div className="flex items-start gap-3">
        <span aria-hidden className={`text-3xl leading-none ${reward.active ? "" : "opacity-40 grayscale"}`}>
          {rewardIcon(reward.icon)}
        </span>
        <div className="min-w-0 flex-1">
          <p className={`truncate font-bold ${reward.active ? "text-slate-900" : "text-slate-500"}`}>
            {reward.title}
          </p>
          <p className="text-sm">
            <span className="font-semibold text-amber-700">{reward.gold_cost} gold</span>
            {!reward.active && <span className="text-slate-500"> · hidden from the store</span>}
          </p>
          {reward.description && <p className="mt-0.5 text-sm text-slate-600">{reward.description}</p>}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1 sm:flex-row">
          <button
            type="button"
            onClick={toggle}
            disabled={pending}
            className="rounded-lg px-2.5 py-1 text-sm font-semibold text-slate-600 hover:bg-slate-100 disabled:opacity-60"
          >
            {reward.active ? "Hide" : "Show"}
          </button>
          <button
            type="button"
            onClick={onEdit}
            className="rounded-lg px-2.5 py-1 text-sm font-semibold text-indigo-600 hover:bg-indigo-50"
          >
            Edit
          </button>
        </div>
      </div>
      {error && (
        <p role="alert" className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}
    </li>
  );
}

function RewardForm({
  reward,
  used,
  actions,
  onDone,
  onSaved,
  onDeleted,
}: {
  reward: Reward | null;
  /** Has past requests: can be hidden, not deleted. */
  used: boolean;
  actions: CatalogActions;
  onDone: () => void;
  onSaved: (reward: Reward) => void;
  onDeleted: (id: string) => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [saving, startSaving] = useTransition();
  const [removing, startRemoving] = useTransition();
  const [icon, setIcon] = useState(rewardIcon(reward?.icon ?? DEFAULT_REWARD_ICON));

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    setError(null);
    startSaving(async () => {
      const result = await actions.save(formData);
      if (!result.ok) return setError(result.error);
      onSaved(result.data);
      onDone();
    });
  }

  function remove() {
    if (!reward) return;
    setError(null);
    startRemoving(async () => {
      const result = await actions.remove(reward.id);
      if (!result.ok) return setError(result.error);
      onDeleted(reward.id);
      onDone();
    });
  }

  function toggleActive() {
    if (!reward) return;
    setError(null);
    startRemoving(async () => {
      const result = await actions.setActive(reward.id, !reward.active);
      if (!result.ok) return setError(result.error);
      onSaved(result.data);
      onDone();
    });
  }

  const input =
    "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200";
  const label = "mb-1 block text-sm font-semibold text-slate-700";

  return (
    <form onSubmit={submit} className="space-y-4">
      {reward && <input type="hidden" name="id" value={reward.id} />}

      <div className="grid grid-cols-[1fr_7rem] gap-3">
        <label className="block">
          <span className={label}>Title</span>
          <input name="title" required maxLength={80} autoFocus defaultValue={reward?.title} className={input} />
        </label>
        <label className="block">
          <span className={label}>Cost (gold)</span>
          <input
            type="number"
            name="gold_cost"
            required
            min={0}
            max={MAX_REWARD_COST}
            defaultValue={reward?.gold_cost ?? 50}
            className={input}
          />
        </label>
      </div>

      <label className="block">
        <span className={label}>Description</span>
        <textarea
          name="description"
          rows={2}
          maxLength={300}
          defaultValue={reward?.description ?? ""}
          className={input}
        />
      </label>

      <fieldset>
        <legend className={label}>Icon</legend>
        <div className="flex flex-wrap gap-1.5">
          {REWARD_ICONS.map((i) => (
            <label key={i.emoji} className="cursor-pointer">
              <input
                type="radio"
                name="icon"
                value={i.emoji}
                checked={icon === i.emoji}
                onChange={() => setIcon(i.emoji)}
                className="peer sr-only"
              />
              <span
                aria-hidden
                title={i.name}
                className="flex h-10 w-10 items-center justify-center rounded-lg border border-slate-200 text-2xl peer-checked:border-indigo-500 peer-checked:bg-indigo-50 peer-checked:ring-2 peer-checked:ring-indigo-300 peer-focus-visible:ring-2 peer-focus-visible:ring-indigo-400"
              >
                {i.emoji}
              </span>
              <span className="sr-only">{i.name}</span>
            </label>
          ))}
        </div>
      </fieldset>

      {reward && reward.gold_cost > 0 && (
        <p className="-mt-1 text-xs text-slate-500">
          Changing the cost only affects new requests — ones already made keep what they spent.
        </p>
      )}

      {error && (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}

      <div className="flex items-center justify-between gap-2 pt-1">
        {!reward ? (
          <span />
        ) : used ? (
          // Past requests point at this reward: hide it rather than delete.
          <button
            type="button"
            onClick={toggleActive}
            disabled={removing}
            title="This reward has past requests, so it can be hidden but not deleted."
            className="rounded-lg px-4 py-2 font-semibold text-slate-600 hover:bg-slate-100 disabled:opacity-60"
          >
            {removing ? "Saving…" : reward.active ? "Hide from store" : "Show in store"}
          </button>
        ) : (
          <button
            type="button"
            onClick={confirmDelete ? remove : () => setConfirmDelete(true)}
            disabled={removing}
            className="rounded-lg px-4 py-2 font-semibold text-red-600 hover:bg-red-50 disabled:opacity-60"
          >
            {removing ? "Deleting…" : confirmDelete ? "Really delete?" : "Delete"}
          </button>
        )}
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onDone}
            className="rounded-lg bg-slate-100 px-4 py-2 font-semibold text-slate-700 hover:bg-slate-200"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving}
            className="rounded-lg bg-indigo-600 px-4 py-2 font-bold text-white shadow hover:bg-indigo-500 disabled:opacity-60"
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </form>
  );
}
