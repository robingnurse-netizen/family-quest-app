import type { ActionResult } from "@/lib/backlog/types";
import type { PotionPurchase } from "@/lib/supabase/types";

/** Buy and drink a potion (server action; the database prices it). */
export type BuyPotionAction = (potionId: string, expectedCost: number) => Promise<ActionResult<PotionPurchase>>;
