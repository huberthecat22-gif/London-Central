-- LCFMS initial database schema.
-- Run this in Supabase SQL Editor after creating your project.
-- This creates the core tables and enables row-level security.
-- Have the project owner create/invite users; public self-registration should remain disabled.

create type public.lcfms_access_status as enum ('pending','approved','suspended');
create type public.lcfms_role as enum ('owner','senior_management','management','staff');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  roblox_user_id bigint unique,
  roblox_username text,
  rank_name text not null default 'Pending',
  role public.lcfms_role not null default 'staff',
  access_status public.lcfms_access_status not null default 'pending',
  created_at timestamptz not null default now()
);

create table public.staff_records (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid references public.profiles(id) on delete set null,
  roblox_user_id bigint,
  roblox_username text not null,
  rank_name text not null,
  department text,
  status text not null default 'Active',
  created_at timestamptz not null default now()
);

create table public.training_sessions (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  instructor text not null,
  starts_at timestamptz,
  status text not null default 'Scheduled',
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

create table public.applications (
  id uuid primary key default gen_random_uuid(),
  applicant_roblox_id bigint,
  applicant_username text not null,
  application_type text not null,
  status text not null default 'Under review',
  submitted_at timestamptz not null default now()
);

create table public.announcements (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  body text not null,
  published boolean not null default false,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

create table public.audit_log (
  id bigint generated always as identity primary key,
  actor uuid references public.profiles(id),
  action text not null,
  target_type text,
  target_id text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;
alter table public.staff_records enable row level security;
alter table public.training_sessions enable row level security;
alter table public.applications enable row level security;
alter table public.announcements enable row level security;
alter table public.audit_log enable row level security;

-- Approved users can read the approved staff directory.
create policy "approved users read profiles" on public.profiles for select to authenticated
using (exists(select 1 from public.profiles me where me.id=auth.uid() and me.access_status='approved'));

create policy "users read own profile" on public.profiles for select to authenticated
using (id=auth.uid());

create policy "approved users read staff records" on public.staff_records for select to authenticated
using (exists(select 1 from public.profiles me where me.id=auth.uid() and me.access_status='approved'));

create policy "approved users read training" on public.training_sessions for select to authenticated
using (exists(select 1 from public.profiles me where me.id=auth.uid() and me.access_status='approved'));

create policy "approved users read published announcements" on public.announcements for select to authenticated
using (published=true and exists(select 1 from public.profiles me where me.id=auth.uid() and me.access_status='approved'));

-- Intentionally no browser-side insert/update/delete policies yet.
-- Add role-checked server-side functions before enabling management actions.
