// Reward icons, stored as a string in rewards.icon and limited to these sets
// (the same pick-from-a-set pattern as pool colours):
//   - pixel icons, stored as "px:<key>" (drawn in components/ui/icons.tsx,
//     rendered by components/rewards/reward-icon.tsx) — offered first;
//   - the original emoji, stored as the emoji itself — existing rewards keep
//     working (the player side shows them inside an inset pixel item slot).

export const PIXEL_REWARD_ICONS = [
  { key: "px:gift", name: "Gift" },
  { key: "px:cash", name: "Pocket money" },
  { key: "px:controller", name: "Games / screen time" },
  { key: "px:treat", name: "Treat" },
  { key: "px:ticket", name: "Day out" },
  { key: "px:toy", name: "Toy" },
  { key: "px:book", name: "Book" },
  { key: "px:pizza", name: "Pizza" },
  { key: "px:movie", name: "Movie" },
  { key: "px:star", name: "Star" },
] as const;

export type PixelRewardIcon = (typeof PIXEL_REWARD_ICONS)[number]["key"];

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

/** New rewards start with the pixel gift. */
export const DEFAULT_REWARD_ICON: string = PIXEL_REWARD_ICONS[0].key;

export function isPixelRewardIcon(value: string): value is PixelRewardIcon {
  return PIXEL_REWARD_ICONS.some((i) => i.key === value);
}

export function isRewardIcon(value: string) {
  return isPixelRewardIcon(value) || REWARD_ICONS.some((i) => i.emoji === value);
}

/** Icon value to render for a reward (falls back if the stored value is unknown). */
export function rewardIcon(value: string | null | undefined) {
  return value && isRewardIcon(value) ? value : DEFAULT_REWARD_ICON;
}

/** A readable name for an icon value (for pickers and titles). */
export function rewardIconName(value: string) {
  return (
    PIXEL_REWARD_ICONS.find((i) => i.key === value)?.name ??
    REWARD_ICONS.find((i) => i.emoji === value)?.name ??
    "Reward"
  );
}
