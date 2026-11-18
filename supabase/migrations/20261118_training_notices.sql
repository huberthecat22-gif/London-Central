-- LCFMS training notices
create table if not exists public.training_notices (
  id uuid primary key default gen_random_uuid(),
  module_name text not null,
  training_date date not null,
  training_time time not null,
  prerequisites text not null default 'None',
  maximum_trainees integer not null check (maximum_trainees > 0 and maximum_trainees <= 500),
  trainers text not null,
  observers text not null default '',
  observers_na boolean not null default false,
  location text not null default 'Waiting Room',
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);

alter table public.training_notices enable row level security;

drop policy if exists "Approved LCFMS members can view training notices" on public.training_notices;
create policy "Approved LCFMS members can view training notices"
on public.training_notices for select to authenticated
using (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.access_status = 'approved'
  )
);

drop policy if exists "Authorised Discord users can publish training notices" on public.training_notices;
create policy "Authorised Discord users can publish training notices"
on public.training_notices for insert to authenticated
with check (
  created_by = auth.uid()
  and coalesce(auth.jwt() -> 'app_metadata' ->> 'provider_id',
               auth.jwt() -> 'user_metadata' ->> 'sub',
               auth.jwt() -> 'user_metadata' ->> 'provider_id') in (
    '1562514652297035787',
    '1562514998146764810',
    '1562514757259632821'
  )
);

drop policy if exists "Authorised Discord users can delete training notices" on public.training_notices;
create policy "Authorised Discord users can delete training notices"
on public.training_notices for delete to authenticated
using (
  coalesce(auth.jwt() -> 'app_metadata' ->> 'provider_id',
           auth.jwt() -> 'user_metadata' ->> 'sub',
           auth.jwt() -> 'user_metadata' ->> 'provider_id') in (
    '1562514652297035787',
    '1562514998146764810',
    '1562514757259632821'
  )
);

grant select, insert, delete on public.training_notices to authenticated;
