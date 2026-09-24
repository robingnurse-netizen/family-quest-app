// Database types for Family Quest.
//
// Hand-written to mirror supabase/migrations. Once the Supabase project is
// linked you can replace this with generated types:
//   npx supabase gen types typescript --project-id <id> > lib/supabase/types.ts

export type Role = "parent" | "child";
export type TaskSlotStatus = "scheduled" | "completed" | "missed";
export type BossTier = "low" | "mid" | "epic";
export type BossStatus = "inactive" | "active" | "defeated" | "escaped";
export type BossLogEvent =
  | "damage"
  | "miss_penalty"
  | "defeated"
  | "escaped"
  | "activated"
  | "gold_awarded";
export type RedemptionStatus = "pending" | "approved" | "fulfilled" | "denied";

export type Family = {
  id: string;
  name: string;
  timezone: string;
  invite_code: string;
  created_at: string;
};

export type Profile = {
  id: string;
  family_id: string;
  display_name: string;
  role: Role;
  created_at: string;
};

export type CalendarEvent = {
  id: string;
  family_id: string;
  title: string;
  description: string | null;
  start_time: string;
  end_time: string | null;
  all_day: boolean;
  location: string | null;
  recurrence_rule: string | null;
  created_by: string | null;
  created_at: string;
};

export type WeeklyPool = {
  id: string;
  family_id: string;
  child_id: string;
  week_start_date: string;
  title: string;
  category: string | null;
  total_minutes: number;
  color: string | null;
  created_by: string | null;
  created_at: string;
};

export type TaskSlot = {
  id: string;
  pool_id: string;
  scheduled_date: string;
  duration_minutes: number;
  sort_order: number;
  status: TaskSlotStatus;
  applied_to_boss: boolean;
  /** XP for this quest has been given (set by the game engine; locks it). */
  xp_awarded: boolean;
  completed_at: string | null;
  created_at: string;
};

export type Boss = {
  id: string;
  family_id: string;
  name: string;
  tier: BossTier;
  sprite_key: string;
  max_hp: number;
  current_hp: number;
  /** Monday of the week the boss was activated; null while queued. */
  week_start_date: string | null;
  status: BossStatus;
  /** Activation order within a tier (low → mid → epic). */
  queue_position: number;
  created_at: string;
};

export type BossLog = {
  id: string;
  boss_id: string;
  event_type: BossLogEvent;
  amount: number;
  source_task_slot_id: string | null;
  /** Child who dealt the damage / took the penalty / got the gold. */
  child_id: string | null;
  created_at: string;
};

export type PartyHealth = {
  id: string;
  family_id: string;
  current_hp: number;
  max_hp: number;
  updated_at: string;
};

export type PlayerStats = {
  id: string;
  child_id: string;
  gold: number;
  xp: number;
  level: number;
  current_streak: number;
  best_streak: number;
  /** Last day the nightly reset evaluated for the streak (YYYY-MM-DD). */
  streak_through: string | null;
  pending_damage: number;
  updated_at: string;
};

export type Companion = {
  id: string;
  child_id: string;
  name: string;
  sprite_key: string;
  unlocked: boolean;
  level: number;
  created_at: string;
};

export type Reward = {
  id: string;
  family_id: string;
  title: string;
  description: string | null;
  gold_cost: number;
  icon: string | null;
  active: boolean;
  created_by: string | null;
  created_at: string;
};

export type RewardRedemption = {
  id: string;
  family_id: string;
  child_id: string;
  reward_id: string;
  gold_spent: number;
  status: RedemptionStatus;
  redeemed_at: string;
  resolved_by: string | null;
};

/** A potion in the store's catalogue (20260926000012; tune it there). */
export type Potion = {
  id: string;
  name: string;
  heal_hp: number;
  gold_cost: number;
  sort_order: number;
  active: boolean;
};

/** A heal: a potion bought, or a perfect day at the nightly reset. */
export type PartyLog = {
  id: string;
  family_id: string;
  child_id: string | null;
  event_type: "potion" | "perfect_day";
  /** HP actually healed (capped at max HP). */
  amount: number;
  hp_after: number;
  potion_id: string | null;
  gold_spent: number;
  /** Perfect day: the day (YYYY-MM-DD). */
  day: string | null;
  created_at: string;
};

/**
 * One nightly reset run that affected a child (his misses, perfect days, or
 * party damage / a knock-out). Written by run_daily_reset; seen_at is set by
 * acknowledge_recaps(). Read-only through the API.
 */
export type ResetRecap = {
  id: string;
  family_id: string;
  child_id: string;
  created_at: string;
  day_from: string | null;
  day_to: string | null;
  missed_quests: number;
  missed_minutes: number;
  /** The whole party's damage that run (0 with no active boss). */
  party_damage: number;
  boss_id: string | null;
  perfect_days: number;
  healed: number;
  streak_before: number;
  streak_after: number;
  knocked_out: boolean;
  escaped_boss_id: string | null;
  next_boss_id: string | null;
  hp_before: number;
  hp_after: number;
  max_hp: number;
  seen_at: string | null;
};

/** What tonight's reset would deal right now (tonight_stakes()). */
export type TonightStakes = {
  today: string;
  timezone: string;
  boss_active: boolean;
  boss_name: string | null;
  /** The caller's own open quests up to today. */
  my_open_quests: number;
  open_quests: number;
  open_minutes: number;
  /** Party damage if nothing else gets done (0 with no active boss). */
  damage: number;
  party_hp: number;
};

/** buy_potion() result. */
export type PotionPurchase = {
  potion_id: string;
  healed: number;
  hp: number;
  max_hp: number;
  gold: number;
  gold_spent: number;
};

/**
 * Summary returned by run_daily_reset() for one family. Boss damage isn't
 * part of the nightly run any more — it's dealt instantly on completion.
 */
export type DailyResetResult = {
  family_id: string;
  today: string;
  boss_id: string | null;
  missed_minutes: number;
  party_damage: number;
  knocked_out?: boolean;
  /** HP healed by perfect days this run. */
  party_healed?: number;
  party_hp: number;
  defeated: string | null;
  escaped: string | null;
  gold_awarded: { child_id: string; gold: number }[];
  activated: string | null;
  streaks?: {
    child_id: string;
    before?: number;
    streak: number;
    best: number;
    from?: string;
    through: string;
    perfect_days?: string[];
  }[];
  recaps?: number;
};

// Columns with a database default (or nullable) are optional on insert.
type Table<Row, Optional extends keyof Row> = {
  Row: Row;
  Insert: Omit<Row, Optional> & Partial<Pick<Row, Optional>>;
  Update: Partial<Row>;
  Relationships: [];
};

export type Database = {
  public: {
    Tables: {
      families: Table<Family, "id" | "timezone" | "invite_code" | "created_at">;
      profiles: Table<Profile, "created_at">;
      calendar_events: Table<
        CalendarEvent,
        | "id"
        | "description"
        | "end_time"
        | "all_day"
        | "location"
        | "recurrence_rule"
        | "created_by"
        | "created_at"
      >;
      weekly_pools: Table<
        WeeklyPool,
        "id" | "category" | "color" | "created_by" | "created_at"
      >;
      task_slots: Table<
        TaskSlot,
        | "id"
        | "sort_order"
        | "status"
        | "applied_to_boss"
        | "xp_awarded"
        | "completed_at"
        | "created_at"
      >;
      bosses: Table<
        Boss,
        "id" | "status" | "week_start_date" | "queue_position" | "created_at"
      >;
      boss_log: Table<
        BossLog,
        "id" | "amount" | "source_task_slot_id" | "child_id" | "created_at"
      >;
      party_health: Table<
        PartyHealth,
        "id" | "current_hp" | "max_hp" | "updated_at"
      >;
      player_stats: Table<
        PlayerStats,
        | "id"
        | "gold"
        | "xp"
        | "level"
        | "current_streak"
        | "best_streak"
        | "streak_through"
        | "pending_damage"
        | "updated_at"
      >;
      companions: Table<Companion, "id" | "unlocked" | "level" | "created_at">;
      rewards: Table<
        Reward,
        "id" | "description" | "icon" | "active" | "created_by" | "created_at"
      >;
      // gold_spent / redeemed_at are set by the request trigger
      // (20260923000009_rewards_store.sql), whatever the client sends.
      reward_redemptions: Table<
        RewardRedemption,
        "id" | "gold_spent" | "status" | "redeemed_at" | "resolved_by"
      >;
      // Read-only through the API (writes happen in the functions below).
      potions: Table<Potion, "sort_order" | "active">;
      party_log: Table<
        PartyLog,
        "id" | "child_id" | "potion_id" | "gold_spent" | "day" | "created_at"
      >;
      reset_recaps: Table<ResetRecap, "id" | "created_at" | "seen_at">;
    };
    Views: Record<string, never>;
    Functions: {
      current_family_id: { Args: Record<string, never>; Returns: string };
      is_parent: { Args: Record<string, never>; Returns: boolean };
      lookup_invite_code: { Args: { code: string }; Returns: string | null };
      // Service role only (see 20260923000006_boss_engine.sql).
      run_daily_reset: {
        Args: { p_family_id: string; p_today?: string };
        Returns: DailyResetResult;
      };
      // Signed-in users (20260926000012_recap_evening_healing.sql).
      buy_potion: { Args: { p_potion_id: string }; Returns: PotionPurchase };
      acknowledge_recaps: { Args: { p_through: string }; Returns: number };
      tonight_stakes: { Args: Record<string, never>; Returns: TonightStakes | null };
      run_daily_reset_all: {
        Args: Record<string, never>;
        Returns: (DailyResetResult | { family_id: string; error: string })[];
      };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};
