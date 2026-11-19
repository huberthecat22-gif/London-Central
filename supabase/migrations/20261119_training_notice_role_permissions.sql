-- Sync Discord role membership so website permissions follow actual server roles.
create table if not exists public.discord_training_notice_creators (
  discord_user_id text not null,
  role_id text not null,
  synced_at timestamptz not null default now(),
  primary key (discord_user_id, role_id)
);
alter table public.discord_training_notice_creators enable row level security;
drop policy if exists "Authenticated users can check training creator membership" on public.discord_training_notice_creators;
create policy "Authenticated users can check training creator membership"
on public.discord_training_notice_creators for select to authenticated
using (true);
grant select on public.discord_training_notice_creators to authenticated;
grant select, insert, update, delete on public.discord_training_notice_creators to service_role;

drop policy if exists "Authorised Discord users can publish training notices" on public.training_notices;
create policy "Authorised Discord users can publish training notices"
on public.training_notices for insert to authenticated
with check (
  created_by = auth.uid()
  and exists (
    select 1 from public.discord_training_notice_creators c
    where c.discord_user_id = coalesce(
      auth.jwt() -> 'app_metadata' ->> 'provider_id',
      auth.jwt() -> 'user_metadata' ->> 'sub',
      auth.jwt() -> 'user_metadata' ->> 'provider_id'
    )
  )
);

drop policy if exists "Authorised Discord users can delete training notices" on public.training_notices;
create policy "Authorised Discord users can delete training notices"
on public.training_notices for delete to authenticated
using (
  exists (
    select 1 from public.discord_training_notice_creators c
    where c.discord_user_id = coalesce(
      auth.jwt() -> 'app_metadata' ->> 'provider_id',
      auth.jwt() -> 'user_metadata' ->> 'sub',
      auth.jwt() -> 'user_metadata' ->> 'provider_id'
    )
  )
);
