-- Public no-login whitelist submissions for LCFMS.
-- Run once in Supabase SQL Editor after the existing Discord whitelist migration.

alter table public.whitelist_applications
  alter column discord_user_id drop not null;

alter table public.whitelist_applications
  add column if not exists discord_contact text;

drop policy if exists "public can submit whitelist requests" on public.whitelist_applications;
create policy "public can submit whitelist requests"
on public.whitelist_applications
for insert
to anon
with check (
  discord_user_id is null
  and status = 'pending'
  and reviewed_by is null
  and reviewed_at is null
  and review_note is null
  and answers = '{}'::jsonb
  and length(trim(roblox_username)) between 3 and 20
  and discord_contact is not null
  and length(trim(discord_contact)) between 2 and 80
);

grant insert (discord_contact, roblox_username, status)
on public.whitelist_applications to anon;
