-- Agent API keys (OT-025): scoped to one tab, revocable, rotatable.
-- The key secret (molt_sk_test_...) is shown once at creation and never
-- stored - only its SHA-256 hash. The prefix is kept for display.

create table public.agent_keys (
  id uuid primary key default gen_random_uuid(),
  tab_id uuid not null references public.tabs (id) on delete cascade,
  user_id uuid not null references public.users (id) on delete cascade,
  -- hex SHA-256 of the full secret
  key_hash text not null unique,
  -- first characters of the secret, for display in the dashboard
  key_prefix text not null,
  status text not null default 'active' check (status in ('active', 'revoked')),
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);

create index agent_keys_tab_id_idx on public.agent_keys (tab_id);

alter table public.agent_keys enable row level security;

create policy agent_keys_select_own on public.agent_keys
  for select to authenticated
  using (user_id = (select auth.uid()));
