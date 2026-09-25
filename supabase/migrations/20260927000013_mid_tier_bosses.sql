-- Family Quest: add the four mid-tier bosses to the roster for new families.
--
-- The roster from 20260923000006 has 4 low + 4 epic bosses. The mid tier
-- was always planned: activate_next_boss() already orders low → mid → epic,
-- and finish_boss() already pays mid-tier gold / XP (50 / 100). Nothing
-- seeded any mid bosses until now.
--
-- seed_family_bosses() now seeds all 12 bosses. It runs only for a family
-- with no bosses yet (new families), so existing families' rosters are
-- untouched. Their mid-tier rows will come in a separate migration once
-- the bosses are animated and their place in the queue is decided (the
-- live family is already on the epic tier).
--
-- Mid HP (180 / 210 / 240 / 270) continues the low tier's 30-HP steps
-- (60 … 150) up to the epic tier's first boss (300).
--
-- Art: these sprite keys have no manifest yet. bossAnimations() returns
-- null for an unknown key, so the battle scene shows a placeholder instead
-- of failing.

create or replace function public.seed_family_bosses(p_family_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from public.bosses where family_id = p_family_id) then
    return;
  end if;

  -- Tunable: HP at 1 minute of completed work = 1 damage.
  insert into public.bosses
    (family_id, name, tier, sprite_key, max_hp, current_hp, queue_position)
  values
    (p_family_id, 'Trash-Bag Slime',       'low',  'trash_bag_slime',        60,  60, 1),
    (p_family_id, 'Alarm Clock Swarm',     'low',  'alarm_clock_swarm',      90,  90, 2),
    (p_family_id, 'Laundry Goblin',        'low',  'laundry_goblin',        120, 120, 3),
    (p_family_id, 'Cable Spider',          'low',  'cable_spider',          150, 150, 4),
    (p_family_id, 'Swamp-Bag Ooze',        'mid',  'swamp_bag_ooze',        180, 180, 1),
    (p_family_id, 'Tupperware Troll',      'mid',  'tupperware_troll',      210, 210, 2),
    (p_family_id, 'Scatter-Brick Serpent', 'mid',  'scatter_brick_serpent', 240, 240, 3),
    (p_family_id, 'Mud-Track Minotaur',    'mid',  'mud_track_minotaur',    270, 270, 4),
    (p_family_id, 'Magma Behemoth',        'epic', 'magma_behemoth',        300, 300, 1),
    (p_family_id, 'Chronosphinx',          'epic', 'chronosphinx',          360, 360, 2),
    (p_family_id, 'Abyssal Kraken',        'epic', 'abyssal_kraken',        420, 420, 3),
    (p_family_id, 'Shogun-Bot',            'epic', 'shogun_bot',            500, 500, 4);
end;
$$;

revoke all on function public.seed_family_bosses(uuid) from public, anon, authenticated;
