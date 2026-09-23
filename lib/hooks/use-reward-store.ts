"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { fetchStore, type StoreData } from "@/lib/rewards/fetch-store";
import type { PlayerStats, Reward, RewardRedemption } from "@/lib/supabase/types";

const byId = <T extends { id: string }>(rows: T[]) =>
  Object.fromEntries(rows.map((r) => [r.id, r])) as Record<string, T>;

function omit<T>(map: Record<string, T>, id: string) {
  if (!(id in map)) return map;
  const next = { ...map };
  delete next[id];
  return next;
}

/**
 * Rewards + redemption requests, kept live with Supabase Realtime. Parents
 * (`childId` null) see every request in the family; a player sees their own
 * and their spendable gold. Refetches whenever the channel (re)connects, so
 * nothing is missed between the server render and the subscription.
 *
 * Gold is only ever set from the database (player_stats, or a balance a
 * server action read back), never adjusted locally, so it can't drift.
 */
export function useRewardStore({
  familyId,
  childId,
  initial,
}: {
  familyId: string;
  childId: string | null;
  initial: StoreData;
}) {
  const [supabase] = useState(createClient);
  const [rewards, setRewards] = useState(() => byId(initial.rewards));
  const [redemptions, setRedemptions] = useState(() => byId(initial.redemptions));
  const [used, setUsed] = useState(() => new Set(initial.usedRewardIds));
  const [gold, setGold] = useState(initial.gold);

  const refetch = useCallback(async () => {
    const data = await fetchStore(supabase, familyId, childId);
    if (!data) return;
    setRewards(byId(data.rewards));
    setRedemptions(byId(data.redemptions));
    setUsed(new Set(data.usedRewardIds));
    setGold(data.gold);
  }, [supabase, familyId, childId]);

  const upsertReward = useCallback(
    (row: Reward) => setRewards((prev) => ({ ...prev, [row.id]: row })),
    [],
  );
  const removeReward = useCallback((id: string) => setRewards((prev) => omit(prev, id)), []);
  const upsertRedemption = useCallback(
    (row: RewardRedemption) => {
      // RLS lets a player read the family's requests; show only their own.
      if (childId && row.child_id !== childId) return;
      setRedemptions((prev) => ({ ...prev, [row.id]: row }));
      setUsed((prev) => (prev.has(row.reward_id) ? prev : new Set(prev).add(row.reward_id)));
    },
    [childId],
  );

  // RLS applies to Realtime, so only this family's rows arrive; the filters
  // save bandwidth. DELETE payloads only carry the id (and can't be filtered).
  useEffect(() => {
    const family = { schema: "public", filter: `family_id=eq.${familyId}` } as const;
    let channel = supabase
      .channel(`reward_store:${familyId}:${childId ?? "all"}`)
      .on("postgres_changes", { event: "INSERT", table: "rewards", ...family }, (p) =>
        upsertReward(p.new as Reward),
      )
      .on("postgres_changes", { event: "UPDATE", table: "rewards", ...family }, (p) =>
        upsertReward(p.new as Reward),
      )
      .on("postgres_changes", { event: "DELETE", schema: "public", table: "rewards" }, (p) => {
        const id = (p.old as Partial<Reward>).id;
        if (id) removeReward(id);
      })
      .on("postgres_changes", { event: "INSERT", table: "reward_redemptions", ...family }, (p) =>
        upsertRedemption(p.new as RewardRedemption),
      )
      .on("postgres_changes", { event: "UPDATE", table: "reward_redemptions", ...family }, (p) =>
        upsertRedemption(p.new as RewardRedemption),
      );
    if (childId) {
      // Gold changes from spending, refunds and boss payouts alike.
      const own = { schema: "public", table: "player_stats", filter: `child_id=eq.${childId}` } as const;
      channel = channel
        .on("postgres_changes", { event: "INSERT", ...own }, (p) => setGold((p.new as PlayerStats).gold))
        .on("postgres_changes", { event: "UPDATE", ...own }, (p) => setGold((p.new as PlayerStats).gold));
    }
    channel.subscribe((status) => {
      if (status === "SUBSCRIBED") void refetch();
    });

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [supabase, familyId, childId, refetch, upsertReward, removeReward, upsertRedemption]);

  const sortedRewards = useMemo(
    () =>
      Object.values(rewards).sort(
        (a, b) => a.gold_cost - b.gold_cost || a.title.localeCompare(b.title),
      ),
    [rewards],
  );
  const sortedRedemptions = useMemo(
    () => Object.values(redemptions).sort((a, b) => b.redeemed_at.localeCompare(a.redeemed_at)),
    [redemptions],
  );

  return {
    rewards: sortedRewards,
    rewardsById: rewards,
    redemptions: sortedRedemptions,
    usedRewardIds: used,
    gold,
    upsertReward,
    removeReward,
    upsertRedemption,
    setGold,
  };
}
