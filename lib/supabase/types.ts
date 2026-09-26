// Database types for Family Quest.
//
// Hand-written to mirror supabase/migrations. Once the Supabase project is
// linked you can replace this with generated types:
//   npx supabase gen types typescript --project-id <id> > lib/supabase/types.ts

export type Role = "parent" | "child";
export type TaskSlotStatus = "scheduled" | "completed" | "missed";
export type BossTier = "low" | "mid" | "epic";
/** "escaped" is dormant (…16: a boss never escapes; the value stays allowed). */
export type BossStatus = "inactive" | "active" | "defeated" | "escaped";
export type BossLogEvent =
  | "damage"
  /** Rogue's Night Raid: a perfect day's overnight damage (…16), for that child. */
  | "night_raid"
  | "defeated"
  | "activated"
  | "gold_awarded"
  /** Dormant (…16): allowed by the constraint, never written any more. */
  | "miss_penalty"
  | "escaped"
  | "comeback_bonus";
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
  /** Its original max HP (set on insert, …15). */
  base_max_hp: number;
  /** When its current fight started (every activation); the reward split counts damage from then. */
  active_since: string | null;
  // (bosses.retreats / escaped_at exist but are dormant since …16.)
};

export type BossLog = {
  id: string;
  boss_id: string;
  event_type: BossLogEvent;
  amount: number;
  source_task_slot_id: string | null;
  /** Child who dealt the damage / raided / got the gold. */
  child_id: string | null;
  created_at: string;
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

/**
 * One nightly reset run that affected a child (his misses, perfect days or
 * rescue events). Written by run_daily_reset; seen_at is set by
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
  /** The active boss after the run (the one his raids hit), if any. */
  boss_id: string | null;
  perfect_days: number;
  streak_before: number;
  streak_after: number;
  seen_at: string | null;
  /** That night's streak-rescue events (20260928000014_streak_recovery.sql). */
  rescue_events: RescueEvent[];
  /** His Night Raids that run (…16): total damage, and how many. */
  raid_damage: number;
  raids: number;
  // Dormant since …14 / …16 (party HP and escape are gone): party_damage,
  // healed, knocked_out, escaped_boss_id, next_boss_id, hp_before, hp_after,
  // max_hp — still columns, never written (0 / false / null).
};

/** One crack / rescue / halving, as a reset recorded it (reset_recaps.rescue_events). */
export type RescueEvent = {
  event: "cracked" | "rescued" | "halved";
  rescue_id: string;
  missed_day: string;
  /** Last day the rescue could be done (YYYY-MM-DD). */
  due_on: string;
  streak_at_crack: number;
  streak_after: number;
  /** The empty-pool fallback: "finish any quest on due_on". */
  fallback: boolean;
  /** cracked: how many jobs he was offered. */
  offered_count?: number;
  /** rescued / halved: the job he'd picked, if any. */
  job_title?: string | null;
};

/** A parent-set rescue job (rescue_jobs). */
export type RescueJob = {
  id: string;
  family_id: string;
  title: string;
  minutes: number;
  active: boolean;
  created_by: string | null;
  created_at: string;
};

/** A job offered to him when his streak cracked (a snapshot of a rescue job). */
export type OfferedRescueJob = { job_id: string; title: string; minutes: number };

/**
 * A cracked streak's rescue (streak_rescues): open until the nightly reset
 * resolves it — rescued (back to streak_at_crack) or lapsed (halved).
 */
export type StreakRescue = {
  id: string;
  family_id: string;
  child_id: string;
  missed_day: string;
  streak_at_crack: number;
  due_on: string;
  offered: OfferedRescueJob[];
  fallback: boolean;
  job_id: string | null;
  job_title: string | null;
  minutes: number | null;
  picked_at: string | null;
  completed_at: string | null;
  completed_on: string | null;
  status: "open" | "rescued" | "lapsed";
  resolved_on: string | null;
  streak_after: number | null;
  created_at: string;
};

/** Tonight's opportunity, right now (tonight_stakes(), …16). */
export type TonightStakes = {
  today: string;
  timezone: string;
  boss_active: boolean;
  boss_name: string | null;
  boss_hp: number | null;
  boss_max_hp: number | null;
  /** The caller's own open quests up to today. */
  my_open_quests: number;
  open_quests: number;
  open_minutes: number;
  /**
   * What his Night Raid would deal tonight if he finishes them all (a perfect
   * day): 0 with no boss, or a boss already at 1 HP.
   */
  raid_damage: number;
  /** His streak is frozen by an open rescue. */
  rescue_open: boolean;
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
  /** Night Raids this run, in order (…16). */
  raids: { child_id: string; day: string; amount: number; hp_after: number }[];
  raid_damage: number;
  defeated: string | null;
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
        | "id"
        | "status"
        | "week_start_date"
        | "queue_position"
        | "created_at"
        | "base_max_hp"
        | "active_since"
      >;
      boss_log: Table<
        BossLog,
        "id" | "amount" | "source_task_slot_id" | "child_id" | "created_at"
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
      // (party_health, party_log and potions are dormant since …16: not typed,
      // so nothing new reads them.)
      reset_recaps: Table<ResetRecap, "id" | "created_at" | "seen_at" | "rescue_events" | "raid_damage" | "raids">;
      rescue_jobs: Table<RescueJob, "id" | "minutes" | "active" | "created_by" | "created_at">;
      // Read-only through the API (the reset and the functions below write it).
      streak_rescues: Table<
        StreakRescue,
        | "id"
        | "offered"
        | "fallback"
        | "job_id"
        | "job_title"
        | "minutes"
        | "picked_at"
        | "completed_at"
        | "completed_on"
        | "status"
        | "resolved_on"
        | "streak_after"
        | "created_at"
      >;
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
      acknowledge_recaps: { Args: { p_through: string }; Returns: number };
      tonight_stakes: { Args: Record<string, never>; Returns: TonightStakes | null };
      // The child's rescue (20260928000014_streak_recovery.sql).
      pick_rescue_job: { Args: { p_rescue_id: string; p_job_id: string }; Returns: StreakRescue };
      complete_rescue: {
        Args: { p_rescue_id: string };
        Returns: { rescue: StreakRescue; boss_hit: boolean };
      };
      run_daily_reset_all: {
        Args: Record<string, never>;
        Returns: (DailyResetResult | { family_id: string; error: string })[];
      };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};
