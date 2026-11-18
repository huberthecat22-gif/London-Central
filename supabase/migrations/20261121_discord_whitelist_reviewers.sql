-- Allow linked Discord members with the configured reviewer role to review whitelist applications.
-- Run this migration in the Supabase SQL Editor.

alter table public.profiles
  add column if not exists discord_user_id text;

create table if not exists public.discord_whitelist_reviewers (
  discord_user_id text primary key,
  role_id text not null,
  synced_at timestamptz not null default now()
);

alter table public.discord_whitelist_reviewers enable row level security;

create or replace function public.lcfms_can_review_whitelist()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.access_status = 'approved'
      and (
        p.role in ('owner','senior_management','management')
        or exists (
          select 1
          from public.discord_whitelist_reviewers r
          where r.discord_user_id = p.discord_user_id
        )
      )
  );
$$;

drop policy if exists "managers read whitelist applications" on public.whitelist_applications;
create policy "authorised reviewers read whitelist applications"
on public.whitelist_applications
for select to authenticated
using (public.lcfms_can_review_whitelist());

drop policy if exists "managers update whitelist applications" on public.whitelist_applications;
create policy "authorised reviewers update whitelist applications"
on public.whitelist_applications
for update to authenticated
using (public.lcfms_can_review_whitelist())
with check (public.lcfms_can_review_whitelist());

grant execute on function public.lcfms_can_review_whitelist() to authenticated;

-- Only the trusted bot service role may maintain the synced Discord role roster.
revoke all on public.discord_whitelist_reviewers from anon, authenticated;
grant select, insert, update, delete on public.discord_whitelist_reviewers to service_role;

-- Secure self-linking: the Discord bot issues a short-lived code via /link.
create table if not exists public.discord_link_codes (
  code text primary key,
  discord_user_id text not null,
  expires_at timestamptz not null
);
alter table public.discord_link_codes enable row level security;
revoke all on public.discord_link_codes from public, anon, authenticated;
grant select, insert, update, delete on public.discord_link_codes to service_role;

create or replace function public.lcfms_link_discord_account(p_code text)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_discord_user_id text;
begin
  if auth.uid() is null then
    raise exception 'Please sign in first.';
  end if;

  select discord_user_id into v_discord_user_id
  from public.discord_link_codes
  where code = upper(trim(p_code))
    and expires_at > now();

  if v_discord_user_id is null then
    raise exception 'Link code is invalid or has expired. Generate a new one in Discord with /link.';
  end if;

  if exists (
    select 1 from public.profiles
    where discord_user_id = v_discord_user_id
      and id <> auth.uid()
  ) then
    raise exception 'That Discord account is already linked to another LCFMS account.';
  end if;

  update public.profiles
  set discord_user_id = v_discord_user_id
  where id = auth.uid()
    and access_status = 'approved';

  if not found then
    raise exception 'Your LCFMS account is not approved.';
  end if;

  delete from public.discord_link_codes where code = upper(trim(p_code));
  return true;
end;
$$;

revoke all on function public.lcfms_link_discord_account(text) from public, anon;
grant execute on function public.lcfms_link_discord_account(text) to authenticated;
