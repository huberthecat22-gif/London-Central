-- Fix recursive profiles RLS introduced by the approved-member access policy.
-- A SECURITY DEFINER helper reads the current user's approval without invoking
-- the profiles SELECT policy recursively.

create or replace function public.lcfms_current_user_is_approved()
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
  );
$$;

revoke all on function public.lcfms_current_user_is_approved() from public, anon;
grant execute on function public.lcfms_current_user_is_approved() to authenticated;

drop policy if exists "approved users read profiles" on public.profiles;
create policy "approved users read profiles"
on public.profiles
for select
to authenticated
using (public.lcfms_current_user_is_approved());
