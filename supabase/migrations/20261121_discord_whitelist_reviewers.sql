-- LCFMS: allow approved website accounts whose linked Discord account
-- currently holds the configured whitelist reviewer role to review applications.
-- The trusted Discord bot maintains discord_whitelist_reviewers.
-- Discord identity linking is handled separately through Discord OAuth (not /link codes).

alter table public.profiles
  add column if not exists discord_user_id text;

create unique index if not exists profiles_discord_user_id_unique
  on public.profiles (discord_user_id)
  where discord_user_id is not null;

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
        p.role in ('owner', 'senior_management', 'management')
        or exists (
          select 1
          from public.discord_whitelist_reviewers r
          where r.discord_user_id = p.discord_user_id
        )
      )
  );
$$;

drop policy if exists "managers read whitelist applications" on public.whitelist_applications;
drop policy if exists "authorised reviewers read whitelist applications" on public.whitelist_applications;
create policy "authorised reviewers read whitelist applications"
on public.whitelist_applications
for select to authenticated
using (public.lcfms_can_review_whitelist());

drop policy if exists "managers update whitelist applications" on public.whitelist_applications;
drop policy if exists "authorised reviewers update whitelist applications" on public.whitelist_applications;
create policy "authorised reviewers update whitelist applications"
on public.whitelist_applications
for update to authenticated
using (public.lcfms_can_review_whitelist())
with check (public.lcfms_can_review_whitelist());

revoke all on public.discord_whitelist_reviewers from anon, authenticated;
grant select, insert, update, delete on public.discord_whitelist_reviewers to service_role;

revoke all on function public.lcfms_can_review_whitelist() from public, anon;
grant execute on function public.lcfms_can_review_whitelist() to authenticated;

-- Remove the old one-time-code linking mechanism if it was previously installed.
drop function if exists public.lcfms_link_discord_account(text);
drop table if exists public.discord_link_codes;
