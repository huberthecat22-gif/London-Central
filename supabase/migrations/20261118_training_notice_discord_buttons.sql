-- Discord delivery and registration tracking for training notices.
alter table public.training_notices
  add column if not exists discord_message_id text,
  add column if not exists discord_channel_id text;

create table if not exists public.training_notice_signups (
  id uuid primary key default gen_random_uuid(),
  training_notice_id uuid not null references public.training_notices(id) on delete cascade,
  discord_user_id text not null,
  discord_username text,
  signed_up_at timestamptz not null default now(),
  constraint training_notice_signups_one_per_member unique(training_notice_id,discord_user_id)
);

alter table public.training_notice_signups enable row level security;
-- Registration records are managed only by the Discord bot using the Supabase service-role key.
revoke all on public.training_notice_signups from anon, authenticated;
grant all on public.training_notice_signups to service_role;
