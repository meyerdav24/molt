-- Molt schema v1 (OT-002)
--
-- Conventions:
--   * All money amounts are integer minor units (cents). Never floats.
--   * Card details (PAN/CVC/expiry) are NEVER stored anywhere; only Stripe
--     card IDs. There are deliberately no columns for them.
--   * The narrowing rule (child never exceeds parent on any bound) is enforced
--     in packages/protocol (OT-022) inside a serialized transaction with row
--     locks; the schema provides the shape and the atomic budget columns.
--   * `events` is an append-only audit log: no update/delete for app roles,
--     enforced by both privileges and a trigger (defense in depth).

-- ---------------------------------------------------------------------------
-- users
-- ---------------------------------------------------------------------------
create table public.users (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  display_name text,
  -- Stripe test-mode cardholder ID (OT-030). ID only, never card data.
  stripe_cardholder_id text unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- credentials (WebAuthn passkeys; passkey-only auth, no passwords anywhere)
-- ---------------------------------------------------------------------------
create table public.credentials (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  -- base64url credential ID as returned by the authenticator
  credential_id text not null unique,
  public_key bytea not null,
  -- signature counter for clone detection
  counter bigint not null default 0,
  transports text[] not null default '{}',
  device_type text,
  backed_up boolean not null default false,
  created_at timestamptz not null default now(),
  last_used_at timestamptz
);

create index credentials_user_id_idx on public.credentials (user_id);

-- ---------------------------------------------------------------------------
-- tabs (the delegation: one root mandate per tab)
-- ---------------------------------------------------------------------------
create table public.tabs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  status text not null default 'active'
    check (status in ('active', 'expired', 'revoked', 'exhausted')),
  currency text not null default 'EUR' check (char_length(currency) = 3),
  -- Denormalized from the root mandate for atomic decrement under row lock
  -- (select ... for update in OT-022). remaining <= total always.
  total_minor bigint not null check (total_minor > 0),
  remaining_minor bigint not null check (remaining_minor >= 0),
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint remaining_within_total check (remaining_minor <= total_minor)
);

create index tabs_user_id_idx on public.tabs (user_id);
create index tabs_status_idx on public.tabs (status);

-- ---------------------------------------------------------------------------
-- mandates (the tree: parent_id null = root; children narrow, never widen)
-- ---------------------------------------------------------------------------
create table public.mandates (
  id uuid primary key default gen_random_uuid(),
  tab_id uuid not null references public.tabs (id) on delete cascade,
  parent_id uuid references public.mandates (id) on delete restrict,
  kind text not null check (kind in ('root', 'child')),
  status text not null default 'pending'
    check (status in ('pending', 'active', 'held', 'approved', 'denied',
                      'expired', 'consumed', 'revoked')),
  -- Canonical mandate JSON (bounds) exactly as hashed/signed. Source of truth
  -- for verification; the typed columns below are query conveniences.
  bounds jsonb not null,
  amount_minor bigint not null check (amount_minor > 0),
  currency text not null check (char_length(currency) = 3),
  -- Child: exactly one merchant origin. Root: '*' or a pattern.
  merchant_scope text not null,
  -- Child only: SHA-256 of the normalized cart this mandate is scoped to.
  cart_hash text,
  -- Child only: machine-readable link to the root task declaration.
  reason text,
  -- Root only: free-text task declaration the user signed.
  task_declaration text,
  -- Root only: step-up policy per trigger (allow/notify/require_tap/block).
  step_up_policy jsonb,
  -- Root: the ceremony assertion whose challenge is the SHA-256 of the
  -- canonical mandate JSON. Also holds Tap amendment assertions (OT-024),
  -- which amend the tab and never create a new root.
  webauthn_assertion jsonb,
  challenge_hash text,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Shape invariants the engine relies on:
  constraint root_has_no_parent check (
    (kind = 'root' and parent_id is null) or (kind = 'child' and parent_id is not null)
  ),
  constraint root_has_ceremony check (
    kind <> 'root' or (webauthn_assertion is not null and challenge_hash is not null
                       and task_declaration is not null and step_up_policy is not null)
  ),
  constraint child_has_cart check (
    kind <> 'child' or (cart_hash is not null and reason is not null)
  )
);

create unique index mandates_one_root_per_tab_idx
  on public.mandates (tab_id) where (kind = 'root');
create index mandates_tab_id_idx on public.mandates (tab_id);
create index mandates_parent_id_idx on public.mandates (parent_id);
create index mandates_status_idx on public.mandates (status);
create index mandates_expires_at_idx on public.mandates (expires_at);

-- ---------------------------------------------------------------------------
-- cards (one shell per child mandate; Stripe IDs only, no card data — ever)
-- ---------------------------------------------------------------------------
create table public.cards (
  id uuid primary key default gen_random_uuid(),
  -- unique: a child mandate maps to at most one card, worn once
  mandate_id uuid not null unique references public.mandates (id) on delete restrict,
  stripe_card_id text not null unique,
  status text not null default 'active'
    check (status in ('active', 'deactivated')),
  created_at timestamptz not null default now(),
  deactivated_at timestamptz
);

-- ---------------------------------------------------------------------------
-- receipts (dual-signed; same shape for card and on-chain rails)
-- ---------------------------------------------------------------------------
create table public.receipts (
  id uuid primary key default gen_random_uuid(),
  tab_id uuid not null references public.tabs (id) on delete cascade,
  mandate_id uuid not null references public.mandates (id) on delete restrict,
  rung text not null check (rung in ('L0', 'L1', 'L2', 'L3')),
  rail text not null check (rail in ('card_stripe_test', 'usdc_x402_testnet')),
  merchant text not null,
  amount_minor bigint not null check (amount_minor > 0),
  currency text not null check (char_length(currency) = 3),
  -- Evidence hashes only (DOM sha256, screenshot sha256, on-chain tx hash);
  -- artifacts themselves live in storage, addressed by hash.
  evidence jsonb not null default '{}'::jsonb,
  idempotency_key text not null unique,
  -- Root-to-child mandate ID chain, root first.
  mandate_chain jsonb not null,
  agent_signature text,
  ta_signature text,
  status text not null default 'settled'
    check (status in ('pending', 'settled', 'merchant_confirmed', 'failed')),
  created_at timestamptz not null default now()
);

create index receipts_tab_id_idx on public.receipts (tab_id);
create index receipts_mandate_id_idx on public.receipts (mandate_id);

-- ---------------------------------------------------------------------------
-- events (append-only audit log)
-- ---------------------------------------------------------------------------
create table public.events (
  id bigint generated always as identity primary key,
  tab_id uuid references public.tabs (id) on delete set null,
  mandate_id uuid references public.mandates (id) on delete set null,
  user_id uuid references public.users (id) on delete set null,
  -- who acted: 'user' | 'agent' | 'ta' | 'stripe_webhook' | 'system'
  actor text not null,
  type text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index events_tab_id_idx on public.events (tab_id);
create index events_type_idx on public.events (type);
create index events_created_at_idx on public.events (created_at);

-- Append-only enforcement, layer 1: privileges. Supabase app roles get
-- insert+select only. (service_role retains its defaults for migrations and
-- admin tooling; the application must use the restricted grants below.)
revoke update, delete on public.events from anon, authenticated;

-- Append-only enforcement, layer 2: trigger. Catches any path with broader
-- privileges, including accidental service-role writes from app code.
create or replace function public.forbid_event_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'events is append-only (audit log)';
end;
$$;

create trigger events_no_update
  before update or delete on public.events
  for each row execute function public.forbid_event_mutation();

-- ---------------------------------------------------------------------------
-- updated_at maintenance
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger users_set_updated_at before update on public.users
  for each row execute function public.set_updated_at();
create trigger tabs_set_updated_at before update on public.tabs
  for each row execute function public.set_updated_at();
create trigger mandates_set_updated_at before update on public.mandates
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Row-level security: on for every table. The dashboard reads with the
-- authenticated role, scoped to the JWT subject; the TA server writes through
-- its own connection. Policies are owner-read; all writes go through the
-- server (no direct client inserts in v1).
-- ---------------------------------------------------------------------------
alter table public.users enable row level security;
alter table public.credentials enable row level security;
alter table public.tabs enable row level security;
alter table public.mandates enable row level security;
alter table public.cards enable row level security;
alter table public.receipts enable row level security;
alter table public.events enable row level security;

create policy users_select_own on public.users
  for select to authenticated
  using (id = (select auth.uid()));

create policy credentials_select_own on public.credentials
  for select to authenticated
  using (user_id = (select auth.uid()));

create policy tabs_select_own on public.tabs
  for select to authenticated
  using (user_id = (select auth.uid()));

create policy mandates_select_own on public.mandates
  for select to authenticated
  using (tab_id in (select id from public.tabs where user_id = (select auth.uid())));

create policy cards_select_own on public.cards
  for select to authenticated
  using (mandate_id in (
    select m.id from public.mandates m
    join public.tabs t on t.id = m.tab_id
    where t.user_id = (select auth.uid())
  ));

create policy receipts_select_own on public.receipts
  for select to authenticated
  using (tab_id in (select id from public.tabs where user_id = (select auth.uid())));

create policy events_select_own on public.events
  for select to authenticated
  using (user_id = (select auth.uid())
         or tab_id in (select id from public.tabs where user_id = (select auth.uid())));

-- No insert/update/delete policies for anon/authenticated: with RLS enabled
-- and no policy, those operations are denied by default. All writes flow
-- through the TA server role.
