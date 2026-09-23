-- Family Quest: make sure the RPG tables broadcast Realtime changes.
--
-- 20260922000002_rls.sql already adds these to the supabase_realtime
-- publication, but if that statement didn't take effect on a live project,
-- boss / party HP changes from the daily reset never reach clients. This is
-- idempotent: tables already in the publication are left alone, so it's
-- safe to run whether or not they're missing (and safe to re-run).

do $$
declare
  t text;
begin
  foreach t in array array['bosses', 'boss_log', 'party_health', 'player_stats'] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
      raise notice 'Added public.% to supabase_realtime', t;
    end if;
  end loop;
end;
$$;
