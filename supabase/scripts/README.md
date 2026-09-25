# supabase/scripts — manual, hand-run SQL

These are **one-off reference scripts, not migrations.** Nothing runs them
automatically: the Supabase CLI only applies `supabase/migrations/`, and no
app code, cron job or test touches this folder.

Each script is pasted into the Supabase SQL editor by hand, after reading it.
They can be destructive and are **scoped to one specific `family_id`,
hardcoded inside** (with a comment on how it was found) — check that id
before running one against any other project or family.

| Script | What it does |
|---|---|
| `reset-family-progress.sql` | Resets one family's game progress and boss roster for testing: deletes its bosses (boss_log cascades), recaps, quest slots, reward requests and party log; zeroes the children's stats; refills party HP; reseeds all 12 bosses and activates the first. One transaction, with a guard that aborts unless the family matches. **Wipes every child in that family** (Reuben included), not just a test child. Needs migration `20260927000013` applied first. |
