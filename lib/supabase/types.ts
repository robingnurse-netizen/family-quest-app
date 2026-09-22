// Database types for Family Quest.
//
// Hand-written to mirror supabase/migrations. Once the Supabase project is
// linked you can replace this with generated types:
//   npx supabase gen types typescript --project-id <id> > lib/supabase/types.ts

export type Role = "parent" | "child";
export type TaskSlotStatus = "scheduled" | "completed" | "missed";
export type BossTier = "low" | "mid" | "epic";
export type BossStatus = "inactive" | "active" | "defeated" | "escaped";
export type BossLogEvent = "damage" | "miss_penalty" | "defeated" | "escaped";
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
  week_start_date: string;
  status: BossStatus;
  created_at: string;
};

export type BossLog = {
  id: string;
  boss_id: string;
  event_type: BossLogEvent;
  amount: number;
  source_task_slot_id: string | null;
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
        | "completed_at"
        | "created_at"
      >;
      bosses: Table<Boss, "id" | "status" | "created_at">;
      boss_log: Table<
        BossLog,
        "id" | "amount" | "source_task_slot_id" | "created_at"
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
        | "pending_damage"
        | "updated_at"
      >;
      companions: Table<Companion, "id" | "unlocked" | "level" | "created_at">;
      rewards: Table<
        Reward,
        "id" | "description" | "icon" | "active" | "created_by" | "created_at"
      >;
      reward_redemptions: Table<
        RewardRedemption,
        "id" | "status" | "redeemed_at" | "resolved_by"
      >;
    };
    Views: Record<string, never>;
    Functions: {
      current_family_id: { Args: Record<string, never>; Returns: string };
      is_parent: { Args: Record<string, never>; Returns: boolean };
      lookup_invite_code: { Args: { code: string }; Returns: string | null };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};
