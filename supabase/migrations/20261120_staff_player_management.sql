-- Staff-only player directory, display-name editing, and whitelist revocation.
-- Execute in the Supabase SQL Editor.

create or replace function public.lcfms_staff_list_players()
returns table (
  player_id uuid,
  discord_user_id text,
  display_name text,
  rank_name text,
  access_status text,
  roblox_username text
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not exists (
    select 1 from public.profiles actor
    where actor.id = auth.uid()
      and actor.access_status = 'approved'
      and actor.role in ('owner','senior_management','management','staff')
  ) then
    raise exception 'Staff access required.';
  end if;

  return query
  select p.id, p.discord_user_id, p.display_name, p.rank_name, p.access_status,
    (select wa.roblox_username
       from public.whitelist_applications wa
      where wa.discord_user_id = p.discord_user_id
      order by (wa.status = 'approved') desc, wa.submitted_at desc
      limit 1)
  from public.profiles p
  where p.role = 'player'
  order by coalesce(p.display_name, ''), p.id;
end;
$$;

create or replace function public.lcfms_staff_update_player_name(
  p_player_id uuid,
  p_display_name text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_discord_id text;
begin
  if not exists (
    select 1 from public.profiles actor
    where actor.id = auth.uid()
      and actor.access_status = 'approved'
      and actor.role in ('owner','senior_management','management','staff')
  ) then
    raise exception 'Staff access required.';
  end if;

  if p_display_name is null or length(trim(p_display_name)) not between 1 and 60 then
    raise exception 'Display name must be between 1 and 60 characters.';
  end if;

  update public.profiles
     set display_name = trim(p_display_name)
   where id = p_player_id and role = 'player'
   returning discord_user_id into v_discord_id;

  if not found then raise exception 'Player account not found.'; end if;

  if v_discord_id is not null then
    update public.discord_members
       set discord_display_name = trim(p_display_name),
           updated_at = now()
     where discord_user_id = v_discord_id;
  end if;
end;
$$;

create or replace function public.lcfms_staff_kick_player(p_player_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_discord_id text;
begin
  if not exists (
    select 1 from public.profiles actor
    where actor.id = auth.uid()
      and actor.access_status = 'approved'
      and actor.role in ('owner','senior_management','management','staff')
  ) then
    raise exception 'Staff access required.';
  end if;

  if p_player_id = auth.uid() then
    raise exception 'You cannot kick your own account.';
  end if;

  select p.discord_user_id into v_discord_id
    from public.profiles p
   where p.id = p_player_id and p.role = 'player'
   for update;

  if not found then raise exception 'Player account not found.'; end if;

  -- Mark every previous approval rejected so the public application flow allows a fresh application.
  update public.whitelist_applications
     set status = 'rejected',
         reviewed_by = auth.uid(),
         reviewed_at = now(),
         review_note = 'LCFMS access revoked by staff. A new whitelist application is required.'
   where discord_user_id = v_discord_id and status = 'approved';

  update public.whitelist_access
     set is_whitelisted = false,
         updated_at = now()
   where discord_user_id = v_discord_id;

  update public.discord_members
     set whitelist_status = 'rejected',
         updated_at = now()
   where discord_user_id = v_discord_id;

  update public.profiles
     set access_status = 'revoked'
   where id = p_player_id and role = 'player';
end;
$$;

revoke all on function public.lcfms_staff_list_players() from public, anon;
revoke all on function public.lcfms_staff_update_player_name(uuid,text) from public, anon;
revoke all on function public.lcfms_staff_kick_player(uuid) from public, anon;
grant execute on function public.lcfms_staff_list_players() to authenticated;
grant execute on function public.lcfms_staff_update_player_name(uuid,text) to authenticated;
grant execute on function public.lcfms_staff_kick_player(uuid) to authenticated;
