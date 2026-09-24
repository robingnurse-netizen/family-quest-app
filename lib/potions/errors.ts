// Map database errors raised by buy_potion()
// (supabase/migrations/20260926000012_recap_evening_healing.sql) to friendly text.

export function friendlyPotionError(message: string | undefined, fallback: string) {
  if (!message) return fallback;
  if (message.includes("potion_insufficient_gold")) return "Not enough gold for that potion yet — defeat more bosses!";
  if (message.includes("potion_party_full")) return "The party is already at full health — save your gold!";
  if (message.includes("potion_unavailable")) return "That potion isn't on sale any more.";
  if (message.includes("potion_not_a_player")) return "Only players can buy potions.";
  return fallback;
}
