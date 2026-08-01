-- OT-060 wiring: a receipt travels with the public keys needed to verify it
-- offline (SignedReceipt shape in packages/protocol). The TA countersigns at
-- filing time; both keys are stored alongside the signatures.
alter table public.receipts
  add column if not exists agent_public_key text,
  add column if not exists ta_public_key text;
