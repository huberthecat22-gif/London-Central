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
