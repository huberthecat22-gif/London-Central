-- Atomic capacity-safe training registration. Only the service-role bot may call this function.
create or replace function public.lcfms_training_signup(
  p_training_notice_id uuid,
  p_discord_user_id text,
  p_discord_username text
) returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  notice_max integer;
  current_count integer;
begin
  select maximum_trainees into notice_max
  from public.training_notices
  where id = p_training_notice_id
  for update;

  if notice_max is null then
    return 'not_found';
  end if;

  if exists (
    select 1 from public.training_notice_signups
    where training_notice_id = p_training_notice_id
      and discord_user_id = p_discord_user_id
  ) then
    return 'already_signed_up';
  end if;

  select count(*) into current_count
  from public.training_notice_signups
  where training_notice_id = p_training_notice_id;

  if current_count >= notice_max then
    return 'full';
  end if;

  insert into public.training_notice_signups(training_notice_id,discord_user_id,discord_username)
  values(p_training_notice_id,p_discord_user_id,p_discord_username);

  return 'signed_up';
end;
$$;

revoke all on function public.lcfms_training_signup(uuid,text,text) from public, anon, authenticated;
grant execute on function public.lcfms_training_signup(uuid,text,text) to service_role;
