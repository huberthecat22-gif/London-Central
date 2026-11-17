-- LCFMS Discord + whitelist foundation
-- Run once in Supabase SQL Editor. Do not put a service-role key in browser code.
-- Member numbers are permanently reserved, including after a member leaves.

create table if not exists public.member_number_registry (
  member_number integer primary key check (member_number between 1111 and 9999),
  discord_user_id text not null,
  reserved_at timestamptz not null default now()
);

create table if not exists public.discord_members (
  discord_user_id text primary key,
  discord_username text not null,
  discord_display_name text,
  member_number integer not null unique references public.member_number_registry(member_number),
  nickname text not null,
  custom_prefix text not null default '',
  custom_suffix text not null default '',
  custom_nickname text,
  roblox_user_id bigint,
  roblox_username text,
  whitelist_status text not null default 'not_submitted'
    check (whitelist_status in ('not_submitted','pending','approved','rejected','suspended')),
  joined_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.whitelist_applications (
  id uuid primary key default gen_random_uuid(),
  discord_user_id text not null references public.discord_members(discord_user_id),
  roblox_username text not null,
  roblox_user_id bigint,
  answers jsonb not null default '{}'::jsonb,
  status text not null default 'pending'
    check (status in ('pending','approved','rejected','withdrawn')),
  reviewed_by uuid references public.profiles(id),
  reviewed_at timestamptz,
  review_note text,
  submitted_at timestamptz not null default now()
);

create table if not exists public.whitelist_access (
  discord_user_id text primary key references public.discord_members(discord_user_id),
  roblox_user_id bigint not null,
  roblox_username text not null,
  is_whitelisted boolean not null default false,
  approved_at timestamptz,
  approved_by uuid references public.profiles(id),
  updated_at timestamptz not null default now()
);

create table if not exists public.lcfms_bot_settings (
  id boolean primary key default true check (id),
  guild_id text,
  whitelist_role_id text,
  applications_channel_id text,
  notices_channel_id text,
  updated_at timestamptz not null default now()
);

-- SECURITY DEFINER helpers avoid recursive profiles-table RLS policies.
create or replace function public.lcfms_is_manager()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.access_status = 'approved'
      and p.role in ('owner','senior_management','management')
  );
$$;

create or replace function public.lcfms_is_owner()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.access_status = 'approved'
      and p.role = 'owner'
  );
$$;

-- Atomic random allocation. Called by the trusted bot backend using service_role.
create or replace function public.lcfms_allocate_member_number(p_discord_user_id text, p_username text, p_display_name text)
returns table(member_number integer, nickname text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_number integer;
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
    v_number := floor(random() * 8889)::integer + 1111;
    begin
      insert into public.member_number_registry(member_number, discord_user_id)
      values (v_number, p_discord_user_id);
      exit;
    exception when unique_violation then
      v_attempt := v_attempt + 1;
      if v_attempt > 200 then
        raise exception 'Unable to allocate a free member number; number pool may be exhausted';
      end if;
    end;
  end loop;

  v_nickname := '[' || v_number::text || '] ' || v_name;
  insert into public.discord_members(discord_user_id, discord_username, discord_display_name, member_number, nickname)
  values (p_discord_user_id, coalesce(p_username,''), p_display_name, v_number, v_nickname);

  return query select v_number, v_nickname;
end;
$$;

-- Trusted bot backend only. Existing reservations are never deleted.
create or replace function public.lcfms_set_member_number(p_discord_user_id text, p_new_number integer)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old integer;
  v_name text;
begin
  if p_new_number < 1111 or p_new_number > 9999 then
    raise exception 'Member number must be between 1111 and 9999';
  end if;
  select member_number, coalesce(nullif(custom_nickname,''), discord_display_name, discord_username, 'Member')
    into v_old, v_name
  from public.discord_members where discord_user_id = p_discord_user_id for update;
  if not found then raise exception 'Discord member not found'; end if;
  if v_old = p_new_number then return; end if;

  -- Reserve the new number permanently; the old number remains in the registry.
  insert into public.member_number_registry(member_number, discord_user_id)
  values (p_new_number, p_discord_user_id);

  update public.discord_members
  set member_number = p_new_number,
      nickname = '[' || p_new_number::text || '] ' || v_name,
      updated_at = now()
  where discord_user_id = p_discord_user_id;
end;
$$;

alter table public.member_number_registry enable row level security;
alter table public.discord_members enable row level security;
alter table public.whitelist_applications enable row level security;
alter table public.whitelist_access enable row level security;
alter table public.lcfms_bot_settings enable row level security;

drop policy if exists "managers read member number registry" on public.member_number_registry;
create policy "managers read member number registry" on public.member_number_registry
for select to authenticated using (public.lcfms_is_manager());

drop policy if exists "managers read discord members" on public.discord_members;
create policy "managers read discord members" on public.discord_members
for select to authenticated using (public.lcfms_is_manager());

drop policy if exists "managers update discord members" on public.discord_members;
create policy "managers update discord members" on public.discord_members
for update to authenticated using (public.lcfms_is_manager()) with check (public.lcfms_is_manager());

drop policy if exists "managers read whitelist applications" on public.whitelist_applications;
create policy "managers read whitelist applications" on public.whitelist_applications
for select to authenticated using (public.lcfms_is_manager());

drop policy if exists "managers update whitelist applications" on public.whitelist_applications;
create policy "managers update whitelist applications" on public.whitelist_applications
for update to authenticated using (public.lcfms_is_manager()) with check (public.lcfms_is_manager());

drop policy if exists "managers read whitelist access" on public.whitelist_access;
create policy "managers read whitelist access" on public.whitelist_access
for select to authenticated using (public.lcfms_is_manager());

drop policy if exists "owner manages bot settings" on public.lcfms_bot_settings;
create policy "owner manages bot settings" on public.lcfms_bot_settings
for all to authenticated using (public.lcfms_is_owner()) with check (public.lcfms_is_owner());

revoke all on function public.lcfms_allocate_member_number(text,text,text) from public, anon, authenticated;
revoke all on function public.lcfms_set_member_number(text,integer) from public, anon, authenticated;
grant execute on function public.lcfms_allocate_member_number(text,text,text) to service_role;
grant execute on function public.lcfms_set_member_number(text,integer) to service_role;
grant execute on function public.lcfms_is_manager() to authenticated;
grant execute on function public.lcfms_is_owner() to authenticated;
