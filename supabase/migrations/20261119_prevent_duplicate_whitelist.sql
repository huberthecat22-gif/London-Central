-- Prevent duplicate public whitelist applications for the same Roblox username.
-- Pending and approved usernames cannot submit again. Rejected applications may be resubmitted.

create or replace function public.lcfms_submit_public_whitelist(
  p_roblox_username text,
  p_discord_contact text
)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_roblox text := trim(p_roblox_username);
  v_discord text := trim(p_discord_contact);
begin
  if v_roblox !~ '^[A-Za-z0-9_]{3,20}$' then
    raise exception 'Please enter a valid Roblox username.';
  end if;

  if v_discord is null or length(v_discord) < 2 or length(v_discord) > 80 then
    raise exception 'Please enter a valid Discord username or ID.';
  end if;

  if exists (
    select 1
    from public.whitelist_applications
    where lower(trim(roblox_username)) = lower(v_roblox)
      and status in ('pending', 'approved')
  ) then
    return 'already_submitted';
  end if;

  insert into public.whitelist_applications (
    discord_user_id, discord_contact, roblox_username, status, answers
  ) values (
    null, v_discord, v_roblox, 'pending', '{}'::jsonb
  );

  return 'submitted';
end;
$$;

revoke all on function public.lcfms_submit_public_whitelist(text, text) from public;
grant execute on function public.lcfms_submit_public_whitelist(text, text) to anon, authenticated;

-- Force public visitors to use the duplicate-checking function rather than direct inserts.
revoke insert on public.whitelist_applications from anon;
revoke insert (discord_contact, roblox_username, status) on public.whitelist_applications from anon;
