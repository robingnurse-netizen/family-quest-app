-- Family Quest: create a profile row whenever an auth user signs up.
--
-- The signup form passes options.data (raw_user_meta_data):
--   display_name : text                      (required)
--   role         : 'parent' | 'child'        (required)
--   family_name  : text   -> creates a new family (parents only)
--   invite_code  : text   -> joins an existing family
--
-- Doing this in a trigger (rather than from the client) means it works even
-- when email confirmation is on and there is no session yet, and a client
-- can never insert an arbitrary profile/role for itself.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  meta         jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  v_name       text  := nullif(trim(meta ->> 'display_name'), '');
  v_role       text  := meta ->> 'role';
  v_family     text  := nullif(trim(meta ->> 'family_name'), '');
  v_code       text  := upper(nullif(trim(meta ->> 'invite_code'), ''));
  v_family_id  uuid;
begin
  if v_name is null then
    raise exception 'display_name is required';
  end if;

  if v_role not in ('parent', 'child') then
    raise exception 'role must be parent or child';
  end if;

  if v_code is not null then
    select id into v_family_id from public.families where invite_code = v_code;
    if v_family_id is null then
      raise exception 'Invalid family invite code';
    end if;
  elsif v_family is not null then
    if v_role <> 'parent' then
      raise exception 'Only a parent can create a new family';
    end if;
    insert into public.families (name) values (v_family)
      returning id into v_family_id;
    insert into public.party_health (family_id) values (v_family_id);
  else
    raise exception 'Either family_name or invite_code is required';
  end if;

  insert into public.profiles (id, family_id, display_name, role)
  values (new.id, v_family_id, v_name, v_role);

  if v_role = 'child' then
    insert into public.player_stats (child_id) values (new.id);
  end if;

  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Lets the signup form check an invite code before creating the auth user
-- (a failed trigger only surfaces as a generic "Database error saving new
-- user"). Returns just the family name — nothing else is exposed.
create or replace function public.lookup_invite_code(code text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select name from public.families where invite_code = upper(trim(code))
$$;

revoke all on function public.lookup_invite_code(text) from public;
grant execute on function public.lookup_invite_code(text) to anon, authenticated;
