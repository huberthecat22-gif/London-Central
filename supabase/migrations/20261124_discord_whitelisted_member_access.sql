-- Allow members whose Discord account has an approved whitelist record to enter the FMS.
-- The Discord ID is read from the verified Supabase Discord OAuth identity, never from browser input.

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
  if auth.uid() is null or coalesce(auth.jwt()->'app_metadata'->>'provider','') <> 'discord' then
    raise exception 'Please sign in with Discord.';
  end if;

  v_discord_id := auth.jwt()->'user_metadata'->>'provider_id';
  if v_discord_id is null or v_discord_id !~ '^[0-9]{17,20}$' then
    raise exception 'Could not verify your Discord account ID.';
  end if;

  select coalesce(nullif(dm.discord_display_name,''), nullif(dm.discord_username,''), 'LCFMS Member')
    into v_display_name
  from public.discord_members dm
  where dm.discord_user_id = v_discord_id
    and dm.whitelist_status = 'approved';

  if v_display_name is null then
    raise exception 'Your Discord account does not have an approved whitelist record.';
  end if;

  insert into public.profiles (
    id, display_name, rank_name, role, access_status, discord_user_id
  ) values (
    auth.uid(), v_display_name, 'Whitelisted Member', 'staff', 'approved', v_discord_id
  )
  on conflict (id) do update
    set display_name = excluded.display_name,
        discord_user_id = excluded.discord_user_id,
        access_status = 'approved'
    where public.profiles.role = 'staff';
end;
$$;

revoke all on function public.lcfms_sync_discord_member_profile() from public, anon;
grant execute on function public.lcfms_sync_discord_member_profile() to authenticated;

-- Approved profiles may read the standard FMS workspace; privileged write controls remain
-- governed by the existing manager/owner policies.
drop policy if exists "approved users read profiles" on public.profiles;
create policy "approved users read profiles" on public.profiles
for select to authenticated
using (exists (
  select 1 from public.profiles me
  where me.id = auth.uid() and me.access_status = 'approved'
));
