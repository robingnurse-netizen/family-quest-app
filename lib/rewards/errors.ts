// Map database errors raised by the rewards store triggers
// (supabase/migrations/20260923000009_rewards_store.sql) to friendly text.

export function friendlyRewardError(message: string | undefined, fallback: string) {
  if (!message) return fallback;
  if (message.startsWith("redemption_insufficient_gold")) {
    return "Not enough gold for that one yet — defeat more bosses!";
  }
  if (message.startsWith("redemption_reward_unavailable")) {
    return "That reward isn't available any more.";
  }
  if (message.startsWith("redemption_bad_status")) {
    return "That request has already been sorted out.";
  }
  if (message.startsWith("redemption_immutable")) {
    return "Only a request's status can be changed.";
  }
  // Foreign key from reward_redemptions (no cascade): the reward has history.
  if (message.includes("reward_redemptions_reward_id_fkey")) {
    return "This reward has past requests, so it can't be deleted — hide it instead.";
  }
  return fallback;
}
