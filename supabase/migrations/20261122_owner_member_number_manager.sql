-- LCFMS owner-managed member identifiers: text codes, including letters.
-- Existing numeric identifiers are preserved as text and remain reserved.

alter table public.discord_members
  drop constraint if exists discord_members_member_number_fkey;
alter table public.member_number_registry
  drop constraint if exists member_number_registry_member_number_check;

alter table public.member_number_registry
  alter column member_number type text using member_number::text;
alter table public.discord_members
  alter column member_number type text using member_number::text;

alter table public.discord_members
  add constraint discord_members_member_number_fkey
  foreign key (member_number)
  references public.member_number_registry(member_number);

alter table public.discord_members
  add column if not exists nickname_sync_pending boolean not null default false;

drop function if exists public.lcfms_allocate_member_number(text,text,text);
drop function if exists public.lcfms_set_member_number(text,integer);

create or replace function public.lcfms_allocate_member_number(
  p_discord_user_id text,
  p_username text,
  p_display_name text
)
returns table(member_number text, nickname text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_number text;
  v_name text;
  v_nickname text;
  v_attempt integer := 0;
begin
  if p_discord_user_id is null or length(trim(p_discord_user_id)) = 0 then
    raise exception 'Discord user ID is required';
  end if;

  select dm.member_number, dm.nickname into v_number, v_nickname
  from public.discord_members dm where dm.discord_user_id = p_discord_user_id;
  if found then
    return query select v_number, v_nickname;
    return;
  end if;

  v_name := coalesce(nullif(trim(p_display_name), ''), nullif(trim(p_username), ''), 'Member');
  loop
    v_number := (floor(random() * 8889)::integer + 1111)::text;
    begin
      insert into public.member_number_registry(member_number, discord_user_id)
      values (v_number, p_discord_user_id);
      exit;
    exception when unique_violation then
      v_attempt := v_attempt + 1;
      if v_attempt > 200 then
        raise exception 'Unable to allocate a free member number';
      end if;
    end;
  end loop;

  v_nickname := '[' || v_number || '] ' || v_name;
  insert into public.discord_members(
    discord_user_id, discord_username, discord_display_name,
    member_number, nickname, nickname_sync_pending
  ) values (
    p_discord_user_id, coalesce(p_username,''), p_display_name,
    v_number, v_nickname, true
  );
  return query select v_number, v_nickname;
end;
$$;

create or replace function public.lcfms_owner_set_member_number(
  p_discord_user_id text,
  p_new_member_number text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old text;
  v_name text;
  v_new text := upper(trim(coalesce(p_new_member_number,'')));
begin
  if not public.lcfms_is_owner() then
    raise exception 'Only the LCFMS Owner can change member numbers';
  end if;
  if v_new !~ '^[A-Z0-9]{1,12}$' then
    raise exception 'Use 1 to 12 letters or numbers, with no spaces or symbols';
  end if;

  select member_number,
    coalesce(nullif(trim(discord_display_name),''), nullif(trim(discord_username),''), 'Member')
  into v_old, v_name
  from public.discord_members
  where discord_user_id = p_discord_user_id
  for update;

  if not found then
    raise exception 'Member record not found';
  end if;
  if v_old = v_new then return; end if;

  insert into public.member_number_registry(member_number, discord_user_id)
  values (v_new, p_discord_user_id);

  update public.discord_members
  set member_number = v_new,
      nickname = '[' || v_new || '] ' ||
        coalesce(nullif(trim(custom_prefix),'' ) || ' ', '') ||
        v_name ||
        coalesce(' ' || nullif(trim(custom_suffix),''), ''),
      custom_nickname = null,
      nickname_sync_pending = true,
      updated_at = now()
  where discord_user_id = p_discord_user_id;
end;
$$;

revoke all on function public.lcfms_allocate_member_number(text,text,text) from public, anon, authenticated;
grant execute on function public.lcfms_allocate_member_number(text,text,text) to service_role;
revoke all on function public.lcfms_owner_set_member_number(text,text) from public, anon;
grant execute on function public.lcfms_owner_set_member_number(text,text) to authenticated;
