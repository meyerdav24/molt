-- OT-031: card details are handed to the agent exactly once and never
-- stored. This flag tracks whether the one-time delivery happened (for
-- mandates approved via the Tap, delivery occurs on the next agent poll).
alter table public.cards
  add column details_delivered_at timestamptz;
