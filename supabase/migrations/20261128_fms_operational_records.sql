-- LCFMS operational workbench records for CAD/MDT, custody, HR, fleet, forms and notifications.
create table if not exists public.fms_records (
 id uuid primary key default gen_random_uuid(),
 module text not null check (module in ('cad','mdt','pnc','custody','hr','fleet','forms','notifications')),
 title text not null check (char_length(trim(title)) between 1 and 180),
 reference text not null default '' check (char_length(reference)<=120),
 status text not null default 'Open' check (char_length(status)<=60),
 details text not null default '' check (char_length(details)<=10000),
 created_by uuid not null references auth.users(id) on delete restrict,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create index if not exists fms_records_module_created_idx on public.fms_records(module,created_at desc);
create index if not exists fms_records_module_status_idx on public.fms_records(module,status);
alter table public.fms_records enable row level security;
drop policy if exists "Approved members can read operational records" on public.fms_records;
create policy "Approved members can read operational records" on public.fms_records
 for select to authenticated using (
  exists(select 1 from public.profiles p where p.id=auth.uid() and p.access_status='approved')
 );
drop policy if exists "Authorised staff can create operational records" on public.fms_records;
create policy "Authorised staff can create operational records" on public.fms_records
 for insert to authenticated with check (
  created_by=auth.uid() and exists(select 1 from public.profiles p where p.id=auth.uid()
   and p.access_status='approved' and p.role in ('owner','senior_management','management','staff'))
 );
drop policy if exists "Authorised staff can update operational records" on public.fms_records;
create policy "Authorised staff can update operational records" on public.fms_records
 for update to authenticated using (
  exists(select 1 from public.profiles p where p.id=auth.uid()
   and p.access_status='approved' and p.role in ('owner','senior_management','management','staff'))
 ) with check (
  exists(select 1 from public.profiles p where p.id=auth.uid()
   and p.access_status='approved' and p.role in ('owner','senior_management','management','staff'))
 );
grant select,insert,update on public.fms_records to authenticated;

-- Email/password staff accounts can publish training notices through their approved staff role.
drop policy if exists "Authorised Discord users can publish training notices" on public.training_notices;
create policy "Authorised staff can publish training notices" on public.training_notices
 for insert to authenticated with check (
  created_by=auth.uid() and (
   exists(select 1 from public.profiles p where p.id=auth.uid() and p.access_status='approved'
    and p.role in ('owner','senior_management','management','staff'))
   or coalesce(auth.jwt()->'app_metadata'->>'provider_id',auth.jwt()->'user_metadata'->>'sub',
    auth.jwt()->'user_metadata'->>'provider_id') in
    ('1562514652297035787','1562514998146764810','1562514757259632821')
  )
 );
drop policy if exists "Authorised Discord users can delete training notices" on public.training_notices;
create policy "Authorised staff can delete training notices" on public.training_notices
 for delete to authenticated using (
  exists(select 1 from public.profiles p where p.id=auth.uid() and p.access_status='approved'
   and p.role in ('owner','senior_management','management','staff'))
  or coalesce(auth.jwt()->'app_metadata'->>'provider_id',auth.jwt()->'user_metadata'->>'sub',
   auth.jwt()->'user_metadata'->>'provider_id') in
   ('1562514652297035787','1562514998146764810','1562514757259632821')
 );
