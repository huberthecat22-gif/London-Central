-- Allow previously approved Roblox accounts to submit a fresh whitelist application.
-- Keep duplicate pending applications blocked, and stop the bot replaying historical approvals.

alter table public.whitelist_applications
  add column if not exists processed_at timestamptz;

-- Existing approvals have already been handled; only approvals made after this migration
-- should enter the bot's processing queue.
update public.whitelist_applications
set processed_at = coalesce(reviewed_at, submitted_at, now())
where status = 'approved'
  and processed_at is null;

create or replace function public.lcfms_submit_public_whitelist(
  p_roblox_username text,
  p_discord_contact text,
  p_discord_user_id text
)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_roblox text := trim(p_roblox_username);
  v_discord text := trim(p_discord_contact);
  v_discord_id text := trim(p_discord_user_id);
begin
  if v_roblox !~ '^[A-Za-z0-9_]{3,20}$' then
    raise exception 'Please enter a valid Roblox username.';
  end if;
  if v_discord is null or length(v_discord) < 2 or length(v_discord) > 80 then
    raise exception 'Please enter a valid Discord username.';
  end if;
  if v_discord_id !~ '^[0-9]{17,20}$' then
    raise exception 'Please enter a valid Discord User ID (17–20 digits).';
  end if;

  if exists (
    select 1
    from public.whitelist_applications
    where lower(trim(roblox_username)) = lower(v_roblox)
      and status = 'pending'
  ) then
    return 'already_submitted';
  end if;

  insert into public.whitelist_applications (
    discord_user_id, discord_contact, roblox_username, status, answers
  ) values (
    v_discord_id, v_discord, v_roblox, 'pending', '{}'::jsonb
  );

  return 'submitted';
end;
$$;

revoke all on function public.lcfms_submit_public_whitelist(text, text, text) from public;
grant execute on function public.lcfms_submit_public_whitelist(text, text, text) to anon, authenticated;
