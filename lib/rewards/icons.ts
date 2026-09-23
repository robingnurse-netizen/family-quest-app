// Reward icons. Stored as the emoji itself in rewards.icon; limited to this
// palette (the same pick-from-a-set pattern as pool colours).

export const REWARD_ICONS = [
  { emoji: "🎁", name: "Gift" },
  { emoji: "🍕", name: "Pizza" },
  { emoji: "🍦", name: "Ice cream" },
  { emoji: "🍫", name: "Chocolate" },
  { emoji: "🎮", name: "Games" },
  { emoji: "📺", name: "Screen time" },
  { emoji: "🎬", name: "Movie" },
  { emoji: "📚", name: "Book" },
  { emoji: "🧸", name: "Toy" },
  { emoji: "🧱", name: "Building set" },
  { emoji: "⚽", name: "Sport" },
  { emoji: "🚲", name: "Bike ride" },
  { emoji: "🏊", name: "Swimming" },
  { emoji: "🎟️", name: "Day out" },
  { emoji: "🛏️", name: "Late bedtime" },
  { emoji: "💷", name: "Pocket money" },
] as const;

export const DEFAULT_REWARD_ICON = REWARD_ICONS[0].emoji;

export function isRewardIcon(value: string) {
  return REWARD_ICONS.some((i) => i.emoji === value);
}

/** Icon to render for a reward (falls back if the stored value is unknown). */
export function rewardIcon(value: string | null | undefined) {
  return value && isRewardIcon(value) ? value : DEFAULT_REWARD_ICON;
}

