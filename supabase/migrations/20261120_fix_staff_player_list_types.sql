-- Fix the STAFF player-list RPC return-type mismatch.
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
  select
    p.id::uuid,
    p.discord_user_id::text,
    p.display_name::text,
    p.rank_name::text,
    p.access_status::text,
    (
      select wa.roblox_username::text
      from public.whitelist_applications wa
      where wa.discord_user_id = p.discord_user_id
      order by (wa.status = 'approved') desc, wa.submitted_at desc
      limit 1
    )::text
  from public.profiles p
  where p.role = 'player'
  order by coalesce(p.display_name::text, ''), p.id;
end;
$$;

revoke all on function public.lcfms_staff_list_players() from public, anon;
grant execute on function public.lcfms_staff_list_players() to authenticated;
