-- Waitlist for hosted live mode (OT-091 capture; OT-121 upgrades it into a
-- demand instrument). Email plus the one question. RLS on, no policies:
-- only the server writes and reads.
create table public.waitlist (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  -- "What would your agent buy, and what is that worth to you per month?"
  answer text,
  created_at timestamptz not null default now()
);

alter table public.waitlist enable row level security;
