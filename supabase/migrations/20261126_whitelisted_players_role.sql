-- Separate normal whitelisted players from staff accounts.
-- A verified Discord OAuth identity must match an approved whitelist application.

create or replace function public.lcfms_sync_discord_member_profile()
returns void
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_discord_id text;
  v_display_name text;
begin
  if auth.uid() is null
     or coalesce(auth.jwt()->'app_metadata'->>'provider','') <> 'discord' then
    raise exception 'Please sign in with Discord.';
  end if;

  v_discord_id := coalesce(
    auth.jwt()->'user_metadata'->>'provider_id',
    auth.jwt()->'user_metadata'->>'sub'
  );

  if v_discord_id is null or v_discord_id !~ '^[0-9]{17,20}$' then
    raise exception 'Could not verify your Discord account ID.';
  end if;

  if not exists (
    select 1
    from public.whitelist_applications wa
    where wa.discord_user_id = v_discord_id
      and wa.status = 'approved'
  ) then
    raise exception 'Your Discord account does not have an approved whitelist application.';
  end if;

  select coalesce(
    (select nullif(dm.discord_display_name,'')
       from public.discord_members dm
      where dm.discord_user_id = v_discord_id
      limit 1),
    (select nullif(dm.discord_username,'')
       from public.discord_members dm
      where dm.discord_user_id = v_discord_id
      limit 1),
    (select nullif(wa.roblox_username,'')
       from public.whitelist_applications wa
      where wa.discord_user_id = v_discord_id
        and wa.status = 'approved'
      order by wa.reviewed_at desc nulls last, wa.submitted_at desc
      limit 1),
    nullif(auth.jwt()->'user_metadata'->>'global_name',''),
    nullif(auth.jwt()->'user_metadata'->>'name',''),
    'LCFMS Player'
  ) into v_display_name;

  insert into public.profiles (
    id, display_name, rank_name, role, access_status, discord_user_id
  ) values (
    auth.uid(), v_display_name, 'Whitelisted Member', 'player', 'approved', v_discord_id
  )
  on conflict (id) do update
    set display_name = excluded.display_name,
        discord_user_id = excluded.discord_user_id,
        access_status = 'approved',
        rank_name = case
          when public.profiles.role in ('owner','senior_management','management')
            then public.profiles.rank_name
          when public.profiles.role = 'staff'
               and coalesce(public.profiles.rank_name,'') <> 'Whitelisted Member'
            then public.profiles.rank_name
          else 'Whitelisted Member'
        end,
        role = case
          when public.profiles.role in ('owner','senior_management','management')
            then public.profiles.role
          when public.profiles.role = 'staff'
               and coalesce(public.profiles.rank_name,'') <> 'Whitelisted Member'
            then public.profiles.role
          else 'player'
        end;
end;
$$;

revoke all on function public.lcfms_sync_discord_member_profile() from public, anon;
grant execute on function public.lcfms_sync_discord_member_profile() to authenticated;

-- Ensure the approved-profile policy does not recursively query itself.
create or replace function public.lcfms_current_user_is_approved()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.access_status = 'approved'
  );
$$;

revoke all on function public.lcfms_current_user_is_approved() from public, anon;
grant execute on function public.lcfms_current_user_is_approved() to authenticated;

drop policy if exists "approved users read profiles" on public.profiles;
create policy "approved users read profiles"
on public.profiles
for select to authenticated
using (public.lcfms_current_user_is_approved());

-- Correct profiles previously created by the earlier player-as-staff version.
update public.profiles
set role = 'player', rank_name = 'Whitelisted Member'
where role = 'staff' and rank_name = 'Whitelisted Member';
